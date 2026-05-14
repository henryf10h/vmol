"""
VMOL Protocol — RL Configuration for Lending Risk Governor

Single source of truth for guard bounds, pool parameters, reward weights,
and training hyperparameters.

The AI agent governs two parameters of a mock Aave lending pool:
  - LTV (loan-to-value ratio): max borrowing power as % of collateral
  - Liquidation Threshold: health factor trigger for liquidation

Units: all ratios as decimals (0.75 = 75%), prices in USD floats.
"""

from dataclasses import dataclass


# ============================================================================
# RiskGovernor bounds (matches RiskGovernor.cairo policy)
# ============================================================================

@dataclass(frozen=True)
class GuardBounds:
    ltv_min: float = 0.50          # 50%
    ltv_max: float = 0.85          # 85%
    liq_threshold_min: float = 0.60  # 60%
    liq_threshold_max: float = 0.90  # 90%
    max_ltv_delta: float = 0.05    # 5% max change per update
    max_liq_threshold_delta: float = 0.05
    cooldown_normal_s: int = 60
    cooldown_emergency_s: int = 10
    max_updates: int = 1000


GUARD = GuardBounds()


# ============================================================================
# Pool initial parameters
# ============================================================================

@dataclass(frozen=True)
class PoolParams:
    initial_ltv: float = 0.75             # 75%
    initial_liq_threshold: float = 0.80   # 80%
    liquidation_bonus: float = 0.10       # 10% bonus for liquidators
    eth_baseline_usd: float = 2000.0      # starting ETH price


POOL = PoolParams()


# ============================================================================
# Market model parameters
# ============================================================================

@dataclass(frozen=True)
class MarketParams:
    eth_baseline_usd: float = 2000.0

    # User behavior parameters
    n_users: int = 20
    min_collateral: float = 5.0      # min ETH per user
    max_collateral: float = 50.0     # max ETH per user
    borrow_ratio_mean: float = 0.65  # users borrow ~65% of max on average
    borrow_ratio_std: float = 0.15

    # Utilization dynamics
    deposit_sensitivity: float = 0.3   # how much new deposits respond to price pumps
    withdraw_sensitivity: float = 0.5  # how much withdrawals respond to price drops
    borrow_demand_base: float = 0.02   # base probability of new borrow per step
    repay_sensitivity: float = 0.3     # how fast repayments happen in crashes


MARKET = MarketParams()


# ============================================================================
# Simulation parameters
# ============================================================================

@dataclass(frozen=True)
class SimParams:
    dt_s: float = 3600.0           # 1 hour per step
    episode_steps: int = 200       # ~8 days
    reward_window_steps: int = 20  # 20 hours post-action evaluation
    action_cooldown_steps: int = 1


SIM = SimParams()


# ============================================================================
# Reward weights
# ============================================================================

@dataclass(frozen=True)
class RewardWeights:
    # Primary: penalize bad debt (liquidations where collateral < debt)
    alpha_bad_debt: float = 5.0

    # Secondary: penalize unnecessary liquidations (capital efficiency)
    beta_excess_liquidations: float = 2.0

    # Penalize low average health factor (system fragility)
    gamma_health_factor: float = 3.0

    # Action regularization (avoid gratuitous changes)
    delta_action_mag: float = 0.5

    # Bounds violation penalty
    epsilon_bounds_violation: float = 10.0

    # Monotonic drift penalty (same as PID version)
    zeta_monotonic: float = 2.0
    monotonic_window: int = 5

    # Emergency classification
    bonus_justified_emergency: float = 5.0
    penalty_false_alarm: float = 5.0

    # Malformed output
    malformed_output_penalty: float = -10.0

    # Capital efficiency bonus: reward keeping LTV high when safe
    eta_capital_efficiency: float = 1.0


REWARD = RewardWeights()


# ============================================================================
# Emergency detection thresholds
# ============================================================================

@dataclass(frozen=True)
class EmergencyThresholds:
    # Average health factor below this = emergency
    health_factor_threshold: float = 1.2
    # ETH drop in last N bars that counts as emergency
    eth_drop_pct_threshold: float = 10.0
    # Utilization above this = emergency
    utilization_threshold: float = 0.90


EMERGENCY = EmergencyThresholds()


# ============================================================================
# Training hyperparameters
# ============================================================================

@dataclass(frozen=True)
class TrainConfig:
    base_model: str = "Qwen/Qwen2.5-1.5B-Instruct"
    lora_rank: int = 8
    batch_size: int = 4
    num_generations: int = 4
    max_prompt_length: int = 1024
    max_completion_length: int = 512
    learning_rate: float = 5e-6
    max_steps: int = 50
    warmup_ratio: float = 0.1
    kl_coef: float = 0.04
    seed: int = 42


TRAIN = TrainConfig()


# ============================================================================
# Scenario distribution
# ============================================================================

SCENARIO_WEIGHTS: dict = {
    "stable": 0.15,
    "crash": 0.30,
    "flash_crash": 0.15,
    "pump": 0.10,
    "volatile": 0.20,
    "recovery": 0.10,
}
