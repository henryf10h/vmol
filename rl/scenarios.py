"""
VMOL Protocol — Scenario Generator for Lending Risk Governor

Synthetic ETH price paths for training. Same GBM + jump injection approach
as the PID version, adapted for ETH collateral in a lending pool context.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Optional

import numpy as np

from config import MARKET, SIM, SCENARIO_WEIGHTS


@dataclass
class Scenario:
    eth_path: np.ndarray          # shape (T,) — ETH prices in USD
    initial_ltv: float
    initial_liq_threshold: float
    scenario_type: str
    description: str

    def __post_init__(self) -> None:
        assert self.eth_path.ndim == 1, "eth_path must be 1D"
        assert len(self.eth_path) >= 2, "eth_path must have at least 2 points"
        assert np.all(self.eth_path > 0), "eth_path must be strictly positive"


def _gbm_path(
    rng: np.random.Generator,
    n: int,
    start: float,
    drift_per_step: float,
    vol_per_step: float,
) -> np.ndarray:
    log_returns = rng.normal(loc=drift_per_step, scale=vol_per_step, size=n - 1)
    returns = np.concatenate([[0.0], log_returns])
    return start * np.exp(np.cumsum(returns))


def _inject_jump(
    path: np.ndarray, step: int, magnitude: float, recover_fraction: float = 0.0
) -> np.ndarray:
    path = path.copy()
    if step >= len(path):
        return path
    path[step:] *= (1.0 + magnitude)
    if recover_fraction > 0 and step < len(path) - 10:
        recovery_target = -magnitude * recover_fraction
        ramp_end = min(len(path), step + 10)
        ramp_len = ramp_end - step
        ramp = np.linspace(0, recovery_target, ramp_len)
        path[step:ramp_end] *= (1.0 + ramp)
    return path


def _gen_stable(rng: np.random.Generator, n: int) -> Scenario:
    start = rng.uniform(1800, 2500)
    path = _gbm_path(rng, n, start, drift_per_step=0.0, vol_per_step=0.005)
    return Scenario(
        eth_path=path,
        initial_ltv=0.75,
        initial_liq_threshold=0.80,
        scenario_type="stable",
        description=f"Stable ETH around ${start:,.0f}, low volatility.",
    )


def _gen_crash(rng: np.random.Generator, n: int) -> Scenario:
    start = rng.uniform(1800, 2500)
    path = _gbm_path(rng, n, start, drift_per_step=-0.002, vol_per_step=0.015)
    n_crashes = rng.integers(1, 3)
    for _ in range(int(n_crashes)):
        crash_step = int(rng.integers(n // 4, 3 * n // 4))
        mag = rng.uniform(-0.20, -0.08)
        path = _inject_jump(path, crash_step, mag)
    return Scenario(
        eth_path=path,
        initial_ltv=0.75,
        initial_liq_threshold=0.80,
        scenario_type="crash",
        description=f"ETH crash from ${start:,.0f} with sustained downward pressure.",
    )


def _gen_flash_crash(rng: np.random.Generator, n: int) -> Scenario:
    start = rng.uniform(1800, 2500)
    path = _gbm_path(rng, n, start, drift_per_step=0.0, vol_per_step=0.008)
    crash_step = int(rng.integers(n // 3, 2 * n // 3))
    mag = rng.uniform(-0.25, -0.15)
    path = _inject_jump(path, crash_step, mag, recover_fraction=0.8)
    return Scenario(
        eth_path=path,
        initial_ltv=0.75,
        initial_liq_threshold=0.80,
        scenario_type="flash_crash",
        description=f"Flash crash from ${start:,.0f}: sharp {mag*100:.0f}% drop, 80% recovery.",
    )


def _gen_pump(rng: np.random.Generator, n: int) -> Scenario:
    start = rng.uniform(1500, 2000)
    path = _gbm_path(rng, n, start, drift_per_step=0.003, vol_per_step=0.012)
    for _ in range(int(rng.integers(1, 3))):
        step = int(rng.integers(n // 4, 3 * n // 4))
        mag = rng.uniform(0.05, 0.15)
        path = _inject_jump(path, step, mag)
    return Scenario(
        eth_path=path,
        initial_ltv=0.75,
        initial_liq_threshold=0.80,
        scenario_type="pump",
        description=f"ETH pump from ${start:,.0f} with upward jumps.",
    )


def _gen_volatile(rng: np.random.Generator, n: int) -> Scenario:
    start = rng.uniform(1500, 2500)
    path = _gbm_path(rng, n, start, drift_per_step=0.0, vol_per_step=0.03)
    return Scenario(
        eth_path=path,
        initial_ltv=0.75,
        initial_liq_threshold=0.80,
        scenario_type="volatile",
        description=f"High-volatility ETH at ${start:,.0f}, choppy market.",
    )


def _gen_recovery(rng: np.random.Generator, n: int) -> Scenario:
    crash_start = rng.uniform(2000, 2500)
    low = crash_start * rng.uniform(0.5, 0.7)
    path = _gbm_path(rng, n, low, drift_per_step=0.004, vol_per_step=0.02)
    return Scenario(
        eth_path=path,
        initial_ltv=0.75,
        initial_liq_threshold=0.80,
        scenario_type="recovery",
        description=f"ETH recovery from post-crash low ${low:,.0f}.",
    )


_GENERATORS: dict[str, Callable[[np.random.Generator, int], Scenario]] = {
    "stable": _gen_stable,
    "crash": _gen_crash,
    "flash_crash": _gen_flash_crash,
    "pump": _gen_pump,
    "volatile": _gen_volatile,
    "recovery": _gen_recovery,
}


def sample_scenario(
    rng: Optional[np.random.Generator] = None,
    n_steps: Optional[int] = None,
) -> Scenario:
    if rng is None:
        rng = np.random.default_rng()
    if n_steps is None:
        n_steps = SIM.episode_steps
    types = list(SCENARIO_WEIGHTS.keys())
    weights = np.array(list(SCENARIO_WEIGHTS.values()))
    weights = weights / weights.sum()
    chosen = rng.choice(types, p=weights)
    return _GENERATORS[chosen](rng, n_steps)


def generate_batch(
    n: int, seed: int = 42, n_steps: Optional[int] = None
) -> list[Scenario]:
    rng = np.random.default_rng(seed=seed)
    return [sample_scenario(rng, n_steps) for _ in range(n)]


def _smoke_test() -> None:
    rng = np.random.default_rng(seed=42)

    print("=" * 60)
    print("SMOKE TEST — one scenario of each type")
    print("=" * 60)
    for name, gen in _GENERATORS.items():
        scenario = gen(rng, SIM.episode_steps)
        path = scenario.eth_path
        total_return = (float(path[-1]) - float(path[0])) / float(path[0]) * 100
        print(
            f"  {name:14s}  "
            f"start=${path[0]:>8,.0f}  "
            f"end=${path[-1]:>8,.0f}  "
            f"range=[${float(path.min()):>8,.0f}, ${float(path.max()):>8,.0f}]  "
            f"total={total_return:+6.1f}%"
        )

    print()
    print("=" * 60)
    print("SMOKE TEST — batch sampling respects distribution")
    print("=" * 60)
    batch = generate_batch(n=1000, seed=123)
    from collections import Counter
    counts = Counter(s.scenario_type for s in batch)
    for t, expected_w in SCENARIO_WEIGHTS.items():
        observed = counts.get(t, 0) / len(batch)
        print(f"  {t:14s}  expected={expected_w:.2f}  observed={observed:.3f}")

    print("\nOK — scenarios smoke tests done.")


if __name__ == "__main__":
    _smoke_test()
