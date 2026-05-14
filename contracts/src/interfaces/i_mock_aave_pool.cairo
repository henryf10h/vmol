use starknet::ContractAddress;

#[starknet::interface]
pub trait IMockAavePool<TContractState> {
    fn set_ltv(ref self: TContractState, ltv: u256);
    fn set_liquidation_threshold(ref self: TContractState, threshold: u256);
    fn set_collateral_price(ref self: TContractState, price: u256);
    fn deposit(ref self: TContractState, amount: u256);
    fn borrow(ref self: TContractState, amount: u256);
    fn repay(ref self: TContractState, amount: u256);
    fn liquidate(ref self: TContractState, user: ContractAddress);

    fn get_ltv(self: @TContractState) -> u256;
    fn get_liquidation_threshold(self: @TContractState) -> u256;
    fn get_collateral_price(self: @TContractState) -> u256;
    fn get_user_collateral(self: @TContractState, user: ContractAddress) -> u256;
    fn get_user_debt(self: @TContractState, user: ContractAddress) -> u256;
    fn get_health_factor(self: @TContractState, user: ContractAddress) -> u256;
    fn get_utilization_rate(self: @TContractState) -> u256;
    fn get_total_deposits(self: @TContractState) -> u256;
    fn get_total_borrows(self: @TContractState) -> u256;
}
