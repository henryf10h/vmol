use snforge_std::{
    declare, ContractClassTrait, DeclareResultTrait,
    start_cheat_caller_address, stop_cheat_caller_address,
    start_cheat_block_timestamp, stop_cheat_block_timestamp,
};
use starknet::ContractAddress;
use vmol::types::{WAD, RiskPolicy};
use vmol::interfaces::i_mock_aave_pool::{IMockAavePoolDispatcher, IMockAavePoolDispatcherTrait};
use vmol::interfaces::i_risk_governor::{IRiskGovernorDispatcher, IRiskGovernorDispatcherTrait};

fn ADMIN() -> ContractAddress {
    'ADMIN'.try_into().unwrap()
}

fn AGENT() -> ContractAddress {
    'AGENT'.try_into().unwrap()
}

fn USER() -> ContractAddress {
    'USER'.try_into().unwrap()
}

fn default_policy() -> RiskPolicy {
    RiskPolicy {
        ltv_min: WAD * 50 / 100,           // 50%
        ltv_max: WAD * 85 / 100,           // 85%
        liq_threshold_min: WAD * 60 / 100, // 60%
        liq_threshold_max: WAD * 90 / 100, // 90%
        max_ltv_delta: WAD * 5 / 100,      // 5% max change per update
        max_liq_threshold_delta: WAD * 5 / 100,
        cooldown_seconds: 60,
        emergency_cooldown_seconds: 10,
        max_updates: 0, // unlimited
    }
}

fn deploy_pool() -> IMockAavePoolDispatcher {
    let contract = declare("MockAavePool").unwrap().contract_class();
    let ltv = WAD * 75 / 100;           // 75%
    let liq_threshold = WAD * 80 / 100; // 80%
    let eth_price = 2000 * WAD;          // $2000
    let mut calldata: Array<felt252> = array![];
    ADMIN().serialize(ref calldata);
    ltv.serialize(ref calldata);
    liq_threshold.serialize(ref calldata);
    eth_price.serialize(ref calldata);
    let (addr, _) = contract.deploy(@calldata).unwrap();
    IMockAavePoolDispatcher { contract_address: addr }
}

fn deploy_governor(pool_addr: ContractAddress) -> IRiskGovernorDispatcher {
    let contract = declare("RiskGovernor").unwrap().contract_class();
    let policy = default_policy();
    let mut calldata: Array<felt252> = array![];
    ADMIN().serialize(ref calldata);
    pool_addr.serialize(ref calldata);
    AGENT().serialize(ref calldata);
    policy.serialize(ref calldata);
    let (addr, _) = contract.deploy(@calldata).unwrap();
    IRiskGovernorDispatcher { contract_address: addr }
}

#[test]
fn test_pool_deposit_and_borrow() {
    let pool = deploy_pool();
    start_cheat_caller_address(pool.contract_address, USER());

    pool.deposit(10 * WAD); // 10 ETH
    assert(pool.get_user_collateral(USER()) == 10 * WAD, 'wrong collateral');

    // 10 ETH * $2000 * 75% LTV = $15,000 max borrow
    pool.borrow(15000 * WAD);
    assert(pool.get_user_debt(USER()) == 15000 * WAD, 'wrong debt');

    stop_cheat_caller_address(pool.contract_address);
}

#[test]
#[should_panic(expected: 'POOL: exceeds LTV')]
fn test_pool_borrow_exceeds_ltv() {
    let pool = deploy_pool();
    start_cheat_caller_address(pool.contract_address, USER());
    pool.deposit(10 * WAD);
    pool.borrow(16000 * WAD); // > $15,000 max
    stop_cheat_caller_address(pool.contract_address);
}

#[test]
fn test_health_factor_and_liquidation() {
    let pool = deploy_pool();

    start_cheat_caller_address(pool.contract_address, USER());
    pool.deposit(10 * WAD);
    pool.borrow(15000 * WAD);
    stop_cheat_caller_address(pool.contract_address);

    // Crash ETH price to $1000
    start_cheat_caller_address(pool.contract_address, ADMIN());
    pool.set_collateral_price(1000 * WAD);
    stop_cheat_caller_address(pool.contract_address);

    // health = (10 * 1000 * 0.80) / 15000 = 0.533 < 1.0
    let hf = pool.get_health_factor(USER());
    assert(hf < WAD, 'should be liquidatable');

    // Liquidate
    start_cheat_caller_address(pool.contract_address, ADMIN());
    pool.liquidate(USER());
    stop_cheat_caller_address(pool.contract_address);

    assert(pool.get_user_debt(USER()) == 0, 'debt should be zero');
}

#[test]
fn test_governor_propose_parameters() {
    let pool = deploy_pool();
    let gov = deploy_governor(pool.contract_address);

    // Transfer pool admin to governor
    start_cheat_caller_address(pool.contract_address, ADMIN());
    starknet::syscalls::call_contract_syscall(
        pool.contract_address,
        selector!("transfer_admin"),
        array![gov.contract_address.into()].span(),
    ).unwrap();
    stop_cheat_caller_address(pool.contract_address);

    // Agent proposes lower LTV (market getting risky)
    start_cheat_caller_address(gov.contract_address, AGENT());
    start_cheat_block_timestamp(gov.contract_address, 100);
    gov.propose_parameters(
        WAD * 70 / 100, // 70% LTV (was 75%)
        WAD * 78 / 100, // 78% liq threshold (was 80%)
        false,
    );
    stop_cheat_block_timestamp(gov.contract_address);
    stop_cheat_caller_address(gov.contract_address);

    assert(pool.get_ltv() == WAD * 70 / 100, 'ltv not updated');
    assert(pool.get_liquidation_threshold() == WAD * 78 / 100, 'liq_thresh not updated');
    assert(gov.get_update_count() == 1, 'count not updated');
}

#[test]
#[should_panic(expected: 'GOV: not agent')]
fn test_governor_rejects_non_agent() {
    let pool = deploy_pool();
    let gov = deploy_governor(pool.contract_address);

    start_cheat_caller_address(gov.contract_address, USER());
    gov.propose_parameters(WAD * 70 / 100, WAD * 78 / 100, false);
    stop_cheat_caller_address(gov.contract_address);
}

#[test]
#[should_panic(expected: 'GOV: ltv delta too large')]
fn test_governor_rejects_large_delta() {
    let pool = deploy_pool();
    let gov = deploy_governor(pool.contract_address);

    // Try to change LTV from 75% to 50% (25% delta, max is 5%)
    start_cheat_caller_address(gov.contract_address, AGENT());
    start_cheat_block_timestamp(gov.contract_address, 100);
    gov.propose_parameters(WAD * 50 / 100, WAD * 80 / 100, false);
    stop_cheat_block_timestamp(gov.contract_address);
    stop_cheat_caller_address(gov.contract_address);
}

#[test]
fn test_governor_emergency_stop() {
    let pool = deploy_pool();
    let gov = deploy_governor(pool.contract_address);

    start_cheat_caller_address(gov.contract_address, ADMIN());
    gov.emergency_stop();
    stop_cheat_caller_address(gov.contract_address);

    assert(gov.is_stopped(), 'should be stopped');
}

#[test]
fn test_full_scenario_eth_crash() {
    let pool = deploy_pool();
    let gov = deploy_governor(pool.contract_address);

    // Transfer pool admin to governor
    start_cheat_caller_address(pool.contract_address, ADMIN());
    starknet::syscalls::call_contract_syscall(
        pool.contract_address,
        selector!("transfer_admin"),
        array![gov.contract_address.into()].span(),
    ).unwrap();
    stop_cheat_caller_address(pool.contract_address);

    // User deposits and borrows at max LTV
    start_cheat_caller_address(pool.contract_address, USER());
    pool.deposit(10 * WAD);
    pool.borrow(15000 * WAD);
    stop_cheat_caller_address(pool.contract_address);

    // AI agent detects incoming crash risk → lowers LTV preemptively
    start_cheat_caller_address(gov.contract_address, AGENT());
    start_cheat_block_timestamp(gov.contract_address, 100);
    gov.propose_parameters(
        WAD * 70 / 100, // lower LTV from 75% to 70%
        WAD * 76 / 100, // lower liq threshold from 80% to 76%
        true,           // emergency mode
    );
    stop_cheat_block_timestamp(gov.contract_address);
    stop_cheat_caller_address(gov.contract_address);

    // Verify parameters changed
    assert(pool.get_ltv() == WAD * 70 / 100, 'ltv should be 70%');
    assert(pool.get_liquidation_threshold() == WAD * 76 / 100, 'lt should be 76%');

    // New borrowers can only borrow at 70% LTV now
    // Existing positions are safer because liquidation triggers earlier
}
