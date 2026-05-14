"""
VMOL Protocol — Reward function for Lending Risk Governor

Evaluates agent actions over a post-action window. The agent proposes
new (LTV, liquidation_threshold) and we simulate forward to see the impact.

Reward = minimize bad debt + minimize unnecessary liquidations
         + maintain healthy health factors + capital efficiency
         - action regularization - bounds violations
"""

from __future__ import annotations

import copy
from dataclasses import dataclass, field
from typing import Optional

import numpy as np

from config import REWARD, EMERGENCY, SIM
from sim import LendingSimulator, PoolState
from prompt import ParsedAction, ParseError, parse_output


@dataclass
class RewardBreakdown:
    total: float = 0.0
    bad_debt_term: float = 0.0          # -α * bad_debt
    liquidation_term: float = 0.0       # -β * excess_liquidations
    health_factor_term: float = 0.0     # -γ * health_penalty
    action_mag_term: float = 0.0        # -δ * ||Δparams||
    bounds_term: float = 0.0            # -ε * bounds_violation
    monotonic_term: float = 0.0         # -ζ * monotonic_penalty
    emergency_term: float = 0.0         # +bonus or -penalty
    efficiency_term: float = 0.0        # +η * capital_efficiency
    malformed_term: float = 0.0         # -10 if parse error
    metrics: dict = field(default_factory=dict)
    parse_error: Optional[str] = None


def _is_actual_emergency(
    state_before: PoolState,
    state_after_window: list[PoolState],
    eth_path: np.ndarray,
    step_idx: int,
    lookback_bars: int = 5,
) -> bool:
    if state_before.avg_health_factor < EMERGENCY.health_factor_threshold:
        return True

    if state_before.utilization_rate > EMERGENCY.utilization_threshold:
        return True

    lookback = min(lookback_bars, step_idx)
    if lookback >= 1:
        past = float(eth_path[step_idx - lookback])
        now = float(eth_path[step_idx])
        if past > 0:
            recent_return_pct = (now - past) / past * 100.0
            if recent_return_pct <= -EMERGENCY.eth_drop_pct_threshold:
                return True

    if state_after_window:
        min_hf_after = min(s.min_health_factor for s in state_after_window)
        if min_hf_after < 1.0:
            return True

    return False


def _monotonic_drift_penalty(param_history: list[tuple[float, float]]) -> float:
    window = REWARD.monotonic_window
    if len(param_history) < 2:
        return 0.0

    diffs = [
        param_history[i + 1][0] - param_history[i][0]
        for i in range(len(param_history) - 1)
    ]
    if not diffs:
        return 0.0

    run = 0
    sign = 0
    for d in reversed(diffs):
        if abs(d) < 1e-9:
            break
        cur_sign = 1 if d > 0 else -1
        if sign == 0:
            sign = cur_sign
            run = 1
        elif cur_sign == sign:
            run += 1
        else:
            break

    ratio = min(run, window) / window
    return ratio * ratio


def compute_reward(
    completion: str,
    sim: LendingSimulator,
    reward_window_steps: Optional[int] = None,
) -> RewardBreakdown:
    if reward_window_steps is None:
        reward_window_steps = SIM.reward_window_steps

    breakdown = RewardBreakdown()

    parsed = parse_output(completion)
    if isinstance(parsed, ParseError):
        breakdown.malformed_term = REWARD.malformed_output_penalty
        breakdown.total = REWARD.malformed_output_penalty
        breakdown.parse_error = parsed.reason
        return breakdown

    assert isinstance(parsed, ParsedAction)

    sim_clone = copy.deepcopy(sim)
    state_before = sim_clone.get_state()
    liquidations_before = state_before.n_liquidations
    bad_debt_before = state_before.bad_debt

    if parsed.action == "hold":
        req_ltv = state_before.ltv
        req_lt = state_before.liq_threshold
    else:
        req_ltv = parsed.new_ltv
        req_lt = parsed.new_liq_threshold

    action_result = sim_clone.apply_action(
        requested_ltv=req_ltv,
        requested_liq_threshold=req_lt,
        is_emergency=parsed.is_emergency,
    )

    history = sim_clone.run_forward(n_steps=reward_window_steps)
    metrics = sim_clone.get_history_metrics(history)
    breakdown.metrics = metrics

    # (a) Bad debt penalty
    new_bad_debt = metrics["total_bad_debt"] - bad_debt_before
    # Normalize by pool size to keep reward scale consistent
    pool_value = state_before.total_deposits * state_before.eth_price
    normalized_bad_debt = new_bad_debt / max(pool_value, 1.0) * 100
    breakdown.bad_debt_term = -REWARD.alpha_bad_debt * normalized_bad_debt

    # (b) Excess liquidations
    new_liquidations = metrics["total_liquidations"] - liquidations_before
    breakdown.liquidation_term = -REWARD.beta_excess_liquidations * new_liquidations

    # (c) Health factor — penalize when avg drops below safe threshold
    health_penalty = max(0.0, 1.5 - metrics["mean_health_factor"])
    breakdown.health_factor_term = -REWARD.gamma_health_factor * health_penalty

    # (d) Action magnitude
    if parsed.action != "hold":
        breakdown.action_mag_term = -REWARD.delta_action_mag * action_result.action_magnitude

    # (e) Bounds violations
    breakdown.bounds_term = -REWARD.epsilon_bounds_violation * action_result.bounds_violation

    # (f) Monotonic drift
    monotonic_p = _monotonic_drift_penalty(sim_clone.param_history)
    breakdown.monotonic_term = -REWARD.zeta_monotonic * monotonic_p

    # (g) Emergency classification
    actual_emergency = _is_actual_emergency(
        state_before=state_before,
        state_after_window=history,
        eth_path=sim_clone.eth_path,
        step_idx=sim.step_idx,
    )
    declared_emergency = parsed.is_emergency or parsed.action == "adjust_emergency"
    if declared_emergency and actual_emergency:
        breakdown.emergency_term = REWARD.bonus_justified_emergency
    elif declared_emergency and not actual_emergency:
        breakdown.emergency_term = -REWARD.penalty_false_alarm

    # (h) Capital efficiency — reward keeping LTV reasonably high when safe
    if metrics["min_health_factor"] > 1.2 and new_liquidations == 0:
        breakdown.efficiency_term = REWARD.eta_capital_efficiency * metrics["capital_efficiency"]

    breakdown.total = (
        breakdown.bad_debt_term
        + breakdown.liquidation_term
        + breakdown.health_factor_term
        + breakdown.action_mag_term
        + breakdown.bounds_term
        + breakdown.monotonic_term
        + breakdown.emergency_term
        + breakdown.efficiency_term
    )
    return breakdown


def lending_reward_func(
    prompts: list,
    completions: list,
    sims: Optional[list[LendingSimulator]] = None,
    **kwargs,
) -> list[float]:
    if sims is None or len(sims) != len(completions):
        raise ValueError(
            f"lending_reward_func requires sims list matching completions length "
            f"(got sims={len(sims) if sims else 0}, completions={len(completions)})"
        )

    rewards: list[float] = []
    for completion, sim in zip(completions, sims):
        text = _normalize_completion(completion)
        rewards.append(compute_reward(text, sim).total)
    return rewards


def _normalize_completion(c) -> str:
    if isinstance(c, str):
        return c
    if isinstance(c, list):
        parts = []
        for m in c:
            if isinstance(m, dict) and "content" in m:
                parts.append(str(m["content"]))
            else:
                parts.append(str(m))
        return "\n".join(parts)
    return str(c)


def _smoke_test() -> None:
    from sim import LendingSimulator
    from scenarios import _gen_flash_crash, _gen_stable

    rng = np.random.default_rng(seed=42)

    print("=" * 60)
    print("SMOKE TEST — reward on flash crash scenario")
    print("=" * 60)
    scenario = _gen_flash_crash(rng, SIM.episode_steps)
    sim = LendingSimulator(
        eth_path=scenario.eth_path,
        initial_ltv=scenario.initial_ltv,
        initial_liq_threshold=scenario.initial_liq_threshold,
        rng=np.random.default_rng(seed=7),
    )
    sim.run_forward(n_steps=50)

    good = '{"action":"adjust","new_ltv":0.70,"new_liq_threshold":0.76,"is_emergency":true,"reasoning":"ETH dropping, tighten risk"}'
    br = compute_reward(good, sim)
    _print_breakdown("good adjust", br)

    hold = '{"action":"hold","new_ltv":0.75,"new_liq_threshold":0.80,"is_emergency":false,"reasoning":"monitoring"}'
    br_hold = compute_reward(hold, sim)
    _print_breakdown("hold", br_hold)

    bad = '{"action":"adjust","new_ltv":0.90,"new_liq_threshold":0.60,"is_emergency":false,"reasoning":"yolo"}'
    br_bad = compute_reward(bad, sim)
    _print_breakdown("bounds-violating", br_bad)

    br_malformed = compute_reward("I don't know what to do", sim)
    _print_breakdown("malformed", br_malformed)

    print()
    print("=" * 60)
    print("SMOKE TEST — false alarm on stable")
    print("=" * 60)
    stable = _gen_stable(rng, SIM.episode_steps)
    sim_s = LendingSimulator(
        eth_path=stable.eth_path,
        initial_ltv=stable.initial_ltv,
        initial_liq_threshold=stable.initial_liq_threshold,
        rng=np.random.default_rng(seed=7),
    )
    sim_s.run_forward(n_steps=50)
    false_alarm = '{"action":"adjust_emergency","new_ltv":0.55,"new_liq_threshold":0.65,"is_emergency":true,"reasoning":"panic"}'
    br_fa = compute_reward(false_alarm, sim_s)
    _print_breakdown("false alarm on stable", br_fa)

    print("\nOK — reward smoke tests done.")


def _print_breakdown(label: str, br: RewardBreakdown) -> None:
    print(f"\n[{label}]  total={br.total:+8.4f}")
    if br.parse_error:
        print(f"    parse_error: {br.parse_error}")
        return
    print(f"    bad_debt:      {br.bad_debt_term:+8.4f}")
    print(f"    liquidations:  {br.liquidation_term:+8.4f}")
    print(f"    health_factor: {br.health_factor_term:+8.4f}")
    print(f"    action_mag:    {br.action_mag_term:+8.4f}")
    print(f"    bounds:        {br.bounds_term:+8.4f}")
    print(f"    monotonic:     {br.monotonic_term:+8.4f}")
    print(f"    emergency:     {br.emergency_term:+8.4f}")
    print(f"    efficiency:    {br.efficiency_term:+8.4f}")
    for k, v in br.metrics.items():
        print(f"    {k:25s} {v:.4f}" if isinstance(v, float) else f"    {k:25s} {v}")


if __name__ == "__main__":
    _smoke_test()
