"""
VMOL Protocol — Prompt builder + output parser for Lending Risk Governor

Output schema:
    {
      "action": "hold" | "adjust" | "adjust_emergency",
      "new_ltv": float,
      "new_liq_threshold": float,
      "is_emergency": bool,
      "reasoning": string
    }
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Optional

import numpy as np

from config import GUARD, POOL
from sim import PoolState


@dataclass
class ParsedAction:
    action: str                    # "hold" | "adjust" | "adjust_emergency"
    new_ltv: float
    new_liq_threshold: float
    is_emergency: bool
    reasoning: str
    raw: str


@dataclass
class ParseError:
    reason: str
    raw: str


SYSTEM_PROMPT = f"""You are an autonomous AI Risk Governor for a lending protocol (similar to Aave). You adjust risk parameters to protect the pool from bad debt while maintaining capital efficiency.

MECHANICS:
- LTV (loan-to-value): determines max borrowing power. 75% LTV means users can borrow up to 75% of their collateral value.
- Liquidation Threshold: when a user's health factor drops below 1.0 (collateral_value * liq_threshold / debt < 1), they get liquidated.
- Health Factor = (collateral_value × liq_threshold) / debt. Below 1.0 = liquidation.
- Lower LTV/threshold = safer but less capital efficient (users can borrow less).
- Higher LTV/threshold = more capital efficient but riskier (liquidations happen later).

YOUR JOB: adjust LTV and liquidation_threshold to prevent cascading liquidations during ETH crashes while keeping capital efficiency high when the market is stable.

HARD BOUNDS (enforced on-chain by RiskGovernor — violating them wastes an action):
- LTV ∈ [{GUARD.ltv_min}, {GUARD.ltv_max}]
- Liquidation Threshold ∈ [{GUARD.liq_threshold_min}, {GUARD.liq_threshold_max}]
- |new_ltv - current_ltv| ≤ {GUARD.max_ltv_delta}
- |new_liq_threshold - current_threshold| ≤ {GUARD.max_liq_threshold_delta}
- LTV must always be ≤ liquidation_threshold
- cooldown: {GUARD.cooldown_normal_s}s normal / {GUARD.cooldown_emergency_s}s emergency

BASELINE: LTV={POOL.initial_ltv}, liquidation_threshold={POOL.initial_liq_threshold}. Return to baseline when conditions normalize.

DECISION FRAMEWORK:
- HOLD: ETH stable, health factors healthy (>1.5), utilization normal → no change
- ADJUST: moderate ETH drop (5-10%) or health factors declining → lower LTV/threshold incrementally
- ADJUST_EMERGENCY: severe ETH drop (>10%) or health factors near 1.0 or high utilization (>90%) → lower aggressively

CRITICAL ANTI-PATTERNS:
- Monotonic drift: don't keep lowering LTV every round. When ETH recovers, RAISE it back.
- Over-reaction: don't slash to minimums on small dips. Graduated response matters.
- Ignoring recovery: if crash is over and HF is healthy, restore LTV for capital efficiency.

OUTPUT — respond with ONE valid JSON object, nothing else:
{{"action":"hold|adjust|adjust_emergency","new_ltv":<float>,"new_liq_threshold":<float>,"is_emergency":<bool>,"reasoning":"<one short sentence>"}}"""


def _fmt_history(arr: np.ndarray, n: int = 8, decimals: int = 4) -> str:
    tail = arr[-n:] if len(arr) >= n else arr
    return "[" + ", ".join(f"{float(x):.{decimals}f}" for x in tail) + "]"


def build_prompt(
    state: PoolState,
    eth_history: np.ndarray,
    health_factor_history: Optional[list[float]] = None,
    window_high_lookback: int = 24,
) -> tuple[str, str]:
    eth_history = np.asarray(eth_history, dtype=float)

    if len(eth_history) >= 2:
        eth_returns = np.diff(eth_history) / eth_history[:-1]
    else:
        eth_returns = np.array([0.0])
    eth_vol = float(np.std(eth_returns[-24:])) if len(eth_returns) >= 2 else 0.0
    lookback = min(window_high_lookback, len(eth_history))
    window_high = float(np.max(eth_history[-lookback:])) if lookback > 0 else state.eth_price
    drawdown_pct = (
        (state.eth_price - window_high) / window_high * 100.0
        if window_high > 0 else 0.0
    )

    hf_hist_str = (
        _fmt_history(np.asarray(health_factor_history), n=8, decimals=3)
        if health_factor_history else "[]"
    )

    user_prompt = f"""POOL STATE:
- eth_price_usd: {state.eth_price:,.2f}
- eth_drop_vs_baseline_pct: {state.eth_drop_pct:+.2f}%
- current_ltv: {state.ltv:.4f} ({state.ltv*100:.1f}%)
- current_liq_threshold: {state.liq_threshold:.4f} ({state.liq_threshold*100:.1f}%)
- total_deposits_eth: {state.total_deposits:.2f}
- total_borrows_usd: {state.total_borrows:,.2f}
- utilization_rate: {state.utilization_rate:.4f} ({state.utilization_rate*100:.1f}%)
- avg_health_factor: {state.avg_health_factor:.3f}
- min_health_factor: {state.min_health_factor:.3f}
- n_liquidations_cumulative: {state.n_liquidations}
- bad_debt_usd: {state.bad_debt:,.2f}
- n_active_users: {state.n_active_users}
- guard_updates_used: {state.guard_update_count} / {GUARD.max_updates}
- steps_since_last_update: {state.steps_since_last_update}

MARKET (last 24h):
- eth_returns: {_fmt_history(eth_returns, n=8, decimals=4)}
- eth_volatility_24h: {eth_vol:.4f}
- eth_drawdown_from_window_high_pct: {drawdown_pct:+.2f}%
- health_factor_history: {hf_hist_str}

Decide. Respond with ONE JSON object exactly matching the schema."""

    return SYSTEM_PROMPT, user_prompt


_ALLOWED_ACTIONS = {"hold", "adjust", "adjust_emergency"}


def _extract_json(text: str) -> Optional[str]:
    text = re.sub(r"```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```", "", text)
    start = text.find("{")
    if start == -1:
        return None
    depth = 0
    for i in range(start, len(text)):
        c = text[i]
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return text[start : i + 1]
    return None


def parse_output(completion: str) -> ParsedAction | ParseError:
    if not completion or not isinstance(completion, str):
        return ParseError(reason="empty_or_non_string", raw=str(completion))

    js = _extract_json(completion)
    if js is None:
        return ParseError(reason="no_json_object_found", raw=completion)

    try:
        data = json.loads(js)
    except json.JSONDecodeError as e:
        return ParseError(reason=f"json_decode_error:{e.msg}", raw=completion)

    if not isinstance(data, dict):
        return ParseError(reason="json_not_object", raw=completion)

    for key in ("action", "new_ltv", "new_liq_threshold", "is_emergency"):
        if key not in data:
            return ParseError(reason=f"missing_field:{key}", raw=completion)

    action = data["action"]
    if not isinstance(action, str) or action.lower() not in _ALLOWED_ACTIONS:
        return ParseError(reason=f"invalid_action:{action!r}", raw=completion)
    action = action.lower()

    try:
        new_ltv = float(data["new_ltv"])
        new_liq_threshold = float(data["new_liq_threshold"])
    except (TypeError, ValueError):
        return ParseError(
            reason=f"non_numeric_params:ltv={data['new_ltv']!r},lt={data['new_liq_threshold']!r}",
            raw=completion,
        )

    if not (np.isfinite(new_ltv) and np.isfinite(new_liq_threshold)):
        return ParseError(reason="non_finite_params", raw=completion)

    is_emergency = data["is_emergency"]
    if not isinstance(is_emergency, bool):
        if isinstance(is_emergency, str):
            is_emergency = is_emergency.strip().lower() in ("true", "1", "yes")
        else:
            return ParseError(
                reason=f"invalid_is_emergency:{is_emergency!r}", raw=completion
            )

    reasoning = str(data.get("reasoning", "")).strip()

    return ParsedAction(
        action=action,
        new_ltv=new_ltv,
        new_liq_threshold=new_liq_threshold,
        is_emergency=is_emergency,
        reasoning=reasoning,
        raw=completion,
    )


def _smoke_test() -> None:
    from sim import LendingSimulator
    from scenarios import _gen_flash_crash
    from config import SIM

    rng = np.random.default_rng(seed=42)
    scenario = _gen_flash_crash(rng, SIM.episode_steps)
    sim = LendingSimulator(
        eth_path=scenario.eth_path,
        initial_ltv=scenario.initial_ltv,
        initial_liq_threshold=scenario.initial_liq_threshold,
        rng=np.random.default_rng(seed=7),
    )
    sim.run_forward(n_steps=30)
    state = sim.get_state()

    sys_p, user_p = build_prompt(
        state=state,
        eth_history=scenario.eth_path[: sim.step_idx + 1],
        health_factor_history=[1.8, 1.7, 1.5, 1.3, 1.2, 1.15, 1.1, 1.05],
    )

    print("=" * 60)
    print("SMOKE TEST — build_prompt")
    print("=" * 60)
    print("[SYSTEM]")
    print(sys_p)
    print()
    print("[USER]")
    print(user_p)

    print()
    print("=" * 60)
    print("SMOKE TEST — parse_output")
    print("=" * 60)
    good = '{"action":"adjust","new_ltv":0.70,"new_liq_threshold":0.76,"is_emergency":false,"reasoning":"ETH dropping, tighten"}'
    print(f"Good: {parse_output(good)}")

    messy = '```json\n{"action":"adjust_emergency","new_ltv":0.65,"new_liq_threshold":0.72,"is_emergency":true,"reasoning":"crash"}\n```'
    print(f"Messy: {parse_output(messy)}")

    for bad in ["", "no json", '{"action":"panic","new_ltv":0.7,"new_liq_threshold":0.8,"is_emergency":false}']:
        r = parse_output(bad)
        label = type(r).__name__
        detail = r.reason if isinstance(r, ParseError) else "(ok)"
        print(f"  {label:12s} {detail}")

    print("\nOK — prompt smoke tests done.")


if __name__ == "__main__":
    _smoke_test()
