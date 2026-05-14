use starknet::ContractAddress;
use vmol::types::RiskPolicy;

#[starknet::interface]
pub trait IRiskGovernor<TContractState> {
    fn propose_parameters(
        ref self: TContractState, new_ltv: u256, new_liq_threshold: u256, is_emergency: bool,
    );

    fn set_agent(ref self: TContractState, agent: ContractAddress);
    fn set_policy(ref self: TContractState, policy: RiskPolicy);
    fn emergency_stop(ref self: TContractState);
    fn resume(ref self: TContractState);

    fn get_policy(self: @TContractState) -> RiskPolicy;
    fn get_agent(self: @TContractState) -> ContractAddress;
    fn is_stopped(self: @TContractState) -> bool;
    fn get_update_count(self: @TContractState) -> u32;
    fn get_last_update_timestamp(self: @TContractState) -> u64;
}
