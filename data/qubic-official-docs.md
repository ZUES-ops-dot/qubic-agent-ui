# Qubic Official Documentation — Knowledge Base

> Compiled from docs.qubic.org, qubic/core, qubic/qubic-cli, qubic/qubic-dev-kit, and related resources.

---

## Smart Contract Overview

QUBIC smart contracts are decentralized C++ programs that execute directly on baremetal hardware, eliminating the need for traditional operating systems or virtual machines. This low-level execution model provides high performance, low latency, and fine-grained control over computation. Unlike conventional blockchain platforms, QUBIC offers a unique architecture where contracts run closer to the hardware, ensuring deterministic and efficient execution across the network.

Each smart contract can be launched through an IPO (Initial Public Offering), a mechanism that gathers community support and allocates computing resources to the contract. This system ensures that only valuable and trusted computations receive execution time, making QUBIC smart contracts efficient, scalable, and suitable for advanced decentralized applications.

### Key Features

1. **Baremetal Execution** — Smart contracts run directly on the hardware—without an OS, VM, or container layer—allowing extremely low-level control, high-speed execution, and minimal overhead.

2. **IPO-Based Deployment (Initial Public Offering)** — Each contract must be proposed through a voting process, where the computor allocates compute resources for its execution. If the proposal is accepted, the contract will be integrated into the core code, after which the IPO process takes place. If all shares are successfully sold during the IPO, the contract will be constructed.

3. **No Virtual Machine, No Gas Model** — There is no EVM-like gas mechanism. Instead, compute resources are provisioned via IPO and scheduled execution, avoiding the need for micro-fees or instruction-based billing.

### From Code to Mainnet

Building a smart contract is only the first step. Before your contract runs on mainnet, it goes through testing, PR review, computor voting, and an IPO phase. See the complete Smart Contract Lifecycle section below.

---

## Qubic Programming Interface (QPI)

QPI stands for Qubic Programming Interface — a carefully designed and restricted programming interface used to develop smart contracts in the Qubic protocol.

Unlike general-purpose C++ programming, QPI provides a safe, deterministic, and sandboxed environment that ensures all contracts behave consistently across all nodes in the Qubic network.

### Why QPI Exists

In a distributed, consensus-driven system like Qubic, nondeterminism is dangerous. If different nodes compute different results from the same contract call, the network breaks down.

QPI solves this by:

- Restricting unsafe features of C++ (like pointers, floats, raw memory access).
- Disallowing standard libraries to avoid system-dependent behavior.
- Providing a strict interface that all contracts must use to interact with the Core and with other contracts.

### What QPI Provides

| Capability | Description |
|---|---|
| Custom Data Types | Safe and deterministic types like `sint64`, `uint32`, `Array`, `BitArray`, `id`, etc. |
| Contract Communication | Allows running procedures and functions of other contracts. |
| Asset and Share Handling | Methods to issue, burn, transfer, and manage asset ownership. |
| Tick & Epoch Lifecycle Hooks | Contracts can react to epoch/tick transitions via `BEGIN_EPOCH()`, `END_TICK()`, etc. |
| Contract Metadata Access | Access to `qpi.invocator()`, `qpi.originator()`, `qpi.invocationReward()`, and similar context data. |
| Safe Arithmetic | Built-in functions like `div()`, `mod()` to avoid division-by-zero or float precision issues. |
| Cryptographic Functions | Cryptographic functionality through the K12 function (KangarooTwelve hash algorithm). |
| Memory Operations | Low-level memory operations: `copyMemory()`, `setMemory()` |

---

## Contract Structure

```cpp
using namespace QPI;

struct MYTEST2
{
};

struct MYTEST : public ContractBase
{
public:
    struct add_input
    {
        sint64 a;
        sint64 b;
    };

    struct add_output
    {
        sint64 out;
    };

    PUBLIC_FUNCTION(add)
    {
        output.out = input.a + input.b;
    }

    REGISTER_USER_FUNCTIONS_AND_PROCEDURES()
    {
        REGISTER_USER_FUNCTION(add, 1);
    }
};
```

### Key Elements

- `using namespace QPI;` — Brings all QPI symbols into scope.
- `struct MYTEST2` — Used for state expansion via EXPAND procedure (not yet implemented).
- `struct MYTEST : public ContractBase` — Main contract struct. Inheriting from `ContractBase` is **mandatory**.
- `REGISTER_USER_FUNCTIONS_AND_PROCEDURES()` — Registration block for making functions/procedures callable.

---

## Data Types

### Integers
Native integer types are **prohibited**. Use QPI types: `sint8`, `uint8`, `sint16`, `uint16`, `sint32`, `uint32`, `sint64`, `uint64`.

### Booleans
Represented by `bit` data type:
```cpp
bit isRight = true;
bit isWrong = false;
```

### Id
Represents user public key — 256 bits:
```cpp
id user1 = id(1,2,3,4);
```

### Array
Array of L elements of type T (L must be 2^N):
```cpp
Array<uint64, 4> arr;
arr.set(0, 1);
```

### BitArray
Array of L bits encoded in array of uint64 (L must be 2^N):
```cpp
BitArray<uint64, 4> arr;
arr.set(1, 0);
```

### HashMap
Hash map of (key, value) pairs (Length must be 2^N):
```cpp
HashMap<uint64, uint64, 4> map;
map.set(0, 1);
uint64 value;
map.get(0, value);
```

### HashSet
Hash set of keys (Length must be 2^N):
```cpp
HashSet<uint64, 4> set;
set.add(0);
```

### Collection
Collection of priority queues of elements (Length must be 2^N):
```cpp
Collection<uint64, 128> collection;
collection.add(id::zero(), 1, 1);
```

---

## Procedures and Functions

### Functions
- **Cannot** modify contract state
- Called via `RequestContractFunction` network message
- Executed immediately

```cpp
PUBLIC_FUNCTION(myFunc)
{
    // read-only code
}

PRIVATE_FUNCTION(myFunc)
{
    // only available within current contract
}
```

### Procedures
- **Can** modify state
- Invoked by transactions
- Scheduled execution at specific tick

```cpp
PUBLIC_PROCEDURE(updateBalance)
{
    state.balance += input.amount;
}

PRIVATE_PROCEDURE(updateBalance)
{
    state.balance += input.amount;
}
```

### Input & Output

```cpp
struct square_input
{
    sint64 x;
};

struct square_output
{
    sint64 result;
};

PUBLIC_FUNCTION(square)
{
    output.result = input.x * input.x;
}
```

### Local Variables

Local variable declaration on the stack is **forbidden**. Use `_WITH_LOCALS` macros:

```cpp
struct sumOneToTen_locals
{
    sint64 i;
};

PUBLIC_FUNCTION_WITH_LOCALS(sumOneToTen)
{
    for (locals.i = 1; locals.i <= 10; ++locals.i)
    {
        output.sum += locals.i;
    }
}
```

### Registration

```cpp
REGISTER_USER_FUNCTIONS_AND_PROCEDURES()
{
    REGISTER_USER_FUNCTION(myFunc, 1);
    REGISTER_USER_PROCEDURE(updateBalance, 2);
}
```

> Two functions or two procedures cannot share the same id. However, a function and a procedure can use the same id.

---

## System Procedures

| Procedure | Description |
|---|---|
| `INITIALIZE()` | Called once after successful IPO, before construction epoch begins |
| `BEGIN_EPOCH()` | Called at start of each epoch |
| `END_EPOCH()` | Called after each epoch ends |
| `BEGIN_TICK()` | Called before each tick is processed |
| `END_TICK()` | Called after all transactions in a tick |
| `PRE_RELEASE_SHARES()` | Called before transferring asset management rights out |
| `PRE_ACQUIRE_SHARES()` | Called before receiving asset management rights |
| `POST_RELEASE_SHARES()` | Called after transferring asset management rights out |
| `POST_ACQUIRE_SHARES()` | Called after receiving asset management rights |
| `POST_INCOMING_TRANSFER()` | Called after QUs transferred to this contract |

System procedures 1–5 have no input and output. Procedures 6–9 use asset management structs.

---

## Core QPI Functions

### qpi.invocator()
Returns the ID of the entity that directly called the current contract procedure.

Returns zero public key when called inside a function (unless function is called from a procedure).

### qpi.originator()
Returns the ID of the original transaction sender — the entity that initiated the entire call chain.

| Function | Returns | Example (Alice → ContractA → ContractB) |
|---|---|---|
| `originator()` | Original sender | Inside ContractB: Alice |
| `invocator()` | Immediate caller | Inside ContractB: ContractA |

### qpi.invocationReward()
Returns the amount of QU attached to the current contract call as an invocation reward.

### qpi.transfer()
Transfers QU from the contract's balance to another address.

```cpp
sint64 transfer(const id& destination, sint64 amount) const;
// Use NULL_ID to burn tokens
```

### qpi.burn()
Permanently removes QU from circulation.

> In the future, contracts will be required to burn QU to remain active.

### qpi.K12()
Computes a KangarooTwelve cryptographic hash, returning a 256-bit digest as `id` type.

### qpi.issueAsset()
Creates new digital assets on the Qubic network.

Parameters: `assetName` (up to 7 uppercase A-Z chars), `issuer`, `decimalPlaces`, `numberOfShares`, `unitOfMeasurement`.

### qpi.transferShareOwnershipAndPossession()
Transfers both legal ownership and physical possession of asset shares atomically.

### qpi.numberOfShares()
Gets total supply or user-specific balances of asset shares.

### qpi.getEntity()
Retrieves entity information (balance, transaction stats) from the ledger.

### Time/Date Functions
`qpi.year()`, `qpi.month()`, `qpi.day()`, `qpi.hour()`, `qpi.minute()`, `qpi.second()`, `qpi.millisecond()`, `qpi.tick()`, `qpi.epoch()`, `qpi.dayOfWeek()`

All return UTC values.

---

## States

The state is the persistent data of a contract — the member variables defined within the contract struct. It must remain identical across all nodes. The state is passed to functions & procedures as `state`.

```cpp
struct MYTEST : public ContractBase
{
public:
    sint64 myNumber;

    PUBLIC_PROCEDURE(changeNumber)
    {
        state.myNumber = input.myNumber;
    }

    // WRONG: function can't modify state
    // PUBLIC_FUNCTION(changeNumber)
    // {
    //     state.myNumber = input.myNumber;
    // }
};
```

Maximum contract state size: **1 GiB**.

---

## Inner-Contract Calls

```cpp
#define CALL(functionOrProcedure, input, output)
```

Define input/output for the call in `locals`:

```cpp
struct sumSquareOneToTen_locals
{
    square_input squareInput;
    square_output squareOutput;
};

PUBLIC_FUNCTION_WITH_LOCALS(sumSquareOneToTen)
{
    // ...compute sum...
    locals.squareInput.a = output.sum;
    CALL(square, locals.squareInput, locals.squareOutput);
    output.sum = locals.squareOutput.out;
}
```

---

## Cross-Contract Calls

```cpp
#define CALL_OTHER_CONTRACT_FUNCTION(contractStateType, function, input, output)
#define INVOKE_OTHER_CONTRACT_PROCEDURE(contractStateType, procedure, input, output, invocationReward)
```

Rules:
- ✅ Function → Function
- ✅ Procedure → Procedure
- ✅ Procedure → Function
- ❌ Function → Procedure (functions cannot modify state)

The called contract must have a **lower contract index**.

---

## Restrictions of C++ Language Features

| Prohibited Feature | Reason |
|---|---|
| Local variables on the stack | Use `_WITH_LOCALS` macros |
| Pointers (`*`, casting, dereferencing) | Unsafe. Only allowed for multiplication |
| Array brackets (`[]`) | Use `Array`, `HashMap`, etc. |
| Preprocessor directives (`#`) | Avoid hidden logic |
| Floating-point types (`float`, `double`) | Not deterministic across platforms |
| Division (`/`) and modulo (`%`) | Use `div()` and `mod()` instead |
| Strings (`"`) and chars (`'`) | Memory access violations risk |
| Variadic arguments (`...`) | Compiler-dependent |
| Double underscores (`__`) | Reserved for internal use |
| `QpiContext`, `const_cast` | Can alter internal behavior |
| Scope resolution (`::`) | Only for structs/enums/namespaces in contracts |
| `typedef`, `union` | Reduces code clarity |
| Global variables | Use contract state. Global constants must be prefixed with contract name |
| Recursion / deep call nesting | Limited to 10 levels |
| Complex types in input/output | Only simple types allowed |

---

## Smart Contract Style Guide

- **Functions/Procedures**: `camelCase`
- **Constants**: `ALL_CAPS`, prefixed with contract name (e.g., `MYTEST_FEE`)
- **Curly braces**: Always on new line
- **User-defined types**: Declared inside contract struct
- **Errors**: Declared as `enum ContractNameError`
- **`SELF`**: Contract id (public key) — equivalent to `id(CONTRACT_INDEX, 0, 0, 0)`
- **`SELF_INDEX`**: Contract index number
- **String**: Using `""` is prohibited. Use custom string implementations.
- **Initialization**: Always initialize state in `INITIALIZE()` procedure

---

## Smart Contract Lifecycle

### The Full Process

1. Research & Planning
2. Learn the Guidelines
3. Code the Contract
4. Unit Testing (GoogleTest)
5. Local Testnet
6. SC Verification Tool (`qubic-contract-verify`)
7. Security Audit (optional but recommended)
8. Create PR to `qubic/core` repository (`develop` branch)
9. Core Dev Review
10. Computor Proposal (Epoch X)
11. Voting Phase (451 of 676 computors must participate, majority approval)
12. IPO — Dutch Auction (Epoch X+1, all 676 shares must sell)
13. Contract Goes Live (Epoch X+2)

### Timeline

| Phase | Duration | Notes |
|---|---|---|
| Development (1–5) | Weeks to months | Depends on complexity |
| Verification + Audit (6–7) | 1–2 weeks | Audit highly recommended |
| PR Review (8–9) | 1–3 weeks | Submit 2–3 weeks before proposal |
| Proposal + Voting (10–11) | 1 epoch (~7 days) | Epoch X |
| IPO (12) | 1 epoch (~7 days) | Epoch X+1, all 676 shares must sell |
| Go Live (13) | Next epoch | Epoch X+2, automatic |

### Critical: IPO Must Succeed

All 676 shares must be sold. If the IPO fails, the contract is **permanently broken** — it cannot be re-IPO'd, the execution fee reserve stays at zero, and it can never be activated.

### Post-Launch

- **Bug fixes**: Regular PRs without new proposal
- **New features**: Require new computor proposal + voting
- **Execution fees**: Monitor and replenish via `qpi.burn()` or QUtil's `BurnQubicForContract`
- **Stay active**: Computors may remove unused contracts

---

## Adding Your Contract

### Naming Rules
- **Long name**: For filename (e.g., `YourContractName.h`)
- **Short name**: Max 7 capital letters/digits (e.g., `YCN`, used as asset name)
- **State struct**: Full uppercase (e.g., `YOURCONTRACTNAME`)

### Steps

1. Create `contracts/MyTest.h` with contract code
2. Define `CONTRACT_INDEX` and `STATE` in `contract_core/contract_def.h`
3. Add contract description with asset name, construction/destruction epoch, state size
4. Register with `REGISTER_CONTRACT_FUNCTIONS_AND_PROCEDURES(MYTEST)`

### Contract Description Format
```cpp
{"MYTEST", 999, 10000, sizeof(MYTEST)},
// {"ASSET_NAME", CONSTRUCTION_EPOCH, DESTRUCTION_EPOCH, SIZE_OF_STATE}
```

---

## Testing

### Test Setup
Test file: `contract_[lowercase_name].cpp`

```cpp
#define NO_UEFI
#include "contract_testing.h"

class ContractTestingMyTest : protected ContractTesting
{
public:
    ContractTestingMyTest()
    {
        initEmptySpectrum();
        initEmptyUniverse();
        INIT_CONTRACT(MYTEST);
    }

    MYTEST::add_output add(sint64 a, sint64 b)
    {
        MYTEST::add_input input;
        MYTEST::add_output output;
        input.a = a;
        input.b = b;
        callFunction(MYTEST_CONTRACT_INDEX, 1, input, output);
        return output;
    }
};

TEST(MyTest, TestAdd) {
    ContractTestingMyTest test;
    MYTEST::add_output output = test.add(1, 2);
    EXPECT_EQ(output.out, 3);
}
```

---

## Qubic Dev Kit

The Qubic Dev Kit manages:

- Complete Qubic development environment setup
- EFI file building
- Testnet node deployment with your smart contract
- RPC access for testing

### Requirements
- Visual Studio with "Desktop development with C++" workload
- Clone `https://github.com/qubic/core.git`
- Recommended: Use Qubic Core Lite repo for local testnet (no VM needed)

---

## Testnet

### Testnet Resources
- Public testnet node: `https://testnet-rpc.qubic.org`
- Faucet: Join Qubic Discord → `#bot-commands` channel
- Pre-funded seeds available for testing (each ~1 billion test QU)

### Deploying to Testnet
Requires setting up own Qubic node on virtual machine (or use Core Lite for local testnet):

- Server: 8+ CPU cores (AVX2), 64 GB RAM, 100 Mbps connection
- Build `Qubic.efi` from core repository
- Generate contract state file
- Package with epoch zip file
- Start node, enable MAIN/MAIN mode (F12 x3), broadcast computor list

### Monitoring
```bash
./qubic/scripts/qlogging 127.0.0.1 31841 1 2 3 4 21180000
```

---

## Qubic CLI

Intermediate tool for interacting with Qubic core node: sending QU, interacting with smart contracts, and remotely controlling the node.

### Call Contract Function
```bash
qubic-cli.exe -nodeip <IP> -nodeport <PORT> -sendrawpacket <HEX> <SIZE>
```

### Invoke Contract Procedure
```bash
qubic-cli.exe -seed <SEED> -nodeip <IP> -nodeport <PORT> \
  -sendcustomtransaction <CONTRACT_ID> <PROCEDURE_ID> <AMOUNT> <INPUT_SIZE> <INPUT_HEX>
```

Key difference: **Function calls are executed immediately; procedures are not** (they create transactions scheduled for a specific tick).

---

## Assets and Shares

### MYTEST Contract (Asset Example)
- `issueAsset`: Creates new assets with customizable parameters
- `releaseShares`: Transfers shares to other contracts with fixed fee (100 QU)

### CROSS Contract
- `acquireShares`: Receives incoming share transfers
- Designed to work with MYTEST's release mechanism

### Interaction Flow
1. MYTEST calls `releaseShares`
2. CROSS's `PRE_ACQUIRE_SHARES` validates fee
3. Qubic SC executes atomic transfer
4. Both contracts update states

---

## Qubic Name Service (QNS)

> Reference implementation only — not the production QNS.

- Domain registration and renewal (2M QU/year)
- Subdomain management
- Address resolution (QUBIC addresses)
- Text record storage
- Transferable domain ownership
- Time-based expiration
- TLDs: `.qubic`, `.qns`

---

## Contract Execution Fees

- Contracts require a positive execution fee reserve to keep running
- IPO proceeds generate the initial execution pool: `finalPrice × 676`
- Replenish via `qpi.burn()` or QUtil's `BurnQubicForContract`
- If reserve reaches zero, contract stops executing

---

## Pre-Submission Checklist

- [ ] Contract compiles with zero errors and zero warnings
- [ ] GoogleTest tests comprehensive and all pass
- [ ] SC Verification Tool passes
- [ ] Tested on local testnet (Core Lite or full testnet)
- [ ] Execution fee sustainability planned (invocation rewards + burn logic)
- [ ] Security audit completed (highly recommended)
- [ ] PR targets the `develop` branch
- [ ] Documentation describes contract purpose and interface
- [ ] Community outreach for IPO planned
