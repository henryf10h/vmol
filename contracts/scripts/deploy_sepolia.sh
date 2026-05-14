#!/usr/bin/env bash
# VMOL Protocol — Sepolia Deployment
# Deploys MockAavePool + RiskGovernor, wires admin transfer to governor.

set -euo pipefail

# --- Config ---
RPC_URL="https://starknet-sepolia.g.alchemy.com/starknet/version/rpc/v0_10/_zuaFihvvIkJ2dwMdRZ0_"
ACCOUNT="account_ready"
DEPLOYER="0x072f0d2391f7ce9103d31a64b6a36e0fe8d32f908d2e183a02d9d46403b21ce2"
AGENT_ADDRESS="0x1f8975c5a1c6d2764bd30dddf4d6ab80c59e8287e5f796a5ba2490dcbf2dab6"

# Pool initial parameters (WAD-scaled)
WAD="1000000000000000000"
INIT_LTV="750000000000000000"            # 0.75
INIT_LIQ_THRESHOLD="800000000000000000"  # 0.80
INIT_ETH_PRICE="2000000000000000000000"  # 2000 USD (WAD)

# RiskPolicy bounds (matches RiskGovernor.cairo)
POLICY_LTV_MIN="500000000000000000"             # 0.50
POLICY_LTV_MAX="850000000000000000"             # 0.85
POLICY_LIQ_THRESHOLD_MIN="600000000000000000"   # 0.60
POLICY_LIQ_THRESHOLD_MAX="900000000000000000"   # 0.90
POLICY_MAX_LTV_DELTA="50000000000000000"        # 0.05
POLICY_MAX_LIQ_THRESHOLD_DELTA="50000000000000000"
POLICY_COOLDOWN="60"
POLICY_EMERGENCY_COOLDOWN="10"
POLICY_MAX_UPDATES="1000"

OUTPUT_FILE="deployed_sepolia.json"

extract_address() {
    echo "$1" | grep -oiP 'Contract Address:\s*\K0x[0-9a-fA-F]+' | head -1
}

extract_class_hash() {
    echo "$1" | grep -oiP 'Class [Hh]ash:\s*\K0x[0-9a-fA-F]+' | head -1
}

declare_contract() {
    local name=$1
    echo ">>> Declaring $name..." >&2
    local out
    out=$(sncast --account "$ACCOUNT" declare --url "$RPC_URL" --contract-name "$name" 2>&1) || {
        # If already declared, extract from error
        if echo "$out" | grep -q "is already declared"; then
            echo "    Already declared, extracting hash..." >&2
            local hash
            hash=$(echo "$out" | grep -oP 'class hash:\s*\K0x[0-9a-fA-F]+' | head -1)
            if [ -z "$hash" ]; then
                hash=$(echo "$out" | grep -oP '0x[0-9a-fA-F]{60,}' | head -1)
            fi
            echo "$hash"
            return 0
        fi
        echo "FAILED:" >&2
        echo "$out" >&2
        return 1
    }
    extract_class_hash "$out"
}

deploy_contract() {
    local class_hash=$1
    local args=$2
    local name=$3
    echo ">>> Deploying $name..." >&2
    local out
    out=$(sncast --account "$ACCOUNT" deploy --url "$RPC_URL" --class-hash "$class_hash" --arguments "$args" 2>&1)
    if [ $? -ne 0 ]; then
        echo "FAILED to deploy $name:" >&2
        echo "$out" >&2
        return 1
    fi
    extract_address "$out"
}

echo "==============================================="
echo "VMOL Protocol — Sepolia Deployment"
echo "==============================================="
echo "Account:  $ACCOUNT"
echo "Deployer: $DEPLOYER"
echo "Agent:    $AGENT_ADDRESS"
echo ""

# 1. Declare contracts
POOL_CLASS=$(declare_contract "MockAavePool")
echo "MockAavePool class:  $POOL_CLASS"

GOV_CLASS=$(declare_contract "RiskGovernor")
echo "RiskGovernor class:  $GOV_CLASS"

ORACLE_CLASS=$(declare_contract "MockPriceOracle")
echo "MockPriceOracle class: $ORACLE_CLASS"

echo ""
echo "==============================================="
echo "Deploying contracts..."
echo "==============================================="

# 2. Deploy MockAavePool — args: admin, initial_ltv, initial_liq_threshold, initial_collateral_price
# u256 takes 2 felts (low, high), so we use full u256 representation: low high
POOL_ARGS="$DEPLOYER $INIT_LTV 0 $INIT_LIQ_THRESHOLD 0 $INIT_ETH_PRICE 0"
POOL_ADDR=$(deploy_contract "$POOL_CLASS" "$POOL_ARGS" "MockAavePool")
echo "MockAavePool:  $POOL_ADDR"

# 3. Deploy RiskGovernor — args: admin, pool, agent, policy(struct - 9 u256 + 2 u64 + 1 u32)
# Struct serialization: each u256 = 2 felts, each u64/u32 = 1 felt
GOV_ARGS="$DEPLOYER $POOL_ADDR $AGENT_ADDRESS $POLICY_LTV_MIN 0 $POLICY_LTV_MAX 0 $POLICY_LIQ_THRESHOLD_MIN 0 $POLICY_LIQ_THRESHOLD_MAX 0 $POLICY_MAX_LTV_DELTA 0 $POLICY_MAX_LIQ_THRESHOLD_DELTA 0 $POLICY_COOLDOWN $POLICY_EMERGENCY_COOLDOWN $POLICY_MAX_UPDATES"
GOV_ADDR=$(deploy_contract "$GOV_CLASS" "$GOV_ARGS" "RiskGovernor")
echo "RiskGovernor:  $GOV_ADDR"

# 4. Deploy MockPriceOracle — args: admin, initial_price
ORACLE_ARGS="$DEPLOYER $INIT_ETH_PRICE 0"
ORACLE_ADDR=$(deploy_contract "$ORACLE_CLASS" "$ORACLE_ARGS" "MockPriceOracle")
echo "MockPriceOracle: $ORACLE_ADDR"

echo ""
echo "==============================================="
echo "Transferring pool admin to RiskGovernor..."
echo "==============================================="
sncast --account "$ACCOUNT" invoke --url "$RPC_URL" \
    --contract-address "$POOL_ADDR" \
    --function "transfer_admin" \
    --arguments "$GOV_ADDR" 2>&1 || echo "(transfer_admin may have failed — check manually)"

# 5. Save addresses
cat > "$OUTPUT_FILE" <<EOF
{
  "network": "sepolia",
  "rpc_url": "$RPC_URL",
  "deployer": "$DEPLOYER",
  "agent": "$AGENT_ADDRESS",
  "contracts": {
    "MockAavePool": "$POOL_ADDR",
    "RiskGovernor": "$GOV_ADDR",
    "MockPriceOracle": "$ORACLE_ADDR"
  },
  "class_hashes": {
    "MockAavePool": "$POOL_CLASS",
    "RiskGovernor": "$GOV_CLASS",
    "MockPriceOracle": "$ORACLE_CLASS"
  }
}
EOF

echo ""
echo "==============================================="
echo "DEPLOYMENT COMPLETE"
echo "==============================================="
cat "$OUTPUT_FILE"
echo ""
echo "View on Voyager:"
echo "  Pool:    https://sepolia.voyager.online/contract/$POOL_ADDR"
echo "  Gov:     https://sepolia.voyager.online/contract/$GOV_ADDR"
echo "  Oracle:  https://sepolia.voyager.online/contract/$ORACLE_ADDR"
