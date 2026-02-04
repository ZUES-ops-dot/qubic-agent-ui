# Qubic Agent UI

Development assistant for Qubic QPI smart contracts. Generates, audits, simulates, and deploys QPI code through a conversational interface backed by OpenAI/Google Gemini and an in-app QPI knowledge base.

## Quick Start

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. Enter your OpenAI or Google API key in Settings.

## Build

```bash
npm run build
npm run lint
```

## Environment

API keys are entered in the browser and stored client-side (AES-GCM encrypted localStorage, with legacy fallback support for previously stored values).

## In-App RAG (Default)

This project uses a **local, in-app retrieval engine** by default:

- BM25-style search over `data/qpi-contracts.json`
- No external vector database required
- No backend RAG provisioning step required
- Offline-capable retrieval once the app is loaded

Current local knowledge base size: **50 entries** (sourced from official Qubic docs, qubic/core, and contracts.md).

Implementation details:

- `lib/rag.ts` — in-app index + retrieval functions
- `lib/supabase.ts` — legacy compatibility facade delegating to local RAG

## Connectivity Defaults (Important)

By default, this app has **mixed live/offline behavior**:

- **RPC status checks: live by default** (uses public Qubic testnet RPC)
- **Dev Kit compile/deploy: testnet only, disabled by default** until server env vars are configured
- **Oracle query submission: disabled by default** unless a local Qubic.Net Toolkit instance is running
- **Mainnet deployment is not possible through this tool** — it requires computor voting (451/676) and a successful IPO per the Qubic smart contract lifecycle

### 1) Public RPC (live by default)

The app checks real network status using public Qubic RPC:

- Mainnet: `https://rpc.qubic.org`
- Testnet: `https://testnet-rpc.qubicdev.com`

Official reference: https://docs.qubic.org/api/rpc/

### 2) Dev Kit bridge (opt-in)

The Dev Kit pipeline does **not** execute by default. You must explicitly enable it with server-side environment variables.

Official reference: https://docs.qubic.org/developers/dev-kit/

Optional server-side variables for the Dev Kit pipeline bridge:

```env
QUBIC_DEVKIT_ENABLE_EXEC=1
QUBIC_DEVKIT_COMPILE_CMD=compile_command_{contract_file}
QUBIC_DEVKIT_DEPLOY_CMD=deploy_command_{contract_file}_{network}
QUBIC_DEVKIT_VERIFY_CMD=verify_command
QUBIC_DEVKIT_TIMEOUT_MS=180000
QUBIC_DEVKIT_KEEP_WORKSPACE=0
QUBIC_DEVKIT_ALLOW_MAINNET=0
QUBIC_DEPLOY_RPC=https://testnet-rpc.qubicdev.com
QUBIC_DEVKIT_BRIDGE_TOKEN=shared_secret
QUBIC_DEVKIT_ALLOW_REMOTE=0
```

Mainnet deploy is blocked by default. Set `QUBIC_DEVKIT_ALLOW_MAINNET=1` to enable.

Command templates accept: `{contract_file}`, `{contract_name}`, `{workspace}`, `{network}`, `{rpc_url}`.

### 3) Oracle Toolkit bridge (local Toolkit required)

Oracle payloads are built in-app, but query submission requires a **running local Qubic.Net Toolkit** (localhost/127.0.0.1).

- Typical local URL used by this app: `http://127.0.0.1:5060`
- Query fee noted by official Toolkit guide: `10 QU` per query

Official references:

- https://docs.qubic.org/developers/oracles/
- https://qubic.org/blog-detail/how-to-query-qubic-oracle-machines-using-the-qubic.net-toolkit

See [QFORGE.md](./QFORGE.md) for full technical documentation.
