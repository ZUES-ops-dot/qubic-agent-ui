// LLM Agent with RAG function calling

import { getSettingsAsync, type Settings } from './storage';
import { searchContracts as ragSearchContracts, searchVulnerabilities as ragSearchVulnerabilities } from './rag';
import { withRetry } from './retry';
import { sanitizeCodeInput } from './crypto';

export interface Message {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  name?: string;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

export interface ChatResponse {
  content: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

interface OpenAIUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

interface OpenAIToolCall {
  id: string;
  function: {
    name: string;
    arguments: string;
  };
}

interface OpenAIAssistantMessage {
  role: 'assistant';
  content: string | null;
  tool_calls?: OpenAIToolCall[];
}

interface OpenAIChatCompletion {
  choices: Array<{
    message: OpenAIAssistantMessage;
  }>;
  usage?: OpenAIUsage;
}

interface VerifyAndFixResult {
  fixedCode?: string;
  remainingIssues?: number;
  finalAnalysis?: {
    summary?: {
      critical?: number;
      warnings?: number;
    };
  };
}

interface ResolvedAgentResponse {
  content: string;
  usage?: OpenAIUsage;
  executedTools: string[];
  groundingInjected: boolean;
  verifyEnforced: boolean;
  hadContractCode: boolean;
}

const OPENAI_CHAT_COMPLETIONS_URL = 'https://api.openai.com/v1/chat/completions';
const GOOGLE_CHAT_COMPLETIONS_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
const MAX_TOOL_CALL_ROUNDS = 6;
const MAX_GROUNDING_RESULTS = 3;
const MAX_GROUNDING_CONTENT_CHARS = 900;
const INTER_REQUEST_DELAY_MS = 2500;

// RAG function definitions for LLM
const tools = [
  {
    type: "function" as const,
    function: {
      name: "search_contracts",
      description: "Search the Qubic QPI smart contract knowledge base for relevant examples, patterns, or implementations. Use when user asks about QPI contract implementations, needs code examples, or asks about Qubic-specific patterns.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The search query (e.g., 'invocation reward handling', 'PUBLIC_PROCEDURE pattern', 'token contract')"
          },
          filter_source: {
            type: "string",
            enum: ["qubic-core", "qubic-hackathon", "qubic-docs", "contracts.md", "security", "hackathon", "community", "all"],
            description: "Filter results by source. Use 'all' for no filtering. Legacy aliases 'hackathon' and 'community' are still accepted."
          }
        },
        required: ["query"]
      }
    }
  },
  {
    type: "function" as const,
    function: {
      name: "search_vulnerabilities",
      description: "Search for known QPI security vulnerabilities and anti-patterns. Use when analyzing Qubic contract security or discussing potential vulnerabilities specific to QPI.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Security concern or vulnerability type in QPI context"
          },
          severity: {
            type: "string",
            enum: ["critical", "high", "medium", "low", "all"],
            description: "Filter by severity level"
          }
        },
        required: ["query"]
      }
    }
  },
  {
    type: "function" as const,
    function: {
      name: "analyze_contract",
      description: "Analyze a Qubic QPI smart contract for potential issues including banned types, missing registrations, incorrect syntax, and security vulnerabilities. Runs 30 checks (15 syntax + 15 semantic).",
      parameters: {
        type: "object",
        properties: {
          code: {
            type: "string",
            description: "The QPI contract code to analyze"
          },
          focus: {
            type: "string",
            enum: ["security", "syntax", "best-practices", "all"],
            description: "Analysis focus area"
          }
        },
        required: ["code"]
      }
    }
  },
  {
    type: "function" as const,
    function: {
      name: "verify_and_fix",
      description: "Run the 30-check QPI analyzer on contract code, then automatically attempt to fix all detected issues. Returns the fixed code and remaining issues. Use this after generating a contract to ensure it passes all checks before presenting to the user.",
      parameters: {
        type: "object",
        properties: {
          code: {
            type: "string",
            description: "The QPI contract code to verify and fix"
          },
          max_iterations: {
            type: "number",
            description: "Maximum fix iterations (default 3)"
          }
        },
        required: ["code"]
      }
    }
  }
];

// System prompt for the agent -- accurate QPI rules sourced from official contracts.md and qubic/core
const SYSTEM_PROMPT = `You are an expert Qubic smart contract developer. Qubic uses QPI (Qubic Programming Interface), a sandboxed subset of C++. Contracts run directly on 676 Computors' hardware -- not a VM. You must follow these rules exactly. Source: github.com/qubic/core/blob/main/doc/contracts.md

STRUCTURE -- Every contract is a single .h file:

using namespace QPI;
struct MYCONTRACT : public ContractBase {
public:
    struct MyFunc_input  { /* fields */ };
    struct MyFunc_output { /* fields */ };
    struct MyProc_input  { /* fields */ };
    struct MyProc_output { /* fields */ };
private:
    uint64 myStateVar;
    PUBLIC_FUNCTION(MyFunc)
    {
        output.result = state.myStateVar;
    }
    PUBLIC_PROCEDURE(MyProc)
    {
        state.myStateVar++;
    }
    REGISTER_USER_FUNCTIONS_AND_PROCEDURES
    {
        REGISTER_USER_FUNCTION(MyFunc, 1);
        REGISTER_USER_PROCEDURE(MyProc, 1);
    }
    INITIALIZE
    {
        state.myStateVar = 0;
    }
};

TYPES -- Only QPI types. Never native C++ types.
ALLOWED: bit (boolean), uint8, uint16, uint32, uint64, sint8, sint16, sint32, sint64, id (addresses/public keys)
CONTAINERS: Array<T,L> (L must be power of 2), BitArray<L>, Collection<T,L>, HashMap<KeyT,ValueT,L>, HashSet<KeyT,L>
BANNED: bool, int, char, float, double, long, short, std::anything, [] notation, pointers, malloc/new/delete

OPERATORS:
BANNED: / and %. USE: div(a,b) and mod(a,b) -- they return 0 on division by zero.

C++ RESTRICTIONS (from official contracts.md):
- LOCAL VARIABLES ON THE STACK ARE FORBIDDEN. No for(int i=0;...). Use _WITH_LOCALS macros and define a _locals struct.
- Pointers forbidden (* only for multiplication)
- [ and ] forbidden (use Array<T,L>)
- All preprocessor directives # forbidden (no #include, #pragma, #ifdef)
- String literals " and char literals ' are FORBIDDEN (can jump to random memory)
- float/double forbidden (non-deterministic)
- Variadic arguments ... forbidden
- Double underscores __ forbidden (reserved)
- union, typedef at global scope forbidden
- using at global scope forbidden EXCEPT using namespace QPI
- :: forbidden except for contract-defined structs/enums and qpi.h types
- Global variables forbidden (only constants prefixed with contract name)
- Recursion depth limit: 10

LOCAL VARIABLES -- Use _WITH_LOCALS pattern:
struct MyProc_locals { uint64 temp; uint32 i; };
PUBLIC_PROCEDURE_WITH_LOCALS(MyProc) { locals.temp = 0; ... }
Available: PUBLIC_FUNCTION_WITH_LOCALS, PUBLIC_PROCEDURE_WITH_LOCALS, PRIVATE_FUNCTION_WITH_LOCALS, PRIVATE_PROCEDURE_WITH_LOCALS, INITIALIZE_WITH_LOCALS, BEGIN_EPOCH_WITH_LOCALS, etc.

FUNCTION vs PROCEDURE:
- PUBLIC_FUNCTION: Read-only (state is const). Called via RequestContractFunction. Cannot log.
- PUBLIC_PROCEDURE: Read+write. Called via transactions. Can transfer, burn, issue assets.
- PRIVATE_FUNCTION/PRIVATE_PROCEDURE: Same but NOT callable by other contracts.
- Functions CAN be called by procedures. Procedures CANNOT be called by functions.

REGISTER -- Functions and procedures have SEPARATE inputType namespaces:
REGISTER_USER_FUNCTION(Name, inputType)  -- inputType 1-65535
REGISTER_USER_PROCEDURE(Name, inputType) -- inputType 1-65535
The SAME inputType number CAN be used for both a function AND a procedure.

SYSTEM PROCEDURES (lifecycle hooks):
INITIALIZE -- Once after IPO, before construction epoch
BEGIN_EPOCH / END_EPOCH -- Before/after each epoch
BEGIN_TICK / END_TICK -- Before/after each tick
POST_INCOMING_TRANSFER -- After QU received (use input.sourceId, NOT qpi.invocator())

QPI CONTEXT:
In functions (QpiContextFunctionCall qpi): qpi.epoch(), qpi.tick(), qpi.invocator(), qpi.invocationReward(), qpi.originator(), qpi.getEntity(), qpi.numberOfShares()
In procedures (QpiContextProcedureCall qpi): all above plus qpi.transfer(), qpi.burn(), qpi.issueAsset(), qpi.transferShareOwnershipAndPossession(), qpi.releaseShares(), qpi.acquireShares(), qpi.distributeDividends()

HANDLING QU PAYMENTS:
if (qpi.invocationReward() > 0) { qpi.transfer(qpi.invocator(), qpi.invocationReward()); }
qpi.burn(amount) -- burns QU, fills contract execution fee reserve

ASSETS:
qpi.issueAsset() -- create asset (name: up to 7 chars, first A-Z, rest A-Z/0-9)
Asset identified by pair (issuer_id, asset_name)
676 contract shares created after IPO -- shareholders receive passive income

INPUT/OUTPUT STRUCT RULES:
May only use: integer types, bit, id, Array, BitArray, and structs of these.
Complex types (Collection, HashMap, HashSet) are FORBIDDEN in input/output structs.

DEPLOYMENT LIFECYCLE (NOT like Ethereum -- cannot deploy to mainnet without community vote):
1. Write .h file in src/contracts/, fork qubic/core develop branch
2. Add contract in src/contract_core/contract_def.h (index, state, description)
3. Implement GoogleTest tests in test/contract_[name].cpp
4. Pass Qubic SC Verification Tool (qubic-contract-verify)
5. Security audit (optional but highly recommended)
6. Open PR to develop branch, Core dev review
7. Test on local testnet (Qubic Core Lite recommended) or multi-node testnet
8. Submit computor proposal via GQMPROP (epoch N) -- 451 of 676 computors must participate, majority approval
9. IPO Dutch Auction in epoch N+1 -- ALL 676 shares must sell or contract is permanently broken
10. Contract goes live in epoch N+2 -- automatic construction
Post-launch: bug fixes via PR (no new vote), new features require new proposal + vote
Execution fees: contract must burn QU (qpi.burn()) to stay active; if reserve hits zero, execution stops

NAMING RULES:
Asset name: max 7 uppercase letters/digits (e.g., QX, QTRY, QEARN)
State struct: full uppercase (e.g., MYCONTRACT)
Style: camelCase for functions/procedures, ALL_CAPS for constants prefixed with contract name
Curly braces always on new line. User types declared inside contract struct.

TESTING (testnet only -- this tool targets testnet):
Testnet RPC: https://testnet-rpc.qubicdev.com
POST /v1/querySmartContract -- read contract state
POST /v1/broadcast-transaction -- execute procedures
CLI: qubic-cli for direct node interaction (build from source recommended)
Faucet: Qubic Discord #bot-commands channel

ORACLE MACHINES (OMs):
Qubic Oracle Machines bridge smart contracts to real-world data (price feeds, weather, events).
Architecture: Qubic Core Node → Oracle Machine Node (middleware) → External Oracle Services (e.g. CoinGecko)
- Smart contract sends OracleMachineQuery → Oracle Machine fetches data → returns OracleMachineReply
- Data verified by Quorum: each Computor generates OracleReplyCommitTransaction, then OracleReplyRevealTransaction
- Two modes: One-Time Query (single request) or Subscription (continuous updates)
- Price Interface (Index 0): Query with Currency1/Currency2, Reply with Numerator/Denominator (sint64) for precision
- Test Interface (Index 1): For development and testing
- Request fees are burned (deflationary)
- Expected latency: 3-5 ticks (~10 seconds)
- TTL-based caching with automatic cleanup
- Building custom oracles: implement BaseOracleService, define query/reply structs in Core, register in build system
- Repository: github.com/qubic/oracle-machine
Use cases: DeFi price feeds, prediction markets, parametric insurance, gaming/NFT with real-world data

TOOLS & WORKFLOW:
You have access to tools to search the Qubic knowledge base (50+ curated entries + full official docs).
CRITICAL RULES:
1. BEFORE generating ANY QPI contract code, ALWAYS call search_contracts first to find relevant official patterns and examples. Base your code on what the search returns.
2. When a user asks about QPI features, lifecycle, restrictions, or deployment -- search first, then answer with grounded facts.
3. When a user asks about security concerns -- call search_vulnerabilities.
4. When a user provides contract code to review -- call analyze_contract.
5. AFTER generating any contract code, ALWAYS call verify_and_fix to run the 30-check analyzer and auto-fix common issues before presenting code to the user.
6. Never hallucinate QPI APIs. If unsure about a qpi.* function, search the knowledge base first.
7. All code you generate must follow the official QPI style: camelCase functions/procedures, ALL_CAPS constants, curly braces on new line, _WITH_LOCALS for any local variables.`;

function normalizeRAGSourceFilter(filterSource?: string): string | undefined {
  if (!filterSource || filterSource === 'all') return undefined;

  const normalized = filterSource.toLowerCase().trim();

  if (normalized === 'qubic-core' || normalized === 'qubiccore' || normalized === 'core' || normalized === 'qubic') {
    return 'qubic-core';
  }

  if (normalized === 'qubic-hackathon' || normalized === 'hackathon') {
    return 'qubic-hackathon';
  }

  if (normalized === 'qubic-docs' || normalized === 'docs' || normalized === 'documentation') {
    return 'qubic-docs';
  }

  if (normalized === 'contracts.md' || normalized === 'contractsmd' || normalized === 'contracts') {
    return 'contracts.md';
  }

  if (normalized === 'security') {
    return 'security';
  }

  // Legacy alias that previously represented non-core content.
  if (normalized === 'community') {
    return undefined;
  }

  return undefined;
}

function normalizeLooseSourceName(value: string): string {
  return value.toLowerCase().replace(/[-_\s.]/g, '');
}

// RAG search using the in-app local knowledge base
async function searchContractsRAG(query: string, filterSource?: string): Promise<object[]> {
  console.log('RAG: Searching contracts for:', query, filterSource);

  const mappedSource = normalizeRAGSourceFilter(filterSource);
  const results = await ragSearchContracts(query, {
    filterSource: mappedSource ?? 'all',
    limit: 12
  });

  if (!filterSource || filterSource === 'all' || filterSource === 'community' || mappedSource) {
    return results.slice(0, 5);
  }

  const normalizedSource = normalizeLooseSourceName(filterSource);
  const filtered = results.filter((result) => {
    const source = normalizeLooseSourceName(String((result as { source?: string }).source || ''));
    return source.includes(normalizedSource);
  });

  return filtered.slice(0, 5);
}

async function searchVulnerabilitiesRAG(query: string, severity?: string): Promise<object[]> {
  console.log('RAG: Searching vulnerabilities for:', query, severity);
  
  const results = await ragSearchVulnerabilities(query, {
    severity: severity as 'critical' | 'high' | 'medium' | 'low' | 'all' | undefined,
    limit: 5
  });
  
  return results;
}

export async function analyzeContract(code: string, focus?: string): Promise<object> {
  console.log('Analyzing contract:', focus);
  
  // Sanitize code input
  const sanitizedCode = sanitizeCodeInput(code);
  
  // QPI-specific static analysis based on official contracts.md
  const issues: Array<{type: string; line?: number; message: string}> = [];
  
  // 1. Check for banned native C++ types
  const bannedTypeChecks: [RegExp, string][] = [
    [/\bbool\b/, 'bool (use bit)'],
    [/(?<![us]int)\bint\b(?!8|16|32|64)/, 'int (use uint32, sint64, etc.)'],
    [/\bchar\b/, 'char (forbidden -- strings/chars banned)'],
    [/\bfloat\b/, 'float (non-deterministic arithmetic)'],
    [/\bdouble\b/, 'double (non-deterministic arithmetic)'],
    [/\blong\b(?!\s)/, 'long (use sint64 or uint64)'],
    [/\bshort\b/, 'short (use sint16 or uint16)'],
  ];
  for (const [regex, desc] of bannedTypeChecks) {
    if (regex.test(sanitizedCode)) {
      issues.push({ type: 'critical', message: `Banned native type: ${desc}` });
    }
  }
  
  // 2. Check for banned operators
  if (sanitizedCode.includes('%') && !sanitizedCode.includes('mod(')) {
    issues.push({ type: 'critical', message: "Operator '%' is banned -- use mod(a, b) instead (returns 0 on div-by-zero)" });
  }
  if (/[^a-zA-Z]\/[^/\*]/.test(sanitizedCode) && !sanitizedCode.includes('div(')) {
    issues.push({ type: 'critical', message: "Operator '/' is banned -- use div(a, b) instead (returns 0 on div-by-zero)" });
  }
  
  // 3. Check for missing REGISTER block
  if (!sanitizedCode.includes('REGISTER_USER_FUNCTIONS_AND_PROCEDURES')) {
    issues.push({ type: 'critical', message: 'Missing REGISTER_USER_FUNCTIONS_AND_PROCEDURES block -- functions/procedures will not be callable' });
  }
  
  // 4. Check for missing _input/_output structs
  const allFunctions = sanitizedCode.match(/(?:PUBLIC|PRIVATE)_(?:FUNCTION|PROCEDURE)(?:_WITH_LOCALS)?\(([^)]+)\)/g) || [];
  for (const fn of allFunctions) {
    const name = fn.match(/\(([^)]+)\)/)?.[1];
    if (name) {
      if (!sanitizedCode.includes(`${name}_input`)) {
        issues.push({ type: 'critical', message: `Missing ${name}_input struct -- required for every function/procedure` });
      }
      if (!sanitizedCode.includes(`${name}_output`)) {
        issues.push({ type: 'critical', message: `Missing ${name}_output struct` });
      }
    }
  }
  
  // 5. Check for local variables on the stack (forbidden)
  if (/for\s*\(\s*(int|uint|sint|uint64|uint32)\s/.test(sanitizedCode)) {
    issues.push({ type: 'critical', message: 'Local loop variables on stack forbidden -- use _WITH_LOCALS macro and _locals struct' });
  }
  
  // 6. Check for [] array notation (forbidden)
  if (/\w+\s*\[\s*\d*\s*\]/.test(sanitizedCode)) {
    issues.push({ type: 'critical', message: 'Characters [ and ] are forbidden -- use Array<T, L> container instead' });
  }
  
  // 7. Check for preprocessor directives
  if (/^\s*#\s*(include|pragma|ifdef|ifndef|define|endif)/m.test(sanitizedCode)) {
    issues.push({ type: 'critical', message: 'Preprocessor directives (#include, #pragma, etc.) are forbidden in final contract code' });
  }
  
  // 8. Check for string/char literals
  if (/"[^"]*"/.test(sanitizedCode.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ''))) {
    issues.push({ type: 'critical', message: 'String literals ("") are forbidden in QPI -- can jump to random memory' });
  }
  
  // 9. Check for double underscores (reserved)
  if (/__/.test(sanitizedCode)) {
    issues.push({ type: 'warning', message: 'Double underscores __ are reserved for internal functions -- do not use in contract code' });
  }
  
  // 10. Check for union keyword
  if (/\bunion\b/.test(sanitizedCode)) {
    issues.push({ type: 'critical', message: 'union keyword is forbidden in QPI' });
  }
  
  // 11. Check for invocationReward without transfer/burn (missing refund)
  if (sanitizedCode.includes('PUBLIC_PROCEDURE') && !sanitizedCode.includes('invocationReward')) {
    issues.push({ type: 'warning', message: 'PUBLIC_PROCEDURE without invocationReward check -- consider handling/refunding QU sent by callers' });
  }
  if (sanitizedCode.includes('invocationReward') && !sanitizedCode.includes('qpi.transfer') && !sanitizedCode.includes('qpi.burn')) {
    issues.push({ type: 'warning', message: 'invocationReward checked but no qpi.transfer or qpi.burn -- QU may be locked in contract' });
  }
  
  // 12. Check for missing ContractBase
  if (!sanitizedCode.includes('ContractBase') && sanitizedCode.includes('struct')) {
    issues.push({ type: 'warning', message: 'Contract struct should inherit from ContractBase' });
  }
  
  // 13. Check for missing using namespace QPI
  if (!sanitizedCode.includes('using namespace QPI')) {
    issues.push({ type: 'warning', message: 'Missing "using namespace QPI;" declaration' });
  }
  
  // 14. Check for pointer dereference or dynamic memory
  if (/\bmalloc\b|\bnew\s|\bdelete\s|\bfree\b/.test(sanitizedCode)) {
    issues.push({ type: 'critical', message: 'Dynamic memory (malloc, new, delete, free) is forbidden in QPI' });
  }
  
  // 15. Check for variadic arguments
  if (/\.\.\./.test(sanitizedCode)) {
    issues.push({ type: 'critical', message: 'Variadic arguments (...) are forbidden in QPI' });
  }
  
  // ========== SEMANTIC VALIDATION (logic bugs, security flaws) ==========
  
  // 16. State modification inside PUBLIC_FUNCTION (silent bug -- state is const)
  const functionBlocks = sanitizedCode.match(/PUBLIC_FUNCTION(?:_WITH_LOCALS)?\([^)]+\)\s*\{[\s\S]*?\}/g) || [];
  for (const block of functionBlocks) {
    if (/state\.\w+\s*[+\-\*]?=/.test(block) || /state\.\w+\s*\+\+/.test(block)) {
      const fnName = block.match(/PUBLIC_FUNCTION(?:_WITH_LOCALS)?\(([^)]+)\)/)?.[1] || '?';
      issues.push({ type: 'critical', message: `State modification in PUBLIC_FUNCTION(${fnName}) -- state is const in functions. Use PUBLIC_PROCEDURE instead.` });
    }
  }
  
  // 17. qpi.transfer() or qpi.burn() inside PUBLIC_FUNCTION (not allowed)
  for (const block of functionBlocks) {
    if (/qpi\.(transfer|burn|issueAsset)\s*\(/.test(block)) {
      const fnName = block.match(/PUBLIC_FUNCTION(?:_WITH_LOCALS)?\(([^)]+)\)/)?.[1] || '?';
      issues.push({ type: 'critical', message: `qpi.transfer/burn/issueAsset in PUBLIC_FUNCTION(${fnName}) -- only allowed in procedures` });
    }
  }
  
  // 18. qpi.invocator() inside POST_INCOMING_TRANSFER (returns 0 -- use input.sourceId)
  const postTransferBlocks = sanitizedCode.match(/POST_INCOMING_TRANSFER(?:_WITH_LOCALS)?\s*\{[\s\S]*?\}/g) || [];
  for (const block of postTransferBlocks) {
    if (block.includes('qpi.invocator()')) {
      issues.push({ type: 'critical', message: 'qpi.invocator() returns 0 in POST_INCOMING_TRANSFER -- use input.sourceId instead' });
    }
    if (block.includes('qpi.invocationReward()')) {
      issues.push({ type: 'critical', message: 'qpi.invocationReward() returns 0 in POST_INCOMING_TRANSFER -- use input.amount instead' });
    }
  }
  
  // 19. REGISTER mismatch -- defined functions/procedures not registered
  const registeredFunctions = sanitizedCode.match(/REGISTER_USER_FUNCTION\(\s*(\w+)/g)?.map(m => m.match(/\(\s*(\w+)/)?.[1]) || [];
  const registeredProcedures = sanitizedCode.match(/REGISTER_USER_PROCEDURE\(\s*(\w+)/g)?.map(m => m.match(/\(\s*(\w+)/)?.[1]) || [];
  for (const fn of allFunctions) {
    const name = fn.match(/\(([^)]+)\)/)?.[1];
    if (!name) continue;
    const isFunction = fn.includes('FUNCTION');
    const isProcedure = fn.includes('PROCEDURE') && !fn.includes('FUNCTION');
    if (isFunction && !registeredFunctions.includes(name) && !fn.includes('PRIVATE')) {
      issues.push({ type: 'warning', message: `PUBLIC_FUNCTION(${name}) defined but not found in REGISTER_USER_FUNCTION` });
    }
    if (isProcedure && !registeredProcedures.includes(name) && !fn.includes('PRIVATE')) {
      issues.push({ type: 'warning', message: `PUBLIC_PROCEDURE(${name}) defined but not found in REGISTER_USER_PROCEDURE` });
    }
  }
  
  // 20. Duplicate REGISTER inputType indices (per namespace)
  const fnIndices = sanitizedCode.match(/REGISTER_USER_FUNCTION\(\s*\w+\s*,\s*(\d+)\s*\)/g)?.map(m => m.match(/,\s*(\d+)/)?.[1]) || [];
  const procIndices = sanitizedCode.match(/REGISTER_USER_PROCEDURE\(\s*\w+\s*,\s*(\d+)\s*\)/g)?.map(m => m.match(/,\s*(\d+)/)?.[1]) || [];
  if (new Set(fnIndices).size < fnIndices.length) {
    issues.push({ type: 'critical', message: 'Duplicate inputType index in REGISTER_USER_FUNCTION -- each function needs a unique index' });
  }
  if (new Set(procIndices).size < procIndices.length) {
    issues.push({ type: 'critical', message: 'Duplicate inputType index in REGISTER_USER_PROCEDURE -- each procedure needs a unique index' });
  }
  
  // 21. Container capacity not power of 2
  const capacityMatches = sanitizedCode.match(/(Array|BitArray|Collection|HashMap|HashSet)<[^>]+,\s*(\d+)\s*>/g) || [];
  for (const match of capacityMatches) {
    const cap = parseInt(match.match(/,\s*(\d+)\s*>/)?.[1] || '0');
    if (cap > 0 && (cap & (cap - 1)) !== 0) {
      issues.push({ type: 'critical', message: `Container capacity ${cap} is not a power of 2 -- required for Array, BitArray, Collection, HashMap, HashSet` });
    }
  }
  
  // 22. Complex types in input/output structs (forbidden)
  const ioStructBlocks = sanitizedCode.match(/struct\s+\w+_(input|output)\s*\{[\s\S]*?\}/g) || [];
  for (const block of ioStructBlocks) {
    if (/\b(Collection|HashMap|HashSet)\b/.test(block)) {
      const structName = block.match(/struct\s+(\w+)/)?.[1] || '?';
      issues.push({ type: 'critical', message: `${structName} uses Collection/HashMap/HashSet -- complex types forbidden in input/output structs` });
    }
  }
  
  // 23. Unbounded loop in BEGIN_TICK/END_TICK (DoS risk)
  const tickBlocks = sanitizedCode.match(/(BEGIN_TICK|END_TICK)(?:_WITH_LOCALS)?\s*\{[\s\S]*?\}/g) || [];
  for (const block of tickBlocks) {
    if (/\bfor\s*\(/.test(block) || /\bwhile\s*\(/.test(block)) {
      const hookName = block.match(/(BEGIN_TICK|END_TICK)/)?.[1] || '?';
      issues.push({ type: 'warning', message: `Loop in ${hookName} -- runs every tick, ensure bounded iteration to avoid DoS` });
    }
  }
  
  // 24. Integer overflow -- arithmetic without bounds checking
  if (/state\.\w+\s*=\s*state\.\w+\s*\+\s*/.test(sanitizedCode) && !/if\s*\(.*<.*MAX/.test(sanitizedCode)) {
    issues.push({ type: 'warning', message: 'Arithmetic on state variables without overflow guard -- uint64 silently wraps on overflow' });
  }
  
  // 25. Missing INITIALIZE block
  if (!sanitizedCode.includes('INITIALIZE') && sanitizedCode.includes('ContractBase')) {
    issues.push({ type: 'warning', message: 'Missing INITIALIZE block -- state variables will be uninitialized after IPO' });
  }
  
  // 26. Asset name validation
  const assetNameMatches = sanitizedCode.match(/issueAsset\s*\([^)]*"([^"]+)"/g) || [];
  for (const match of assetNameMatches) {
    const name = match.match(/"([^"]+)"/)?.[1] || '';
    if (name && !/^[A-Z][A-Z0-9]{0,6}$/.test(name)) {
      issues.push({ type: 'critical', message: `Asset name "${name}" invalid -- must be 1-7 chars, first A-Z, rest A-Z or 0-9` });
    }
  }
  
  // 27. HashMap/HashSet without cleanup at END_EPOCH
  if (/\b(HashMap|HashSet|Collection)\b/.test(sanitizedCode) && !sanitizedCode.includes('cleanup') && !sanitizedCode.includes('reset()')) {
    issues.push({ type: 'warning', message: 'HashMap/HashSet/Collection used without cleanup() or reset() -- call at END_EPOCH to reclaim hash slots' });
  }
  
  // 28. Function calling procedure (forbidden -- functions cannot call procedures)
  for (const block of functionBlocks) {
    for (const procName of registeredProcedures) {
      if (procName && /^[A-Za-z_]\w*$/.test(procName) && new RegExp(`\\b${procName}\\s*\\(`).test(block)) {
        const fnName = block.match(/PUBLIC_FUNCTION(?:_WITH_LOCALS)?\(([^)]+)\)/)?.[1] || '?';
        issues.push({ type: 'warning', message: `Function ${fnName} may be calling procedure ${procName} -- functions cannot call procedures` });
      }
    }
  }
  
  // 29. Oracle pattern detection -- inform about Oracle Machine integration
  if (/oracle|price.?feed|external.?data|real.?world/i.test(sanitizedCode)) {
    issues.push({ type: 'info', message: 'Oracle pattern detected -- use Qubic Oracle Machines for real-world data. Query via OracleMachineQuery, receive OracleMachineReply (3-5 tick latency).' });
  }
  
  // 30. Recursion detection (limit: 10 levels)
  const functionNames = allFunctions.map(fn => fn.match(/\(([^)]+)\)/)?.[1]).filter(Boolean) as string[];
  for (const fnName of functionNames) {
    if (!/^[A-Za-z_]\w*$/.test(fnName)) continue;
    const fnBlock = sanitizedCode.match(new RegExp(`(?:PUBLIC|PRIVATE)_(?:FUNCTION|PROCEDURE)(?:_WITH_LOCALS)?\\(${fnName}\\)\\s*\\{[\\s\\S]*?\\}`));
    if (fnBlock && fnBlock[0].includes(fnName + '(')) {
      issues.push({ type: 'warning', message: `Potential self-recursion in ${fnName} -- recursion depth limit is 10 levels` });
    }
  }
  
  // Categorize issues for scoring
  const criticalCount = issues.filter(i => i.type === 'critical').length;
  const warningCount = issues.filter(i => i.type === 'warning').length;
  const infoCount = issues.filter(i => i.type === 'info').length;
  
  return {
    issues,
    score: Math.max(0, 100 - criticalCount * 12 - warningCount * 5 - infoCount * 0),
    summary: {
      critical: criticalCount,
      warnings: warningCount,
      info: infoCount,
      syntaxChecks: 15,
      semanticChecks: 15,
      totalChecks: 30
    },
    suggestions: issues.length > 0 
      ? [
          criticalCount > 0 ? 'Fix all critical QPI violations before compilation' : null,
          warningCount > 0 ? 'Address warnings to improve security and reliability' : null,
          'Run Qubic Contract Verification Tool for final validation',
          'Test with Qubic Dev Kit locally before proposal'
        ].filter(Boolean)
      : ['Code passes all 30 checks', 'Run Qubic Contract Verification Tool for final check', 'Test on multi-node testnet before Quorum proposal']
  };
}

// Multi-turn self-correction: analyze → describe fixes → re-analyze
async function verifyAndFix(code: string, maxIterations: number = 3): Promise<object> {
  let currentCode = code;
  const iterations: Array<{ iteration: number; issueCount: number; criticalCount: number; fixes: string[] }> = [];
  
  for (let i = 0; i < maxIterations; i++) {
    const result = await analyzeContract(currentCode) as { issues: Array<{type: string; message: string}>; score: number; summary: { critical: number; warnings: number } };
    const criticals = result.issues.filter(iss => iss.type === 'critical');
    
    iterations.push({
      iteration: i + 1,
      issueCount: result.issues.length,
      criticalCount: criticals.length,
      fixes: []
    });
    
    // If no critical issues, we're done
    if (criticals.length === 0) break;
    
    // Apply automatic fixes for common patterns
    const fixes: string[] = [];
    
    // Auto-fix: banned types
    const typeReplacements: [RegExp, string, string][] = [
      [/\bbool\b/g, 'bit', 'Replaced bool → bit'],
      [/\bint\b(?!8|16|32|64)/g, 'sint32', 'Replaced int → sint32'],
      [/\bchar\b/g, 'uint8', 'Replaced char → uint8'],
      [/\bfloat\b/g, 'sint64', 'Replaced float → sint64 (use fixed-point)'],
      [/\bdouble\b/g, 'sint64', 'Replaced double → sint64 (use fixed-point)'],
    ];
    for (const [regex, replacement, desc] of typeReplacements) {
      if (regex.test(currentCode)) {
        currentCode = currentCode.replace(regex, replacement);
        fixes.push(desc);
      }
    }
    
    // Auto-fix: missing using namespace QPI
    if (!currentCode.includes('using namespace QPI')) {
      currentCode = 'using namespace QPI;\n\n' + currentCode;
      fixes.push('Added using namespace QPI;');
    }
    
    // Auto-fix: missing INITIALIZE
    if (!currentCode.includes('INITIALIZE') && currentCode.includes('ContractBase')) {
      const lastBrace = currentCode.lastIndexOf('};');
      if (lastBrace > 0) {
        currentCode = currentCode.slice(0, lastBrace) + '    INITIALIZE\n    {\n    }\n' + currentCode.slice(lastBrace);
        fixes.push('Added empty INITIALIZE block');
      }
    }
    
    iterations[iterations.length - 1].fixes = fixes;
    
    // If no auto-fixes were applied, break to avoid infinite loop
    if (fixes.length === 0) break;
  }
  
  // Final analysis
  const finalResult = await analyzeContract(currentCode) as { issues: Array<{type: string; message: string}>; score: number; summary: object };
  
  return {
    originalCode: code,
    fixedCode: currentCode,
    iterations,
    finalAnalysis: finalResult,
    autoFixApplied: iterations.some(i => i.fixes.length > 0),
    remainingIssues: (finalResult.issues || []).length
  };
}

// Execute tool calls
async function executeToolCall(name: string, args: Record<string, unknown>): Promise<string> {
  switch (name) {
    case 'search_contracts':
      const contracts = await searchContractsRAG(
        args.query as string, 
        args.filter_source as string | undefined
      );
      return JSON.stringify(contracts);
      
    case 'search_vulnerabilities':
      const vulns = await searchVulnerabilitiesRAG(
        args.query as string,
        args.severity as string | undefined
      );
      return JSON.stringify(vulns);
      
    case 'analyze_contract':
      const analysis = await analyzeContract(
        args.code as string,
        args.focus as string | undefined
      );
      return JSON.stringify(analysis);
    
    case 'verify_and_fix':
      const fixResult = await verifyAndFix(
        args.code as string,
        (args.max_iterations as number) || 3
      );
      return JSON.stringify(fixResult);
      
    default:
      return JSON.stringify({ error: 'Unknown function' });
  }
}

function buildMessages(
  userMessage: string,
  conversationHistory: Message[],
  autoValidate: boolean
): Message[] {
  const autoValidationInstruction = autoValidate
    ? 'Auto-validation is enabled. After generating contract code, call verify_and_fix before finalizing your answer.'
    : 'Auto-validation is disabled. Only call verify_and_fix if the user explicitly asks for verification or fixes.';

  return [
    { role: 'system' as const, content: SYSTEM_PROMPT },
    { role: 'system' as const, content: autoValidationInstruction },
    ...conversationHistory,
    { role: 'user' as const, content: userMessage }
  ];
}

async function parseOpenAIError(response: Response): Promise<string> {
  try {
    const error = await response.json();
    return error.error?.message || `API request failed (${response.status})`;
  } catch {
    return `API request failed (${response.status})`;
  }
}

function isLikelyContractGenerationRequest(userMessage: string): boolean {
  return /(\bqpi\b|\bcontractbase\b|\bsmart\s*contract\b|\bcontract\b|PUBLIC_(FUNCTION|PROCEDURE)|\bgenerate\b|\bcreate\b|\bwrite\b|\bbuild\b)/i.test(userMessage);
}

function extractMarkdownCodeBlocks(content: string): string[] {
  const blocks: string[] = [];
  const regex = /```(?:[\w+-]+)?\n([\s\S]*?)```/g;
  let match = regex.exec(content);

  while (match) {
    blocks.push((match[1] || '').trim());
    match = regex.exec(content);
  }

  return blocks.filter(Boolean);
}

function isLikelyQpiContractCode(code: string): boolean {
  return /(using namespace QPI|ContractBase|PUBLIC_FUNCTION|PUBLIC_PROCEDURE|REGISTER_USER_FUNCTIONS_AND_PROCEDURES)/i.test(code);
}

function buildGroundingSystemMessage(results: object[]): string | null {
  if (results.length === 0) {
    return null;
  }

  const snippets = results.slice(0, MAX_GROUNDING_RESULTS).map((item, index) => {
    const entry = item as { title?: unknown; source?: unknown; content?: unknown; tags?: unknown };
    const title = typeof entry.title === 'string' ? entry.title : `Reference ${index + 1}`;
    const source = typeof entry.source === 'string' ? entry.source : 'unknown';
    const content = typeof entry.content === 'string' ? entry.content : '';
    const tags = Array.isArray(entry.tags)
      ? entry.tags.filter((tag): tag is string => typeof tag === 'string').slice(0, 6)
      : [];

    return [
      `Result ${index + 1}: ${title}`,
      `Source: ${source}`,
      `Tags: ${tags.join(', ') || 'none'}`,
      content.slice(0, MAX_GROUNDING_CONTENT_CHARS),
    ].join('\n');
  });

  return [
    'Grounding context from the official Qubic knowledge base. Base generated contract code on these references:',
    ...snippets,
    'If code is generated, it must be QPI-compliant and pass verify_and_fix validation before final output.',
  ].join('\n\n');
}

function reportAuditEvent(
  eventType: 'contract_generation_attempt' | 'contract_generation_result',
  status: 'started' | 'success' | 'error' | 'cancelled',
  metadata: Record<string, unknown>
): void {
  if (typeof window === 'undefined') {
    return;
  }

  void fetch('/api/audit', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    keepalive: true,
    body: JSON.stringify({
      eventType,
      status,
      route: '/chat',
      metadata,
    }),
  }).catch(() => undefined);
}

async function injectGroundingContext(
  userMessage: string,
  messages: Message[],
  onStatus?: (status: string) => void
): Promise<{ messages: Message[]; groundingInjected: boolean }> {
  if (!isLikelyContractGenerationRequest(userMessage)) {
    return { messages, groundingInjected: false };
  }

  try {
    onStatus?.('Searching official patterns...');
    const groundingResults = await searchContractsRAG(userMessage, 'all');
    const groundingMessage = buildGroundingSystemMessage(groundingResults);

    if (!groundingMessage) {
      return { messages, groundingInjected: false };
    }

    const withGrounding = [...messages];
    const insertAt = Math.min(2, withGrounding.length);
    withGrounding.splice(insertAt, 0, { role: 'system', content: groundingMessage });

    return { messages: withGrounding, groundingInjected: true };
  } catch (error) {
    console.warn('[Agent] Failed to load grounding context:', error);
    return { messages, groundingInjected: false };
  }
}

async function enforceVerifyPipeline(
  content: string,
  executedTools: string[],
  onStatus?: (status: string) => void
): Promise<{ content: string; verifyEnforced: boolean; hadContractCode: boolean }> {
  const codeBlocks = extractMarkdownCodeBlocks(content);
  const candidateCode = codeBlocks.find((block) => isLikelyQpiContractCode(block));

  if (!candidateCode) {
    return { content, verifyEnforced: false, hadContractCode: false };
  }

  if (executedTools.includes('verify_and_fix')) {
    return { content, verifyEnforced: false, hadContractCode: true };
  }

  onStatus?.('Running verify_and_fix...');

  const verification = await verifyAndFix(candidateCode) as VerifyAndFixResult;
  const fixedCode = typeof verification.fixedCode === 'string' && verification.fixedCode.trim()
    ? verification.fixedCode.trim()
    : candidateCode;

  const criticalIssues = Number(verification.finalAnalysis?.summary?.critical || 0);
  const remainingIssues = typeof verification.remainingIssues === 'number'
    ? verification.remainingIssues
    : 0;

  const updatedContent = content.replace(candidateCode, fixedCode);
  const validationSummary = [
    '',
    '---',
    '**Safety pipeline:** `verify_and_fix` was auto-run before this response was finalized.',
    `- Critical issues remaining: ${criticalIssues}`,
    `- Total issues remaining: ${remainingIssues}`,
  ].join('\n');

  return {
    content: `${updatedContent}\n${validationSummary}`,
    verifyEnforced: true,
    hadContractCode: true,
  };
}

async function requestChatCompletion(
  settings: Settings,
  messages: Message[]
): Promise<OpenAIChatCompletion> {
  const isGoogle = settings.provider === 'google';
  const url = isGoogle ? GOOGLE_CHAT_COMPLETIONS_URL : OPENAI_CHAT_COMPLETIONS_URL;
  const apiKey = isGoogle ? (settings.googleApiKey || settings.apiKey) : settings.apiKey;
  const model = settings.model || (isGoogle ? 'gemini-2.5-flash' : 'gpt-4');

  return withRetry(
    async () => {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          messages,
          tools,
          tool_choice: 'auto'
        })
      });

      if (!response.ok) {
        throw new Error(await parseOpenAIError(response));
      }

      return response.json();
    },
    {
      maxRetries: 3,
      baseDelay: 2000,
      maxDelay: 30000,
      onRetry: (attempt, error) => {
        console.warn(`[Agent] Retrying chat completion request (attempt ${attempt}):`, error.message);
      }
    }
  );
}

async function resolveAgentResponse(
  settings: Settings,
  messages: Message[]
): Promise<{ assistantMessage: OpenAIAssistantMessage; usage?: OpenAIUsage; executedTools: string[] }> {
  let rounds = 0;
  const executedTools: string[] = [];
  let data = await requestChatCompletion(settings, messages);
  let assistantMessage = data.choices?.[0]?.message;

  while (assistantMessage?.tool_calls && assistantMessage.tool_calls.length > 0) {
    if (rounds >= MAX_TOOL_CALL_ROUNDS) {
      throw new Error(`Tool calling exceeded ${MAX_TOOL_CALL_ROUNDS} rounds`);
    }

    messages.push({
      role: 'assistant',
      content: assistantMessage.content || '',
      tool_calls: assistantMessage.tool_calls,
    });

    for (const toolCall of assistantMessage.tool_calls) {
      let functionArgs: Record<string, unknown> = {};
      try {
        functionArgs = JSON.parse(toolCall.function.arguments || '{}');
      } catch {
        functionArgs = {};
      }

      executedTools.push(toolCall.function.name);

      const result = await executeToolCall(toolCall.function.name, functionArgs);
      messages.push({
        role: 'tool',
        content: result,
        tool_call_id: toolCall.id,
      });
    }

    rounds += 1;
    await new Promise(r => setTimeout(r, INTER_REQUEST_DELAY_MS));
    data = await requestChatCompletion(settings, messages);
    assistantMessage = data.choices?.[0]?.message;
  }

  if (!assistantMessage) {
    throw new Error('No assistant response returned by model provider');
  }

  return { assistantMessage, usage: data.usage, executedTools };
}

async function generateAgentResponse(
  settings: Settings,
  userMessage: string,
  conversationHistory: Message[],
  onStatus?: (status: string) => void
): Promise<ResolvedAgentResponse> {
  let messages = buildMessages(userMessage, conversationHistory, settings.autoValidate);
  const grounding = await injectGroundingContext(userMessage, messages, onStatus);
  messages = grounding.messages;

  onStatus?.('Thinking...');
  const { assistantMessage, usage, executedTools } = await resolveAgentResponse(settings, messages);
  const baseContent = assistantMessage.content || 'I apologize, I could not generate a response.';
  const verification = await enforceVerifyPipeline(baseContent, executedTools, onStatus);

  const effectiveTools = verification.verifyEnforced
    ? [...executedTools, 'verify_and_fix']
    : executedTools;

  return {
    content: verification.content,
    usage,
    executedTools: effectiveTools,
    groundingInjected: grounding.groundingInjected || effectiveTools.includes('search_contracts'),
    verifyEnforced: verification.verifyEnforced,
    hadContractCode: verification.hadContractCode,
  };
}

// Main chat function
export async function chatWithAgent(
  userMessage: string,
  conversationHistory: Message[] = []
): Promise<ChatResponse> {
  const settings = await getSettingsAsync();
  const shouldAuditGeneration = isLikelyContractGenerationRequest(userMessage);
  
  const isGoogle = settings.provider === 'google';
  const activeKey = isGoogle ? (settings.googleApiKey || settings.apiKey) : settings.apiKey;
  if (!activeKey) {
    const providerLabel = isGoogle ? 'Google API' : 'OpenAI API';
    return {
      content: `**API Key Required**\n\nPlease add your ${providerLabel} key in Settings → API Keys to start chatting.`
    };
  }

  if (shouldAuditGeneration) {
    reportAuditEvent('contract_generation_attempt', 'started', {
      mode: 'non-streaming',
      provider: settings.provider,
      promptLength: userMessage.length,
      historyLength: conversationHistory.length,
      autoValidate: settings.autoValidate,
    });
  }

  try {
    const response = await generateAgentResponse(settings, userMessage, conversationHistory);

    if (shouldAuditGeneration || response.hadContractCode) {
      reportAuditEvent('contract_generation_result', 'success', {
        mode: 'non-streaming',
        provider: settings.provider,
        promptLength: userMessage.length,
        outputLength: response.content.length,
        hadContractCode: response.hadContractCode,
        executedTools: response.executedTools,
        groundingInjected: response.groundingInjected,
        verifyEnforced: response.verifyEnforced,
      });
    }

    return {
      content: response.content,
      usage: response.usage ? {
        promptTokens: response.usage.prompt_tokens,
        completionTokens: response.usage.completion_tokens,
        totalTokens: response.usage.total_tokens
      } : undefined
    };

  } catch (error) {
    console.error('Agent error:', error);

    if (shouldAuditGeneration) {
      reportAuditEvent('contract_generation_result', 'error', {
        mode: 'non-streaming',
        provider: settings.provider,
        promptLength: userMessage.length,
        errorType: error instanceof Error ? error.name : 'UnknownError',
      });
    }
    
    if (error instanceof Error) {
      if (error.message.includes('API key') || error.message.includes('API_KEY') || error.message.includes('401')) {
        const isGoogleProvider = settings.provider === 'google';
        return {
          content: `**Invalid API Key**\n\nPlease check your ${isGoogleProvider ? 'Google' : 'OpenAI'} API key in Settings → API Keys.`
        };
      }
      return {
        content: `**Error**\n\n${error.message}`
      };
    }
    
    return {
      content: '**Error**\n\nAn unexpected error occurred. Please try again.'
    };
  }
}

// Real SSE streaming: resolves tool calls first, then streams the final response
export async function* streamChatWithAgent(
  userMessage: string,
  conversationHistory: Message[] = [],
  signal?: AbortSignal,
  onStatus?: (status: string) => void
): AsyncGenerator<string, void, unknown> {
  // Use async settings loader to properly decrypt AES-GCM keys
  const settings = await getSettingsAsync();
  const shouldAuditGeneration = isLikelyContractGenerationRequest(userMessage);

  const isGoogle = settings.provider === 'google';
  const activeKey = isGoogle ? (settings.googleApiKey || settings.apiKey) : settings.apiKey;
  if (!activeKey) {
    const label = isGoogle ? 'Google API' : 'OpenAI API';
    yield `**API Key Required**\n\nPlease add your ${label} key in Settings → API Keys to start chatting.`;
    return;
  }

  if (shouldAuditGeneration) {
    reportAuditEvent('contract_generation_attempt', 'started', {
      mode: 'streaming',
      provider: settings.provider,
      promptLength: userMessage.length,
      historyLength: conversationHistory.length,
      autoValidate: settings.autoValidate,
    });
  }

  try {
    const response = await generateAgentResponse(settings, userMessage, conversationHistory, onStatus);
    onStatus?.('Generating response...');

    // Yield the resolved content with natural word-by-word pacing
    if (response.content) {
      const text = response.content;
      // Split into small chunks at word boundaries for natural streaming feel
      const words = text.split(/(\s+)/);
      let batch = '';
      for (const word of words) {
        if (signal?.aborted) return;
        batch += word;
        // Yield every ~3-5 words for natural pacing
        if (batch.length >= 20 || word.includes('\n')) {
          yield batch;
          batch = '';
          // Small delay for visual streaming effect (non-blocking)
          await new Promise(r => setTimeout(r, 8));
        }
      }
      if (batch) yield batch;
    }

    if (shouldAuditGeneration || response.hadContractCode) {
      reportAuditEvent('contract_generation_result', 'success', {
        mode: 'streaming',
        provider: settings.provider,
        promptLength: userMessage.length,
        outputLength: response.content.length,
        hadContractCode: response.hadContractCode,
        executedTools: response.executedTools,
        groundingInjected: response.groundingInjected,
        verifyEnforced: response.verifyEnforced,
      });
    }
  } catch (error) {
    if (signal?.aborted) {
      if (shouldAuditGeneration) {
        reportAuditEvent('contract_generation_result', 'cancelled', {
          mode: 'streaming',
          provider: settings.provider,
          promptLength: userMessage.length,
        });
      }
      yield '\n\n*Generation cancelled.*';
      return;
    }

    if (shouldAuditGeneration) {
      reportAuditEvent('contract_generation_result', 'error', {
        mode: 'streaming',
        provider: settings.provider,
        promptLength: userMessage.length,
        errorType: error instanceof Error ? error.name : 'UnknownError',
      });
    }

    if (error instanceof Error) {
      if (error.message.includes('API key') || error.message.includes('401')) {
        const label = settings.provider === 'google' ? 'Google' : 'OpenAI';
        yield `**Invalid API Key**\n\nPlease check your ${label} API key in Settings → API Keys.`;
        return;
      }
      yield `**Error**\n\n${error.message}`;
      return;
    }
    yield '**Error**\n\nAn unexpected error occurred. Please try again.';
  }
}
