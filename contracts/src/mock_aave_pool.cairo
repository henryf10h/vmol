/// MockAavePool — Simplified lending pool for VMOL Protocol demo
/// Stores per-user collateral/debt, global LTV and liquidation threshold.
/// The RiskGovernor (AI agent) adjusts LTV and liquidation_threshold
/// based on market conditions.
#[starknet::contract]
pub mod MockAavePool {
    use starknet::storage::{
        StoragePointerReadAccess, StoragePointerWriteAccess,
        Map, StorageMapReadAccess, StorageMapWriteAccess,
    };
    use starknet::{ContractAddress, get_caller_address, get_block_timestamp};
    use core::num::traits::Zero;
    use vmol::types::{WAD, wmul, wdiv};

    #[storage]
    struct Storage {
        admin: ContractAddress,
        // Risk parameters (WAD-scaled, e.g. 0.75e18 = 75%)
        ltv: u256,
        liquidation_threshold: u256,
        // Oracle
        collateral_price: u256,
        // Pool state
        total_deposits: u256,
        total_borrows: u256,
        // Per-user positions
        user_collateral: Map<ContractAddress, u256>,
        user_debt: Map<ContractAddress, u256>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        Deposit: Deposit,
        Borrow: Borrow,
        Repay: Repay,
        Liquidation: Liquidation,
        LTVUpdated: LTVUpdated,
        LiquidationThresholdUpdated: LiquidationThresholdUpdated,
        CollateralPriceUpdated: CollateralPriceUpdated,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Deposit {
        #[key]
        pub user: ContractAddress,
        pub amount: u256,
        pub timestamp: u64,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Borrow {
        #[key]
        pub user: ContractAddress,
        pub amount: u256,
        pub timestamp: u64,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Repay {
        #[key]
        pub user: ContractAddress,
        pub amount: u256,
        pub timestamp: u64,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Liquidation {
        #[key]
        pub user: ContractAddress,
        pub debt_covered: u256,
        pub collateral_seized: u256,
        pub timestamp: u64,
    }

    #[derive(Drop, starknet::Event)]
    pub struct LTVUpdated {
        pub old_ltv: u256,
        pub new_ltv: u256,
        pub timestamp: u64,
    }

    #[derive(Drop, starknet::Event)]
    pub struct LiquidationThresholdUpdated {
        pub old_threshold: u256,
        pub new_threshold: u256,
        pub timestamp: u64,
    }

    #[derive(Drop, starknet::Event)]
    pub struct CollateralPriceUpdated {
        pub old_price: u256,
        pub new_price: u256,
        pub timestamp: u64,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        admin: ContractAddress,
        initial_ltv: u256,
        initial_liq_threshold: u256,
        initial_collateral_price: u256,
    ) {
        assert(!admin.is_zero(), 'POOL: admin is zero');
        assert(initial_ltv <= WAD, 'POOL: ltv > 100%');
        assert(initial_liq_threshold <= WAD, 'POOL: liq_thresh > 100%');
        assert(initial_ltv <= initial_liq_threshold, 'POOL: ltv > liq_thresh');

        self.admin.write(admin);
        self.ltv.write(initial_ltv);
        self.liquidation_threshold.write(initial_liq_threshold);
        self.collateral_price.write(initial_collateral_price);
    }

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        fn _assert_admin(self: @ContractState) {
            assert(get_caller_address() == self.admin.read(), 'POOL: not admin');
        }

        fn _health_factor(self: @ContractState, user: ContractAddress) -> u256 {
            let debt = self.user_debt.read(user);
            if debt == 0 {
                return WAD * 1000; // no debt = infinite health
            }
            let collateral = self.user_collateral.read(user);
            let price = self.collateral_price.read();
            let collateral_value = wmul(collateral, price);
            let liq_threshold = self.liquidation_threshold.read();
            // health_factor = (collateral_value * liq_threshold) / debt
            wdiv(wmul(collateral_value, liq_threshold), debt)
        }
    }

    #[abi(embed_v0)]
    impl MockAavePoolImpl of vmol::interfaces::i_mock_aave_pool::IMockAavePool<ContractState> {
        fn set_ltv(ref self: ContractState, ltv: u256) {
            self._assert_admin();
            assert(ltv <= WAD, 'POOL: ltv > 100%');
            let old = self.ltv.read();
            self.ltv.write(ltv);
            self.emit(LTVUpdated { old_ltv: old, new_ltv: ltv, timestamp: get_block_timestamp() });
        }

        fn set_liquidation_threshold(ref self: ContractState, threshold: u256) {
            self._assert_admin();
            assert(threshold <= WAD, 'POOL: threshold > 100%');
            let old = self.liquidation_threshold.read();
            self.liquidation_threshold.write(threshold);
            self.emit(LiquidationThresholdUpdated {
                old_threshold: old, new_threshold: threshold, timestamp: get_block_timestamp(),
            });
        }

        fn set_collateral_price(ref self: ContractState, price: u256) {
            self._assert_admin();
            let old = self.collateral_price.read();
            self.collateral_price.write(price);
            self.emit(CollateralPriceUpdated {
                old_price: old, new_price: price, timestamp: get_block_timestamp(),
            });
        }

        fn deposit(ref self: ContractState, amount: u256) {
            assert(amount > 0, 'POOL: zero deposit');
            let caller = get_caller_address();
            let current = self.user_collateral.read(caller);
            self.user_collateral.write(caller, current + amount);
            self.total_deposits.write(self.total_deposits.read() + amount);
            self.emit(Deposit { user: caller, amount, timestamp: get_block_timestamp() });
        }

        fn borrow(ref self: ContractState, amount: u256) {
            assert(amount > 0, 'POOL: zero borrow');
            let caller = get_caller_address();
            let collateral = self.user_collateral.read(caller);
            let price = self.collateral_price.read();
            let collateral_value = wmul(collateral, price);
            let max_borrow = wmul(collateral_value, self.ltv.read());
            let current_debt = self.user_debt.read(caller);
            assert(current_debt + amount <= max_borrow, 'POOL: exceeds LTV');

            self.user_debt.write(caller, current_debt + amount);
            self.total_borrows.write(self.total_borrows.read() + amount);
            self.emit(Borrow { user: caller, amount, timestamp: get_block_timestamp() });
        }

        fn repay(ref self: ContractState, amount: u256) {
            let caller = get_caller_address();
            let debt = self.user_debt.read(caller);
            let actual = if amount > debt { debt } else { amount };
            self.user_debt.write(caller, debt - actual);
            self.total_borrows.write(self.total_borrows.read() - actual);
            self.emit(Repay { user: caller, amount: actual, timestamp: get_block_timestamp() });
        }

        fn liquidate(ref self: ContractState, user: ContractAddress) {
            let hf = self._health_factor(user);
            assert(hf < WAD, 'POOL: not liquidatable');

            let debt = self.user_debt.read(user);
            let collateral = self.user_collateral.read(user);
            let price = self.collateral_price.read();
            // Liquidation bonus: seize 110% of debt value in collateral
            let bonus: u256 = WAD + WAD / 10; // 1.1e18
            let collateral_to_seize = wdiv(wmul(debt, bonus), price);
            let actual_seized = if collateral_to_seize > collateral {
                collateral
            } else {
                collateral_to_seize
            };

            self.user_collateral.write(user, collateral - actual_seized);
            self.user_debt.write(user, 0);
            self.total_borrows.write(self.total_borrows.read() - debt);
            self.total_deposits.write(self.total_deposits.read() - actual_seized);

            self.emit(Liquidation {
                user, debt_covered: debt, collateral_seized: actual_seized,
                timestamp: get_block_timestamp(),
            });
        }

        fn get_ltv(self: @ContractState) -> u256 {
            self.ltv.read()
        }

        fn get_liquidation_threshold(self: @ContractState) -> u256 {
            self.liquidation_threshold.read()
        }

        fn get_collateral_price(self: @ContractState) -> u256 {
            self.collateral_price.read()
        }

        fn get_user_collateral(self: @ContractState, user: ContractAddress) -> u256 {
            self.user_collateral.read(user)
        }

        fn get_user_debt(self: @ContractState, user: ContractAddress) -> u256 {
            self.user_debt.read(user)
        }

        fn get_health_factor(self: @ContractState, user: ContractAddress) -> u256 {
            self._health_factor(user)
        }

        fn get_utilization_rate(self: @ContractState) -> u256 {
            let deposits = self.total_deposits.read();
            if deposits == 0 {
                return 0;
            }
            wdiv(self.total_borrows.read(), deposits)
        }

        fn get_total_deposits(self: @ContractState) -> u256 {
            self.total_deposits.read()
        }

        fn get_total_borrows(self: @ContractState) -> u256 {
            self.total_borrows.read()
        }
    }

    #[external(v0)]
    fn transfer_admin(ref self: ContractState, new_admin: ContractAddress) {
        self._assert_admin();
        assert(!new_admin.is_zero(), 'POOL: new admin is zero');
        self.admin.write(new_admin);
    }

    #[external(v0)]
    fn get_admin(self: @ContractState) -> ContractAddress {
        self.admin.read()
    }
}
