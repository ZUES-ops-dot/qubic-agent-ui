# QForge -- AI Smart Contract IDE for Qubic

![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=nextdotjs)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)
![Tailwind](https://img.shields.io/badge/Tailwind-4-38B2AC?logo=tailwindcss&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-green)
![Status](https://img.shields.io/badge/status-active-brightgreen)

> Generate, audit, and deploy Qubic QPI smart contracts from natural language. Reduces a 2-hour audit cycle to under 30 seconds with a 30-rule static analyzer, AI-assisted fix suggestions, and a sandboxed Dev Kit deploy bridge.

**Live demo:** _coming soon_ · **[Architecture](#architecture)** · **[Quick Start](#quick-start)**

---

## What problem this solves

Qubic's QPI (Quorum Programming Interface) is a constrained C++ subset with rules that the standard compiler does not enforce -- invalid contracts only fail at testnet deploy time, often after hours of dev work. QForge catches these violations in the editor, suggests AI-generated fixes against a local QPI knowledge base, and one-click deploys to testnet through a sandboxed bridge.

**Before QForge:** Write contract → push to testnet → wait for tick → read cryptic error → repeat.
**With QForge:** Type intent → AI scaffolds contract → 30 static checks run inline → one-click deploy.

## Highlights

- **AI contract generation** -- natural-language → compilable QPI via OpenAI function calling, Anthropic, or Google Gemini (BYO API key, encrypted client-side with AES-GCM)
- **30-rule static analyzer** -- catches forbidden ops, division-by-zero, state mutation outside transactions, oracle misuse, and more, with severity triage
- **Local BM25 RAG engine** -- `lib/rag.ts` indexes the official QPI docs and 50+ vetted contract patterns at module load. Zero external vector DB. Offline-capable.
- **Sandboxed Dev Kit bridge** -- opt-in shell execution wrapped through a configurable sandbox template, with mainnet gating, output truncation, timeouts, and audit logging
- **Audit trail** -- every generation/deploy attempt logged with IP, user agent, request ID, and structured metadata via `lib/audit.ts`
- **Rate limiting** -- 10 req/min/IP middleware on all API routes

## Architecture

```
┌────────────────────────────────────────────────────────────────┐
│  Browser                                                        │
│  ┌──────────────┐  ┌──────────────┐  ┌─────────────────────┐  │
│  │  Editor UI   │→ │  Local RAG   │→ │  Static Analyzer    │  │
│  │ (Next.js 16) │  │  (BM25, TS)  │  │  (30 QPI rules)     │  │
│  └──────────────┘  └──────────────┘  └─────────────────────┘  │
│         │                                       │              │
│         │  AES-GCM encrypted API keys           │              │
└─────────┼───────────────────────────────────────┼──────────────┘
          ▼                                       ▼
   ┌────────────┐    ┌──────────────────────────────────┐
   │  LLM API   │    │  Next.js API Routes              │
   │ OpenAI /   │    │  /api/audit       /api/devkit    │
   │ Gemini /   │    │  /api/oracle/toolkit             │
   │ Anthropic  │    └─────────────┬────────────────────┘
   └────────────┘                  │
                                   ▼
                        ┌──────────────────────────────┐
                        │  Sandboxed shell exec        │
                        │  • timeout, output cap       │
                        │  • workspace cleanup         │
                        │  • mainnet gate              │
                        └─────────┬────────────────────┘
                                  ▼
                        ┌──────────────────────────────┐
                        │  Qubic testnet RPC           │
                        │  rpc.qubic.org / testnet-rpc │
                        └──────────────────────────────┘
```

## Tech stack

| Layer | Tech |
|-------|------|
| Frontend | Next.js 16 (App Router), React 19, Tailwind CSS 4, Radix UI |
| Backend | Next.js API routes (Node runtime), `node:child_process`, `node:fs` |
| AI | OpenAI function calling, Anthropic Claude, Google Gemini |
| Retrieval | Pure-TS BM25 over `data/qpi-contracts.json` + official Qubic docs |
| Crypto | Web Crypto API (AES-GCM) for client-side key storage |
| Blockchain | Qubic RPC v1 (mainnet + testnet) |
| Observability | Structured audit logs (`lib/audit.ts`), per-IP rate limiting |

## Quick Start

```bash
git clone https://github.com/ZUES-ops-dot/qubic-agent-ui.git
cd qubic-agent-ui
npm install
npm run dev
```

Open <http://localhost:3000>, click **Settings**, and paste an OpenAI or Google Gemini API key. The key is AES-GCM encrypted in `localStorage` and never sent to the server.

### Build for production

```bash
npm run build
npm run lint
```

## Configuration

The Dev Kit bridge and Oracle Toolkit bridge are **opt-in** for safety. The default deployment is read-only against the public Qubic RPC.

```env
# Enable real compile/deploy (otherwise dry-run only)
QUBIC_DEVKIT_ENABLE_EXEC=1
QUBIC_DEVKIT_SANDBOX_CMD=docker run --rm -v {workspace}:/work {command}
QUBIC_DEVKIT_COMPILE_CMD=qubic-cli compile {contract_file}
QUBIC_DEVKIT_DEPLOY_CMD=qubic-cli deploy {contract_file} --network {network}
QUBIC_DEVKIT_TIMEOUT_MS=180000

# Mainnet is blocked by default
QUBIC_DEVKIT_ALLOW_MAINNET=0

# Optional bridge auth
QUBIC_DEVKIT_BRIDGE_TOKEN=shared_secret
```

Command templates substitute `{contract_file}`, `{contract_name}`, `{workspace}`, `{network}`, `{rpc_url}`.

## Repository layout

```
app/                      Next.js App Router pages
  api/audit/             Audit log POST endpoint
  api/devkit/pipeline/   Sandboxed compile/deploy bridge (~620 LOC)
  api/oracle/toolkit/    Oracle Machine query bridge
  settings/              API key management UI
components/              Radix-based UI primitives
data/qpi-contracts.json  RAG knowledge base
lib/
  agent.ts               LLM orchestration with tool calls (~1200 LOC)
  rag.ts                 BM25 search engine (~310 LOC, zero deps)
  crypto.ts              AES-GCM key storage
  testnet.ts             Qubic RPC client
  audit.ts               Structured event logging
  storage.ts             Settings persistence
middleware.ts            Per-IP rate limiter (10 req/min)
```

## Roadmap

See the [Issues](https://github.com/ZUES-ops-dot/qubic-agent-ui/issues) tab for tracked work, including Claude 3.5 Sonnet support, PDF audit export, and large-contract deploy timeouts.

## License

MIT -- see [LICENSE](LICENSE).
