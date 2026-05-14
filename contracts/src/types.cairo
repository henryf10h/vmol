pub const WAD: u256 = 1_000_000_000_000_000_000; // 1e18

pub fn wmul(a: u256, b: u256) -> u256 {
    (a * b + WAD / 2) / WAD
}

pub fn wdiv(a: u256, b: u256) -> u256 {
    (a * WAD + b / 2) / b
}

#[derive(Copy, Drop, Serde, starknet::Store)]
pub struct RiskPolicy {
    pub ltv_min: u256,
    pub ltv_max: u256,
    pub liq_threshold_min: u256,
    pub liq_threshold_max: u256,
    pub max_ltv_delta: u256,
    pub max_liq_threshold_delta: u256,
    pub cooldown_seconds: u64,
    pub emergency_cooldown_seconds: u64,
    pub max_updates: u32,
}
