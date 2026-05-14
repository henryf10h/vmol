# VMOL Protocol — AI Risk Governor for Lending

**Platanus Build Night 26 · Caracas, Venezuela · 2026**
Henry Rosales ([@henryf10h](https://github.com/henryf10h))

---

## What is VMOL Protocol?

Lending protocols like Aave rely on **governance votes** to adjust risk parameters
(LTV, liquidation thresholds) — a process that takes **days** while markets move in
**minutes**. VMOL Protocol replaces that with an **autonomous AI Risk Governor**:

> An RL-trained model proposes risk parameter changes, on-chain smart contract
> guardrails validate them, and the lending pool stays safe — 24/7, no governance delay.

The AI proposes. The contract validates bounds. The protocol adapts.

---

## Architecture

```
ETH Price Feed
     │
     ▼
[AI Risk Governor]  ── Qwen 2.5 1.5B trained with GRPO (or API LLM for live demo)
     │  proposes (new_LTV, new_Liquidation_Threshold)
     ▼
[RiskGovernor.cairo]  ── on-chain guardrails: bounds, delta caps, cooldown, budget
     │  validates → accepts/rejects
     ▼
[MockAavePool.cairo]  ── lending pool: LTV, liquidation threshold, health factors
     │
     ▼
Pool stays solvent — liquidations triggered earlier, bad debt minimized
```

---

## Repository Structure

| Folder | What |
|--------|------|
| `contracts/` | Cairo contracts (MockAavePool, RiskGovernor, MockPriceOracle) — deployed on Starknet Sepolia, 8/8 tests passing |
| `rl/` | RL training pipeline — lending simulator, GRPO reward function, scenario generator, prompt builder |
| `app/` | React + Vite dashboard + Express backend — agent signs real Starknet txs |

### Companion repo — trained model

The RL model was trained on Google Colab. The trained LoRA adapter, the Colab
notebook, and local inference scripts live in a separate public repo:

**➡️ https://github.com/henryf10h/vmol-colab**

- `rl/vmol_lending_lora_v1/` — trained LoRA adapter (Qwen 2.5 1.5B + GRPO, rank 8)
- `rl/train_lending_grpo.ipynb` — the training notebook
- `scripts/local_inference_demo.py` — run the trained model locally on CPU

---

## Deployed Contracts (Starknet Sepolia)

| Contract | Address |
|----------|---------|
| MockAavePool | [`0x06ef0863a1353770bf483bf57e8623b262ccccdfbf183cdd086d45bbcdf85fac`](https://sepolia.voyager.online/contract/0x06ef0863a1353770bf483bf57e8623b262ccccdfbf183cdd086d45bbcdf85fac) |
| RiskGovernor | [`0x00726210f3763cb4cfffb6c6a41526a85afe47a87a8a38b2000cb96e6e569c9a`](https://sepolia.voyager.online/contract/0x00726210f3763cb4cfffb6c6a41526a85afe47a87a8a38b2000cb96e6e569c9a) |

Pool admin is transferred to RiskGovernor — only the AI agent (via the guardrails)
can change risk parameters.

---

## How the AI agent is governed

`RiskGovernor.cairo` enforces 4 layers of protection on every agent proposal:

1. **Identity** — only the registered agent wallet can propose
2. **Bounds** — LTV ∈ [50%, 85%], Liquidation Threshold ∈ [60%, 90%]
3. **Delta caps** — max 5% change per update (no sudden swings)
4. **Rate limit** — cooldown + total update budget

Plus an invariant: LTV must always be ≤ liquidation threshold.

A misbehaving or compromised model **cannot** drain the pool — the worst it can do
is hit a bound and get rejected on-chain.

---

## Running locally

### Contracts

```bash
cd contracts
scarb build
snforge test          # 8/8 passing
```

### App (frontend + backend)

```bash
cd app
npm install
npm run start:dev     # backend :3001 + frontend :5173
```

Open http://localhost:5173 → click **ETH Crash -15%** → **Trigger Agent**.
The agent reasons about the crash, signs a real Starknet tx, and you get a
Voyager link to the on-chain confirmation.

### RL training

See [vmol-colab](https://github.com/henryf10h/vmol-colab) — open the notebook in
Colab, run all cells. ~15 min for a 50-step smoke run on a free T4.

---

## Demo Strategy

- **Live demo** runs on an API LLM (fast, reliable) signing real Sepolia txs.
- The **RL-trained model** ([vmol-colab](https://github.com/henryf10h/vmol-colab))
  proves the approach works — same prompt/reward/sim pipeline, learns to
  differentiate crash vs. stable markets and respect the on-chain bounds.

Both share the exact same `rl/` code: simulator, reward function, prompt schema.
