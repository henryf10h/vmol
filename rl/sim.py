"""
VMOL Protocol — Lending Pool Simulator

Simulates a mock Aave-style lending pool where an AI agent adjusts
LTV and liquidation_threshold in response to ETH price movements.

The pool has N synthetic users with positions. As ETH price changes:
  - Health factors shift
  - Users below health=1.0 get liquidated
  - Bad debt accumulates if collateral < debt at liquidation
  - The agent tries to prevent cascading liquidations by lowering LTV/threshold
    preemptively, while keeping capital efficiency high when safe.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

import numpy as np

from config import POOL, MARKET, SIM, GUARD


@dataclass
class UserPosition:
    collateral: float    # ETH amount
    debt: float          # USD amount borrowed
    liquidated: bool = False


@dataclass
class PoolState:
    t: float
    eth_price: float
    ltv: float
    liq_threshold: float
    total_deposits: float       # ETH
    total_borrows: float        # USD
    utilization_rate: float     # borrows / (deposits * price)
    avg_health_factor: float
    min_health_factor: float
    n_liquidations: int         # cumulative
    bad_debt: float             # cumulative USD
    n_active_users: int
    eth_drop_pct: float         # vs baseline
    guard_update_count: int
    steps_since_last_update: int


@dataclass
class ActionResult:
    accepted: bool
    bounds_violation: float
    action_magnitude: float
    requested_ltv: float
    requested_liq_threshold: float
    applied_ltv: float
    applied_liq_threshold: float


class LendingSimulator:
    def __init__(
        self,
        eth_path: np.ndarray,
        initial_ltv: float = POOL.initial_ltv,
        initial_liq_threshold: float = POOL.initial_liq_threshold,
        rng: Optional[np.random.Generator] = None,
    ) -> None:
        if rng is None:
            rng = np.random.default_rng()
        self.rng = rng
        self.eth_path = eth_path

        self.t: float = 0.0
        self.step_idx: int = 0
        self.ltv = initial_ltv
        self.liq_threshold = initial_liq_threshold

        self.guard_update_count: int = 0
        self.steps_since_last_update: int = 0
        self.guard_stopped: bool = False

        self.n_liquidations: int = 0
        self.bad_debt: float = 0.0

        self.param_history: list[tuple[float, float]] = [(initial_ltv, initial_liq_threshold)]

        self.users: list[UserPosition] = self._init_users()

    def _init_users(self) -> list[UserPosition]:
        users = []
        eth_price = float(self.eth_path[0])
        for _ in range(MARKET.n_users):
            collateral = self.rng.uniform(MARKET.min_collateral, MARKET.max_collateral)
            max_borrow = collateral * eth_price * self.ltv
            borrow_ratio = np.clip(
                self.rng.normal(MARKET.borrow_ratio_mean, MARKET.borrow_ratio_std),
                0.3, 0.95,
            )
            debt = max_borrow * borrow_ratio
            users.append(UserPosition(collateral=collateral, debt=debt))
        return users

    def _health_factor(self, user: UserPosition, eth_price: float) -> float:
        if user.debt <= 0 or user.liquidated:
            return 100.0
        collateral_value = user.collateral * eth_price
        return (collateral_value * self.liq_threshold) / user.debt

    def _process_liquidations(self, eth_price: float) -> tuple[int, float]:
        liquidated_count = 0
        new_bad_debt = 0.0
        for user in self.users:
            if user.liquidated:
                continue
            hf = self._health_factor(user, eth_price)
            if hf < 1.0:
                collateral_value = user.collateral * eth_price
                bonus_factor = 1.0 + POOL.liquidation_bonus
                collateral_needed = user.debt * bonus_factor / eth_price
                if collateral_needed > user.collateral:
                    shortfall = user.debt - collateral_value
                    new_bad_debt += max(0.0, shortfall)
                user.liquidated = True
                user.collateral = 0.0
                user.debt = 0.0
                liquidated_count += 1
        return liquidated_count, new_bad_debt

    def reset(self) -> PoolState:
        self.t = 0.0
        self.step_idx = 0
        baseline_ltv, baseline_lt = self.param_history[0]
        self.ltv = baseline_ltv
        self.liq_threshold = baseline_lt
        self.guard_update_count = 0
        self.steps_since_last_update = 0
        self.guard_stopped = False
        self.n_liquidations = 0
        self.bad_debt = 0.0
        self.param_history = [(baseline_ltv, baseline_lt)]
        self.users = self._init_users()
        return self.get_state()

    def step(self) -> PoolState:
        if self.step_idx >= len(self.eth_path) - 1:
            return self.get_state()

        self.step_idx += 1
        self.t += SIM.dt_s
        self.steps_since_last_update += 1

        eth_price = float(self.eth_path[self.step_idx])

        liq_count, new_bad = self._process_liquidations(eth_price)
        self.n_liquidations += liq_count
        self.bad_debt += new_bad

        return self.get_state()

    def apply_action(
        self,
        requested_ltv: float,
        requested_liq_threshold: float,
        is_emergency: bool = False,
    ) -> ActionResult:
        current_ltv = self.ltv
        current_lt = self.liq_threshold

        action_magnitude = (
            abs(requested_ltv - current_ltv)
            + abs(requested_liq_threshold - current_lt)
        )

        bounds_violation = 0.0

        # LTV must <= liq_threshold
        if requested_ltv > requested_liq_threshold:
            bounds_violation += requested_ltv - requested_liq_threshold

        # Absolute bounds
        if requested_ltv < GUARD.ltv_min:
            bounds_violation += GUARD.ltv_min - requested_ltv
        if requested_ltv > GUARD.ltv_max:
            bounds_violation += requested_ltv - GUARD.ltv_max
        if requested_liq_threshold < GUARD.liq_threshold_min:
            bounds_violation += GUARD.liq_threshold_min - requested_liq_threshold
        if requested_liq_threshold > GUARD.liq_threshold_max:
            bounds_violation += requested_liq_threshold - GUARD.liq_threshold_max

        # Delta caps
        if abs(requested_ltv - current_ltv) > GUARD.max_ltv_delta:
            bounds_violation += abs(requested_ltv - current_ltv) - GUARD.max_ltv_delta
        if abs(requested_liq_threshold - current_lt) > GUARD.max_liq_threshold_delta:
            bounds_violation += (
                abs(requested_liq_threshold - current_lt)
                - GUARD.max_liq_threshold_delta
            )

        # Cooldown
        cooldown = (
            GUARD.cooldown_emergency_s if is_emergency else GUARD.cooldown_normal_s
        )
        cooldown_steps = max(1, int(cooldown / SIM.dt_s))
        cooldown_ok = self.steps_since_last_update >= cooldown_steps

        budget_ok = self.guard_update_count < GUARD.max_updates

        if (
            bounds_violation == 0.0
            and cooldown_ok
            and budget_ok
            and not self.guard_stopped
        ):
            self.ltv = requested_ltv
            self.liq_threshold = requested_liq_threshold
            self.guard_update_count += 1
            self.steps_since_last_update = 0
            self.param_history.append((requested_ltv, requested_liq_threshold))
            return ActionResult(
                accepted=True,
                bounds_violation=0.0,
                action_magnitude=action_magnitude,
                requested_ltv=requested_ltv,
                requested_liq_threshold=requested_liq_threshold,
                applied_ltv=requested_ltv,
                applied_liq_threshold=requested_liq_threshold,
            )

        return ActionResult(
            accepted=False,
            bounds_violation=bounds_violation,
            action_magnitude=action_magnitude,
            requested_ltv=requested_ltv,
            requested_liq_threshold=requested_liq_threshold,
            applied_ltv=current_ltv,
            applied_liq_threshold=current_lt,
        )

    def run_forward(self, n_steps: int) -> list[PoolState]:
        history = []
        for _ in range(n_steps):
            state = self.step()
            history.append(state)
            if self.step_idx >= len(self.eth_path) - 1:
                break
        return history

    def get_state(self) -> PoolState:
        eth_price = float(self.eth_path[min(self.step_idx, len(self.eth_path) - 1)])

        active_users = [u for u in self.users if not u.liquidated]
        n_active = len(active_users)

        total_deposits = sum(u.collateral for u in active_users)
        total_borrows = sum(u.debt for u in active_users)

        deposit_value = total_deposits * eth_price
        utilization = total_borrows / deposit_value if deposit_value > 0 else 0.0

        health_factors = [
            self._health_factor(u, eth_price) for u in active_users if u.debt > 0
        ]
        avg_hf = float(np.mean(health_factors)) if health_factors else 100.0
        min_hf = float(np.min(health_factors)) if health_factors else 100.0

        eth_drop_pct = (
            (MARKET.eth_baseline_usd - eth_price) / MARKET.eth_baseline_usd * 100
            if MARKET.eth_baseline_usd > 0 else 0.0
        )

        return PoolState(
            t=self.t,
            eth_price=eth_price,
            ltv=self.ltv,
            liq_threshold=self.liq_threshold,
            total_deposits=total_deposits,
            total_borrows=total_borrows,
            utilization_rate=utilization,
            avg_health_factor=avg_hf,
            min_health_factor=min_hf,
            n_liquidations=self.n_liquidations,
            bad_debt=self.bad_debt,
            n_active_users=n_active,
            eth_drop_pct=eth_drop_pct,
            guard_update_count=self.guard_update_count,
            steps_since_last_update=self.steps_since_last_update,
        )

    def get_history_metrics(self, history: list[PoolState]) -> dict:
        if not history:
            return {
                "mean_health_factor": 0.0,
                "min_health_factor": 0.0,
                "total_liquidations": 0,
                "total_bad_debt": 0.0,
                "mean_utilization": 0.0,
                "max_utilization": 0.0,
                "capital_efficiency": 0.0,
            }
        hfs = np.array([h.avg_health_factor for h in history])
        min_hfs = np.array([h.min_health_factor for h in history])
        utils = np.array([h.utilization_rate for h in history])
        ltvs = np.array([h.ltv for h in history])

        return {
            "mean_health_factor": float(np.mean(hfs)),
            "min_health_factor": float(np.min(min_hfs)),
            "total_liquidations": history[-1].n_liquidations,
            "total_bad_debt": history[-1].bad_debt,
            "mean_utilization": float(np.mean(utils)),
            "max_utilization": float(np.max(utils)),
            "capital_efficiency": float(np.mean(ltvs)),
        }


def _smoke_test() -> None:
    from scenarios import _gen_crash, _gen_stable

    rng = np.random.default_rng(seed=42)

    print("=" * 60)
    print("SMOKE TEST — stable scenario, no agent action")
    print("=" * 60)
    scenario = _gen_stable(rng, SIM.episode_steps)
    sim = LendingSimulator(
        eth_path=scenario.eth_path,
        initial_ltv=scenario.initial_ltv,
        initial_liq_threshold=scenario.initial_liq_threshold,
        rng=np.random.default_rng(seed=7),
    )
    history = sim.run_forward(n_steps=SIM.episode_steps - 1)
    metrics = sim.get_history_metrics(history)
    state = sim.get_state()
    print(f"ETH: ${scenario.eth_path[0]:,.0f} → ${scenario.eth_path[-1]:,.0f}")
    print(f"Liquidations: {state.n_liquidations}")
    print(f"Bad debt: ${state.bad_debt:,.2f}")
    for k, v in metrics.items():
        print(f"  {k:25s} {v:.4f}" if isinstance(v, float) else f"  {k:25s} {v}")

    print()
    print("=" * 60)
    print("SMOKE TEST — crash scenario with agent action")
    print("=" * 60)
    scenario = _gen_crash(rng, SIM.episode_steps)
    sim = LendingSimulator(
        eth_path=scenario.eth_path,
        initial_ltv=scenario.initial_ltv,
        initial_liq_threshold=scenario.initial_liq_threshold,
        rng=np.random.default_rng(seed=7),
    )
    sim.run_forward(n_steps=50)
    print(f"Before action — liquidations: {sim.n_liquidations}, HF: {sim.get_state().avg_health_factor:.3f}")

    result = sim.apply_action(requested_ltv=0.70, requested_liq_threshold=0.76, is_emergency=True)
    print(f"Action accepted: {result.accepted}")
    sim.run_forward(n_steps=50)
    print(f"After action — liquidations: {sim.n_liquidations}, HF: {sim.get_state().avg_health_factor:.3f}")

    print()
    print("=" * 60)
    print("SMOKE TEST — bounds violation")
    print("=" * 60)
    result = sim.apply_action(requested_ltv=0.40, requested_liq_threshold=0.95)
    print(f"Accepted: {result.accepted} (expected False)")
    print(f"Bounds violation: {result.bounds_violation:.4f}")

    print("\nOK — sim smoke tests done.")


if __name__ == "__main__":
    _smoke_test()
