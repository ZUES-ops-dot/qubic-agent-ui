# Qubic Agent UI -- Technical Reference

## What This Tool Does

Qubic Agent UI is a browser-based development assistant purpose-built for Qubic's QPI (Qubic Programming Interface) smart contracts. QPI is a restricted subset of C++ that runs natively on Qubic's 676 Computors -- it bans standard types, operators, pointers, and dynamic memory. General-purpose LLMs produce invalid QPI output without guidance.

This tool solves that by combining a QPI-accurate system prompt, a local knowledge base of real contract code, and a structured tool-calling pipeline so the LLM generates compilable QPI from natural language.

### Core Workflow

1. **Generate** -- Describe a contract in plain English. The LLM produces QPI code using correct types (`uint64`, `sint32`, `id`, `bit`), operators (`div()`, `mod()`), macros (`PUBLIC_PROCEDURE`, `REGISTER_USER_FUNCTIONS_AND_PROCEDURES`), and patterns (`_WITH_LOCALS`, invocation reward handling).

2. **Audit** -- Paste contract source into the audit workbench. A 30-check static analyzer flags banned types, missing registrations, state mutation inside `PUBLIC_FUNCTION`, missing reward refunds, and other QPI-specific issues. The LLM provides deeper analysis with severity scores and fix recommendations. One-click auto-fix runs a multi-turn self-correction loop.

3. **Simulate** -- Deploy contract code to testnet (via Dev Kit bridge when enabled) or local fallback mode. Run simulated users against it and view metrics. Contract source can be edited directly or handed off from chat.

4. **Deploy** -- The Dev Kit pipeline bridge executes real compile and deploy shell commands on the host machine, with network selection (testnet/mainnet), workspace cleanup, payload size limits, and mainnet gating.

5. **Oracle Builder** -- Compose Oracle Machine query payloads (price feed, test interface) with hex/base64 preview. Submit to a local Qubic.Net Toolkit instance via the bridge proxy.

---

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Framework | Next.js (App Router) | 16.0.10 |
| Runtime | React | 19.x |
| Language | TypeScript (strict) | 5.x |
| Styling | Tailwind CSS | 4.x |
| Animation | Framer Motion | 12.x |
| Icons | Lucide React | -- |
| UI Primitives | Radix UI | -- |
| Charts | Recharts | 2.x |
| LLM | OpenAI + Google Gemini | Configurable |
| RAG Backend | In-app BM25 (local JSON knowledge base) | Default (offline-capable) |
| Persistence | localStorage (encrypted) | Client-side |
| Pipeline Bridge | Node.js child_process | Server-side, opt-in |

### Key Dependencies

- `openai` -- Chat completions with tool/function calling
- `sonner` -- Toast notifications
- `recharts` -- Radar and bar charts for audit/simulation metrics
- `framer-motion` -- Page transitions and card animations
- `@radix-ui/react-scroll-area` -- Scrollable containers

---

## Project Structure

```
qubic-agent-ui/
  app/
    page.tsx              Chat interface (main entry point)
    audit/page.tsx        Security audit workbench + Dev Kit pipeline controls
    simulate/page.tsx     Contract simulation with deploy + run
    oracle/page.tsx       Oracle Machine payload builder
    history/page.tsx      Chat session history browser
    settings/page.tsx     API key, model, Dev Kit, and Oracle Toolkit config
    patterns/page.tsx     Searchable QPI pattern library
    api/
      chat/route.ts       Legacy server-side chat endpoint
      devkit/pipeline/route.ts   Dev Kit compile/deploy bridge
      oracle/toolkit/route.ts    Local Toolkit proxy (localhost-only)
  components/
    sidebar.tsx           Collapsible navigation with active-route highlighting
    ui/
      button.tsx          Base button component
      cyber-card.tsx      Themed card with glow effects
      code-block.tsx      Syntax-highlighted code rendering
      scroll-area.tsx     Radix scroll container
      toast.tsx           Toast notification system
  lib/
    agent.ts              LLM orchestration: system prompt, tool definitions,
                          tool execution, streaming, static analysis (30 checks)
    devkit.ts             Dev Kit pipeline client types and helpers
    testnet.ts            Deployment and simulation runtime (real + local fallback)
    oracle.ts             Oracle payload encoding and bridge utilities
    storage.ts            localStorage wrapper: settings, history, pending contracts
    crypto.ts             AES-GCM encryption with legacy compatibility fallback
    rag.ts                In-app BM25 RAG engine + local knowledge base statistics
    supabase.ts           Legacy facade delegating to local rag.ts for compatibility
    utils.ts              General utilities
  data/
    qpi-contracts.json    Local RAG knowledge base (50 entries)
    qubic-official-docs.md  Full Qubic documentation reference
  types/
    index.ts              Shared TypeScript interfaces
```

---

## RAG Knowledge Base

The file `data/qpi-contracts.json` contains 50 entries sourced from official Qubic documentation (`docs.qubic.org`), `qubic/core`, `contracts.md`, and related repositories, including:

| Entry | Source | Type |
|-------|--------|------|
| Basic contract skeleton (RANDOM/HM25) | qubic-hackathon | Template with real mainnet contract code |
| Invocation reward handling patterns | qubic/core | Security pattern |
| Container types (Array, HashMap, etc.) | qubic/core | Reference |
| System procedures (INITIALIZE, epochs, ticks) | qubic/core | Reference |
| `_WITH_LOCALS` pattern | qubic/core | Pattern |
| PUBLIC vs PRIVATE access control | qubic/core | Reference |
| C++ restrictions (official from contracts.md) | qubic/core | Reference |
| Deployment process (proposal, vote, IPO) | qubic/core | Reference |
| Asset management (issueAsset, shares) | qubic/core | Reference |
| RPC API endpoints (testnet + mainnet) | qubic-hackathon | Reference |
| Frontend contract interaction (JS) | qubic-hackathon | Reference |
| Oracle Machines architecture | qubic-docs | Reference |
| Oracle consumer contract pattern | qubic-docs | Contract example |
| POST_INCOMING_TRANSFER callback | contracts.md | Reference |
| uint64 overflow vulnerability | Security research | Vulnerability |
| Invocation reward lock vulnerability | Security research | Vulnerability |
| State-in-function silent bug | Security research | Vulnerability |
| Epoch boundary race conditions | Security research | Vulnerability |
| HashMap cleanup pattern | contracts.md | Pattern |
| Proposals and voting | contracts.md | Reference |
| Cross-contract calls | contracts.md | Reference |
| RANDOM/lottery pattern | qubic/core | Contract example |
| Token/asset issuance pattern | contracts.md | Contract example |

The contract code in these entries is real QPI derived from `qubic/core`, `qubic/qubic-hackathon`, and `docs.qubic.org`. It is not placeholder or mock code.

Additional entries extend coverage across QX order books, cross-contract calls, ABI/input-size validation, state schema versioning, event logging constraints, tick-time logic, oracle subscriptions, QU burn budgeting, smart contract lifecycle (PR → vote → IPO → live), contract registration in `contract_def.h`, GoogleTest testing patterns, Qubic CLI interaction, assets/shares management, QNS reference, and style guide conventions.

Retrieval is fully local: `lib/rag.ts` builds an in-memory BM25-style index at runtime and serves contract, vulnerability, and pattern lookups without any external vector database.

---

## Static Analysis (30 Checks)

The `analyzeContract()` function in `lib/agent.ts` runs these checks before LLM analysis:

**Syntax (15 checks):**
Banned native types, banned operators (`/`, `%`), pointer usage, array bracket notation, preprocessor directives, string/char literals, missing `using namespace QPI`, missing `ContractBase` inheritance, missing `REGISTER` block, missing `INITIALIZE`, missing `_input`/`_output` structs, double underscore usage, `union` keyword, variadic arguments, scope resolution misuse.

**Semantic (15 checks):**
State modification in `PUBLIC_FUNCTION`, `qpi.transfer` in functions, `qpi.invocator()` misuse in `POST_INCOMING_TRANSFER`, registration count mismatch, duplicate registration indices, non-power-of-2 container capacity, complex types in I/O structs, unbounded loops in tick hooks, integer overflow patterns, missing `INITIALIZE`, asset name validation, HashMap cleanup absence, procedure-calls-procedure chains, oracle pattern detection, recursion depth.

---

## Security Model

- **API keys and local tokens** are encrypted using AES-GCM when Web Crypto is available; legacy prefixed formats (`apiv1:` / `encv1:`) are still readable for backward compatibility.
- **Dev Kit bridge tokens** are stored locally encrypted and sent as `x-devkit-token` header.
- **Pipeline bridge** requires `QUBIC_DEVKIT_ENABLE_EXEC=1` on the host. Remote access is blocked unless `QUBIC_DEVKIT_ALLOW_REMOTE=1`.
- **Mainnet deploy** requires explicit `QUBIC_DEVKIT_ALLOW_MAINNET=1` plus user confirmation in the UI.
- **Request limits**: 768 KB max request body, 512 KB max contract source.
- **Workspace cleanup**: Temporary directories are deleted after each pipeline run unless `QUBIC_DEVKIT_KEEP_WORKSPACE=1`.
- **Oracle toolkit bridge** only accepts requests targeting `127.0.0.1` / `localhost`.

---

## Tool-Calling Pipeline

The chat LLM has access to four tools:

| Tool | Purpose |
|------|---------|
| `search_contracts` | Search RAG knowledge base for QPI contract patterns and references |
| `search_vulnerabilities` | Search for known QPI vulnerability patterns |
| `analyze_contract` | Run static analysis + LLM audit on pasted contract code |
| `verify_and_fix` | Multi-turn self-correction: analyze, auto-fix banned types / missing namespace / missing INITIALIZE, re-analyze (up to 3 iterations) |

Both streaming and non-streaming chat paths resolve through the same tool-calling loop in `lib/agent.ts`.

---

## Network Configuration

| Network | RPC Endpoint |
|---------|-------------|
| Testnet | `https://testnet-rpc.qubicdev.com` |
| Mainnet | `https://rpc.qubic.org` |

The preferred deployment network is stored in Settings and shared across Audit and Simulation pages. The Dev Kit pipeline bridge status endpoint checks RPC reachability for the selected network.

### Connectivity Defaults

This project does **not** connect everything live by default:

- **Live by default:** RPC status checks against public Qubic endpoints.
- **Opt-in:** Dev Kit compile/deploy execution (`QUBIC_DEVKIT_ENABLE_EXEC=1` plus command templates).
- **Local dependency:** Oracle submission requires a running local Qubic.Net Toolkit instance (`localhost` / `127.0.0.1`).

Official references used to validate this behavior:

- Qubic RPC docs: https://docs.qubic.org/api/rpc/
- Qubic Dev Kit docs: https://docs.qubic.org/developers/dev-kit/
- Oracle docs: https://docs.qubic.org/developers/oracles/
- Toolkit oracle query guide: https://qubic.org/blog-detail/how-to-query-qubic-oracle-machines-using-the-qubic.net-toolkit
