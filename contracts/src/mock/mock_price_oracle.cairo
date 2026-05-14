#[starknet::contract]
pub mod MockPriceOracle {
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};
    use starknet::{ContractAddress, get_caller_address};
    use core::num::traits::Zero;

    #[storage]
    struct Storage {
        admin: ContractAddress,
        price: u256,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        PriceUpdated: PriceUpdated,
    }

    #[derive(Drop, starknet::Event)]
    pub struct PriceUpdated {
        pub old_price: u256,
        pub new_price: u256,
    }

    #[constructor]
    fn constructor(ref self: ContractState, admin: ContractAddress, initial_price: u256) {
        assert(!admin.is_zero(), 'ORACLE: admin is zero');
        self.admin.write(admin);
        self.price.write(initial_price);
    }

    #[external(v0)]
    fn set_price(ref self: ContractState, new_price: u256) {
        assert(get_caller_address() == self.admin.read(), 'ORACLE: not admin');
        let old = self.price.read();
        self.price.write(new_price);
        self.emit(PriceUpdated { old_price: old, new_price });
    }

    #[external(v0)]
    fn get_price(self: @ContractState) -> u256 {
        self.price.read()
    }
}
