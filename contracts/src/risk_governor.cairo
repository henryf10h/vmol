/// RiskGovernor — AI-driven risk parameter governance for MockAavePool
/// Allows an authorized agent (AI) to modify LTV and liquidation threshold
/// within safe bounds defined by a human admin.
///
/// Enforcement layers:
///   1. Identity: caller must be the registered agent address
///   2. Bounds: new values within absolute min/max AND per-call delta cap
///   3. Rate limit: cooldown + call budget
///   4. Invariant: LTV must always be <= liquidation_threshold
#[starknet::contract]
pub mod RiskGovernor {
    use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};
    use starknet::{ContractAddress, get_caller_address, get_block_timestamp};
    use core::num::traits::Zero;
    use vmol::types::{WAD, RiskPolicy};
    use vmol::interfaces::i_mock_aave_pool::{IMockAavePoolDispatcher, IMockAavePoolDispatcherTrait};

    #[storage]
    struct Storage {
        admin: ContractAddress,
        pool: ContractAddress,
        agent: ContractAddress,
        // Policy bounds
        policy_ltv_min: u256,
        policy_ltv_max: u256,
        policy_liq_threshold_min: u256,
        policy_liq_threshold_max: u256,
        policy_max_ltv_delta: u256,
        policy_max_liq_threshold_delta: u256,
        policy_cooldown_seconds: u64,
        policy_emergency_cooldown_seconds: u64,
        policy_max_updates: u32,
        // State
        stopped: bool,
        update_count: u32,
        last_update_timestamp: u64,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        ParameterUpdate: ParameterUpdate,
        EmergencyStop: EmergencyStop,
        Resumed: Resumed,
        PolicyUpdated: PolicyUpdated,
        AgentUpdated: AgentUpdated,
    }

    #[derive(Drop, starknet::Event)]
    pub struct ParameterUpdate {
        #[key]
        pub agent: ContractAddress,
        pub old_ltv: u256,
        pub new_ltv: u256,
        pub old_liq_threshold: u256,
        pub new_liq_threshold: u256,
        pub update_number: u32,
        pub emergency_mode: bool,
        pub timestamp: u64,
    }

    #[derive(Drop, starknet::Event)]
    pub struct EmergencyStop {
        #[key]
        pub admin: ContractAddress,
        pub timestamp: u64,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Resumed {
        #[key]
        pub admin: ContractAddress,
        pub timestamp: u64,
    }

    #[derive(Drop, starknet::Event)]
    pub struct PolicyUpdated {
        #[key]
        pub admin: ContractAddress,
        pub timestamp: u64,
    }

    #[derive(Drop, starknet::Event)]
    pub struct AgentUpdated {
        #[key]
        pub admin: ContractAddress,
        pub new_agent: ContractAddress,
        pub timestamp: u64,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        admin: ContractAddress,
        pool: ContractAddress,
        agent: ContractAddress,
        policy: RiskPolicy,
    ) {
        assert(!admin.is_zero(), 'GOV: admin is zero');
        assert(!pool.is_zero(), 'GOV: pool is zero');
        assert(!agent.is_zero(), 'GOV: agent is zero');

        self.admin.write(admin);
        self.pool.write(pool);
        self.agent.write(agent);
        self._write_policy(policy);
        self.stopped.write(false);
        self.update_count.write(0);
        self.last_update_timestamp.write(0);
    }

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        fn _assert_admin(self: @ContractState) {
            assert(get_caller_address() == self.admin.read(), 'GOV: not admin');
        }

        fn _assert_agent(self: @ContractState) {
            assert(get_caller_address() == self.agent.read(), 'GOV: not agent');
        }

        fn _pool(self: @ContractState) -> IMockAavePoolDispatcher {
            IMockAavePoolDispatcher { contract_address: self.pool.read() }
        }

        fn _abs_diff(self: @ContractState, a: u256, b: u256) -> u256 {
            if a >= b { a - b } else { b - a }
        }

        fn _write_policy(ref self: ContractState, p: RiskPolicy) {
            assert(p.ltv_min <= p.ltv_max, 'GOV: ltv_min > ltv_max');
            assert(p.liq_threshold_min <= p.liq_threshold_max, 'GOV: lt_min > lt_max');
            assert(p.ltv_max <= p.liq_threshold_max, 'GOV: ltv_max > lt_max');
            assert(p.ltv_max <= WAD, 'GOV: ltv_max > 100%');
            assert(p.liq_threshold_max <= WAD, 'GOV: lt_max > 100%');
            assert(
                p.emergency_cooldown_seconds <= p.cooldown_seconds,
                'GOV: emg_cd > normal_cd',
            );

            self.policy_ltv_min.write(p.ltv_min);
            self.policy_ltv_max.write(p.ltv_max);
            self.policy_liq_threshold_min.write(p.liq_threshold_min);
            self.policy_liq_threshold_max.write(p.liq_threshold_max);
            self.policy_max_ltv_delta.write(p.max_ltv_delta);
            self.policy_max_liq_threshold_delta.write(p.max_liq_threshold_delta);
            self.policy_cooldown_seconds.write(p.cooldown_seconds);
            self.policy_emergency_cooldown_seconds.write(p.emergency_cooldown_seconds);
            self.policy_max_updates.write(p.max_updates);
        }

        fn _read_policy(self: @ContractState) -> RiskPolicy {
            RiskPolicy {
                ltv_min: self.policy_ltv_min.read(),
                ltv_max: self.policy_ltv_max.read(),
                liq_threshold_min: self.policy_liq_threshold_min.read(),
                liq_threshold_max: self.policy_liq_threshold_max.read(),
                max_ltv_delta: self.policy_max_ltv_delta.read(),
                max_liq_threshold_delta: self.policy_max_liq_threshold_delta.read(),
                cooldown_seconds: self.policy_cooldown_seconds.read(),
                emergency_cooldown_seconds: self.policy_emergency_cooldown_seconds.read(),
                max_updates: self.policy_max_updates.read(),
            }
        }
    }

    #[abi(embed_v0)]
    impl RiskGovernorImpl of vmol::interfaces::i_risk_governor::IRiskGovernor<ContractState> {
        fn propose_parameters(
            ref self: ContractState, new_ltv: u256, new_liq_threshold: u256, is_emergency: bool,
        ) {
            self._assert_agent();
            assert(!self.stopped.read(), 'GOV: stopped');

            // Invariant: LTV must be <= liquidation threshold
            assert(new_ltv <= new_liq_threshold, 'GOV: ltv > liq_threshold');

            // Budget check
            let count = self.update_count.read();
            let max = self.policy_max_updates.read();
            if max > 0 {
                assert(count < max, 'GOV: budget exhausted');
            }

            // Cooldown check
            let now = get_block_timestamp();
            let last = self.last_update_timestamp.read();
            if last > 0 {
                let cooldown = if is_emergency {
                    self.policy_emergency_cooldown_seconds.read()
                } else {
                    self.policy_cooldown_seconds.read()
                };
                assert(now >= last + cooldown, 'GOV: cooldown active');
            }

            // Absolute bounds
            assert(new_ltv >= self.policy_ltv_min.read(), 'GOV: ltv below min');
            assert(new_ltv <= self.policy_ltv_max.read(), 'GOV: ltv above max');
            assert(new_liq_threshold >= self.policy_liq_threshold_min.read(), 'GOV: lt below min');
            assert(new_liq_threshold <= self.policy_liq_threshold_max.read(), 'GOV: lt above max');

            // Delta caps
            let pool = self._pool();
            let old_ltv = pool.get_ltv();
            let old_liq_threshold = pool.get_liquidation_threshold();

            let ltv_delta = self._abs_diff(new_ltv, old_ltv);
            let lt_delta = self._abs_diff(new_liq_threshold, old_liq_threshold);
            assert(ltv_delta <= self.policy_max_ltv_delta.read(), 'GOV: ltv delta too large');
            assert(
                lt_delta <= self.policy_max_liq_threshold_delta.read(), 'GOV: lt delta too large',
            );

            // Update state
            let new_count = count + 1;
            self.update_count.write(new_count);
            self.last_update_timestamp.write(now);

            // Apply to pool
            pool.set_ltv(new_ltv);
            pool.set_liquidation_threshold(new_liq_threshold);

            self.emit(ParameterUpdate {
                agent: get_caller_address(),
                old_ltv,
                new_ltv,
                old_liq_threshold,
                new_liq_threshold,
                update_number: new_count,
                emergency_mode: is_emergency,
                timestamp: now,
            });
        }

        fn set_agent(ref self: ContractState, agent: ContractAddress) {
            self._assert_admin();
            assert(!agent.is_zero(), 'GOV: agent is zero');
            self.agent.write(agent);
            self.emit(AgentUpdated {
                admin: get_caller_address(),
                new_agent: agent,
                timestamp: get_block_timestamp(),
            });
        }

        fn set_policy(ref self: ContractState, policy: RiskPolicy) {
            self._assert_admin();
            self._write_policy(policy);
            self.emit(PolicyUpdated {
                admin: get_caller_address(),
                timestamp: get_block_timestamp(),
            });
        }

        fn emergency_stop(ref self: ContractState) {
            self._assert_admin();
            self.stopped.write(true);
            self.emit(EmergencyStop {
                admin: get_caller_address(),
                timestamp: get_block_timestamp(),
            });
        }

        fn resume(ref self: ContractState) {
            self._assert_admin();
            self.stopped.write(false);
            self.emit(Resumed {
                admin: get_caller_address(),
                timestamp: get_block_timestamp(),
            });
        }

        fn get_policy(self: @ContractState) -> RiskPolicy {
            self._read_policy()
        }

        fn get_agent(self: @ContractState) -> ContractAddress {
            self.agent.read()
        }

        fn is_stopped(self: @ContractState) -> bool {
            self.stopped.read()
        }

        fn get_update_count(self: @ContractState) -> u32 {
            self.update_count.read()
        }

        fn get_last_update_timestamp(self: @ContractState) -> u64 {
            self.last_update_timestamp.read()
        }
    }

    #[external(v0)]
    fn transfer_admin(ref self: ContractState, new_admin: ContractAddress) {
        self._assert_admin();
        assert(!new_admin.is_zero(), 'GOV: new admin is zero');
        self.admin.write(new_admin);
    }

    #[external(v0)]
    fn reset_budget(ref self: ContractState) {
        self._assert_admin();
        self.update_count.write(0);
    }
}
