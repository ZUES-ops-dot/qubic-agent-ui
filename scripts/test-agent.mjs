#!/usr/bin/env node
/**
 * Qubic Agent — CLI Test Harness
 * Tests the full agent pipeline (LLM + static analysis) without running the Next.js app.
 *
 * Usage:
 *   node scripts/test-agent.mjs
 *   node scripts/test-agent.mjs --key AIzaSy... --model gemini-2.5-flash
 *   node scripts/test-agent.mjs --provider openai --key sk-...
 *   node scripts/test-agent.mjs --test contract        (filter by test name substring)
 *   node scripts/test-agent.mjs --verbose
 *
 * Env vars (alternative to flags):
 *   GOOGLE_API_KEY   — Google Gemini API key
 *   OPENAI_API_KEY   — OpenAI API key
 *   PROVIDER         — "google" (default) or "openai"
 *   MODEL            — model name (default: gemini-2.5-flash)
 */

import { parseArgs } from 'node:util';
import process from 'node:process';

// ── CLI arguments ─────────────────────────────────────────────────────────────
const { values: argv } = parseArgs({
  options: {
    key:      { type: 'string',  short: 'k' },
    model:    { type: 'string',  short: 'm' },
    provider: { type: 'string',  short: 'p' },
    test:     { type: 'string',  short: 't', default: 'all' },
    verbose:  { type: 'boolean', short: 'v', default: false },
  },
  strict: false,
});

const PROVIDER = argv.provider || process.env.PROVIDER || 'google';
const MODEL    = argv.model    || process.env.MODEL    || 'gemini-2.5-flash';
const API_KEY  = argv.key
  || (PROVIDER === 'google' ? process.env.GOOGLE_API_KEY : undefined)
  || process.env.OPENAI_API_KEY
  || process.env.API_KEY
  || '';
const VERBOSE  = argv.verbose;
const FILTER   = (argv.test || 'all').toLowerCase();

// ── ANSI helpers ──────────────────────────────────────────────────────────────
const C = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
  cyan:   '\x1b[36m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  red:    '\x1b[31m',
  gray:   '\x1b[90m',
};

function banner(text) {
  const line = '\u2500'.repeat(60);
  console.log(`\n${C.cyan}${line}${C.reset}`);
  console.log(`${C.bold}${C.cyan}  ${text}${C.reset}`);
  console.log(`${C.cyan}${line}${C.reset}\n`);
}

function pass(label, detail = '') {
  const suffix = detail ? `  ${C.gray}${detail}${C.reset}` : '';
  console.log(`  ${C.green}\u2713${C.reset} ${C.bold}${label}${C.reset}${suffix}`);
}

function fail(label, detail = '') {
  const suffix = detail ? `  ${C.gray}${detail}${C.reset}` : '';
  console.log(`  ${C.red}\u2717${C.reset} ${C.bold}${label}${C.reset}${suffix}`);
}

function info(text) {
  console.log(`  ${C.yellow}\u2139${C.reset} ${C.dim}${text}${C.reset}`);
}

// ── System prompt (mirrors lib/agent.ts) ─────────────────────────────────────
const SYSTEM_PROMPT = `You are an expert Qubic smart contract developer. \
Qubic uses QPI (Qubic Programming Interface), a sandboxed subset of C++. \
Contracts run directly on 676 Computors hardware — not a VM. \
You must follow QPI rules exactly.

TYPES — Only QPI types allowed:
- Primitives: bit, uint8, uint16, uint32, uint64, sint8, sint16, sint32, sint64, id
- Containers: Array<T,L>, BitArray<L>, Collection<T,L>, HashMap<K,V,L>, HashSet<K,L> (L must be power of 2)
- BANNED: bool, int, char, float, double, long, short, pointers, std::anything, [] notation

OPERATORS:
- BANNED: / and %
- USE INSTEAD: div(a,b) and mod(a,b) — return 0 on division by zero

CONTRACT STRUCTURE (mandatory):
  using namespace QPI;
  struct MYCONTRACT : public ContractBase {
  public:
      struct MyFunc_input  { /* fields */ };
      struct MyFunc_output { /* fields */ };
  private:
      uint64 myVar;
      PUBLIC_FUNCTION(MyFunc) { /* read-only, no state mutation */ }
      PUBLIC_PROCEDURE(MyProc) { /* read+write, can qpi.transfer() */ }
      REGISTER_USER_FUNCTIONS_AND_PROCEDURES {
          REGISTER_USER_FUNCTION(MyFunc, 1);
          REGISTER_USER_PROCEDURE(MyProc, 1);
      }
      INITIALIZE { state.myVar = 0; }
  };

LOCAL VARIABLES: Forbidden on the stack. Use _WITH_LOCALS macro:
  struct MyProc_locals { uint64 temp; };
  PUBLIC_PROCEDURE_WITH_LOCALS(MyProc) { locals.temp = 0; }

FUNCTION vs PROCEDURE:
- PUBLIC_FUNCTION: read-only, called via RequestContractFunction
- PUBLIC_PROCEDURE: read+write, called via broadcast-transaction

ORACLE MACHINES:
- Price Interface (Index 0): query BTC/USDT, ETH/USDT, SOL/USDT, etc.
- Test Interface (Index 1): echo uint64 value back doubled (for testing)
- Expected latency: 3-5 ticks (~10 seconds)
- Query cost: 10 QU burned permanently per query

DEPLOYMENT (not like Ethereum):
1. Write .h file in qubic/core src/contracts/
2. Submit PR — reviewed by core devs
3. Multi-node testnet validation
4. Submit GQMPROP proposal (epoch N) — 451+ Computor votes needed
5. IPO epoch N+1 (QU burned for fee reserve)
6. Contract live epoch N+2

RPC endpoints:
- Mainnet: https://rpc.qubic.org
- Testnet: https://testnet-rpc.qubicdev.com`;

// ── LLM call ──────────────────────────────────────────────────────────────────
const ENDPOINTS = {
  google: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
  openai: 'https://api.openai.com/v1/chat/completions',
};

async function callLLM(messages, opts = {}) {
  const provider = opts.provider || PROVIDER;
  const model    = opts.model    || MODEL;
  const apiKey   = opts.apiKey   || API_KEY;
  const url      = ENDPOINTS[provider] || ENDPOINTS.google;

  if (VERBOSE) {
    console.log(`${C.gray}  [LLM] POST ${url} model=${model}${C.reset}`);
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, messages, max_tokens: 1024 }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content || '';
  const usage   = data.usage || null;

  if (VERBOSE && usage) {
    console.log(`${C.gray}  [LLM] tokens: prompt=${usage.prompt_tokens} completion=${usage.completion_tokens}${C.reset}`);
  }

  return { content, usage };
}

// ── Assertion helpers ─────────────────────────────────────────────────────────
function assertContains(text, ...keywords) {
  const lower = text.toLowerCase();
  for (const kw of keywords) {
    if (!lower.includes(kw.toLowerCase())) {
      throw new Error(`Expected response to contain "${kw}"\n     Got: ${text.slice(0, 200)}`);
    }
  }
}

// ── Static analysis unit tests (no API call) ─────────────────────────────────
function runStaticTests() {
  banner('Static Analysis Regex Tests  (no API call)');

  const cases = [
    ['Detects banned bool',             /\bbool\b/.test('bool isActive;')],
    ['Detects banned naked int',        /(?<![us]int)\bint\b(?!8|16|32|64)/.test('int x;')],
    ['Allows uint64',                   !/(?<![us]int)\bint\b(?!8|16|32|64)/.test('uint64 x;')],
    ['Allows sint32',                   !/(?<![us]int)\bint\b(?!8|16|32|64)/.test('sint32 y;')],
    ['Detects % operator',              'x = a % 2'.includes('%')],
    ['Detects / operator (bare)',       /[^a-zA-Z]\/[^/\*]/.test('x = a / b;')],
    ['div() no false-positive',         !/[^a-zA-Z]\/[^/\*]/.test('x = div(a, b);')],
    ['Detects [] bracket notation',     /\w+\s*\[\s*\d*\s*\]/.test('int arr[10];')],
    ['Detects missing ContractBase',    !'struct FOO {};'.includes('ContractBase')],
    ['Non-power-of-2 cap flagged (10)', (() => { const c = 10; return c > 0 && (c & (c - 1)) !== 0; })()],
    ['Power-of-2 cap passes (16)',      (() => { const c = 16; return !((c > 0) && ((c & (c - 1)) !== 0)); })()],
    ['Detects double underscore',       /__/.test('__hiddenVar')],
    ['Detects dynamic memory (new)',    /\bnew\s/.test('int* p = new int();')],
    ['Detects variadic args',           /\.\.\./.test('void foo(int ...args)')],
    ['Detects goto',                    /\bgoto\b/.test('goto label;')],
    ['Detects inline assembly',         /\b(asm|__asm)\b/.test('asm("nop");')],
    ['Identifier validation (safe)',    /^[A-Za-z_]\w*$/.test('myVar_1')],
    ['Identifier validation (unsafe)',  !/^[A-Za-z_]\w*$/.test('123bad')],
  ];

  let passed = 0;
  let failed = 0;

  for (const [label, result] of cases) {
    if (result) { pass(label); passed++; }
    else        { fail(label); failed++; }
  }

  console.log(`\n  ${C.bold}${passed}/${cases.length} passed${C.reset}${failed ? `  ${C.red}(${failed} failed)${C.reset}` : ''}\n`);
  return { passed, failed, total: cases.length };
}

// ── LLM integration tests ────────────────────────────────────────────────────
const LLM_TESTS = [
  {
    name: 'API connectivity (ping)',
    async run() {
      const { content } = await callLLM([
        { role: 'system', content: 'Reply with the single word PONG and nothing else.' },
        { role: 'user',   content: 'PING' },
      ]);
      if (!content.trim().toUpperCase().includes('PONG')) {
        throw new Error(`Expected PONG, got: ${content.slice(0, 80)}`);
      }
    },
  },
  {
    name: 'QPI type system knowledge',
    async run() {
      const { content } = await callLLM([
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: 'What replaces bool in QPI and why is char forbidden? Answer in 2 sentences.' },
      ]);
      assertContains(content, 'bit');
    },
  },
  {
    name: 'Division operator knowledge',
    async run() {
      const { content } = await callLLM([
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: 'How do you divide two numbers in QPI? Why is / banned?' },
      ]);
      assertContains(content, 'div');
    },
  },
  {
    name: 'Contract generation (COUNTER)',
    async run() {
      const { content } = await callLLM([
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: 'Generate a minimal QPI smart contract called COUNTER with one PUBLIC_PROCEDURE Increment that increments a uint64 counter. Include all required blocks.' },
      ]);
      assertContains(content, 'ContractBase', 'uint64', 'REGISTER_USER_FUNCTIONS_AND_PROCEDURES', 'INITIALIZE');
    },
  },
  {
    name: 'Audit identifies banned types',
    async run() {
      const flawed = `struct MY_CONTRACT : public ContractBase {
  bool isActive;
  int counter;
  PUBLIC_PROCEDURE(DoSomething) {
    state.counter = state.counter / 2;
  }
};`;
      const { content } = await callLLM([
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: `List all QPI violations in this contract:\n\`\`\`cpp\n${flawed}\n\`\`\`` },
      ]);
      assertContains(content, 'bool');
    },
  },
  {
    name: 'Oracle Machine knowledge',
    async run() {
      const { content } = await callLLM([
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: 'How do I query BTC/USDT price using Qubic Oracle Machines? What interface index?' },
      ]);
      assertContains(content, 'price');
    },
  },
  {
    name: 'Deployment governance',
    async run() {
      const { content } = await callLLM([
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: 'How is a Qubic smart contract deployed to mainnet? Describe the governance process briefly.' },
      ]);
      const lower = content.toLowerCase();
      if (!lower.includes('proposal') && !lower.includes('computor') && !lower.includes('vote') && !lower.includes('451')) {
        throw new Error('Should mention governance (proposal/vote/computors)');
      }
    },
  },
  {
    name: 'RPC endpoint knowledge',
    async run() {
      const { content } = await callLLM([
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: 'What is the Qubic mainnet RPC endpoint URL?' },
      ]);
      assertContains(content, 'rpc.qubic.org');
    },
  },
];

// ── Main runner ───────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${C.bold}${C.cyan}Qubic Agent CLI Test Harness${C.reset}`);
  console.log(`${C.gray}  Provider: ${PROVIDER}  Model: ${MODEL}  Key: ${API_KEY ? API_KEY.slice(0, 6) + '...' : '(none)'}${C.reset}`);

  // 1) Static tests (always run)
  const staticResult = runStaticTests();

  // 2) LLM tests (require API key)
  let llmPassed = 0;
  let llmFailed = 0;
  let llmSkipped = 0;

  if (!API_KEY) {
    banner('LLM Integration Tests  (SKIPPED — no API key)');
    info('Set --key, GOOGLE_API_KEY, or OPENAI_API_KEY to run LLM tests');
    llmSkipped = LLM_TESTS.length;
  } else {
    banner('LLM Integration Tests');

    for (const test of LLM_TESTS) {
      if (FILTER !== 'all' && !test.name.toLowerCase().includes(FILTER)) {
        llmSkipped++;
        continue;
      }

      try {
        await test.run();
        pass(test.name);
        llmPassed++;
      } catch (err) {
        fail(test.name, err.message?.slice(0, 120));
        llmFailed++;
      }
    }

    const llmTotal = llmPassed + llmFailed;
    console.log(`\n  ${C.bold}${llmPassed}/${llmTotal} passed${C.reset}${llmFailed ? `  ${C.red}(${llmFailed} failed)${C.reset}` : ''}${llmSkipped ? `  ${C.gray}(${llmSkipped} skipped)${C.reset}` : ''}\n`);
  }

  // Summary
  banner('Summary');
  const totalPassed  = staticResult.passed + llmPassed;
  const totalFailed  = staticResult.failed + llmFailed;
  const totalSkipped = llmSkipped;
  const totalRun     = totalPassed + totalFailed;

  console.log(`  Static: ${C.green}${staticResult.passed}${C.reset}/${staticResult.total}`);
  console.log(`  LLM:    ${C.green}${llmPassed}${C.reset}/${llmPassed + llmFailed}${totalSkipped ? ` (${totalSkipped} skipped)` : ''}`);
  console.log(`  Total:  ${C.bold}${totalPassed}/${totalRun}${C.reset}\n`);

  process.exit(totalFailed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(`${C.red}Fatal:${C.reset}`, err);
  process.exit(2);
});
