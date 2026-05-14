# VMOL Protocol — RL Training Pipeline

This folder contains the reinforcement learning pipeline that trains the
AI Risk Governor to adjust lending pool parameters (LTV, Liquidation Threshold).

## Files

| File | Purpose |
|------|---------|
| `config.py` | Guard bounds, pool params, reward weights, training hyperparameters |
| `scenarios.py` | Synthetic ETH price path generator (stable, crash, flash crash, pump, volatile, recovery) |
| `sim.py` | Lending pool simulator — 20 synthetic users, health factors, liquidations, bad debt |
| `reward.py` | 8-component GRPO reward (bad debt, liquidations, health factor, bounds, monotonic drift, emergency, capital efficiency) |
| `prompt.py` | System/user prompt builder + JSON output parser |
| `train_lending_grpo.ipynb` | Colab training notebook |

## Trained Model

The model was trained on Google Colab. The **trained LoRA adapter** and local
inference scripts live in the companion repo:

**➡️ https://github.com/henryf10h/vmol-colab**

- `rl/vmol_lending_lora_v1/` — trained adapter (Qwen 2.5 1.5B Instruct + GRPO, LoRA rank 8)
- `scripts/local_inference_demo.py` — run it locally on CPU

## Run smoke tests

```bash
cd rl
python scenarios.py   # scenario generator
python sim.py         # lending simulator
python reward.py      # reward function
python prompt.py      # prompt builder + parser
```

All four print PASS output when the pipeline is healthy.
