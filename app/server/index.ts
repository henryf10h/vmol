import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();

import {
  proposeParameters,
  voyagerUrl,
  voyagerContractUrl,
  POOL_ADDRESS,
  GOVERNOR_ADDRESS,
} from "./starknet.js";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = parseInt(process.env.PORT || "3001");

// ============================================================================
// Mock Pool State (in-memory simulation)
// ============================================================================

interface PoolState {
  ethPrice: number;
  ltv: number;
  liqThreshold: number;
  totalDeposits: number;
  totalBorrows: number;
  utilizationRate: number;
  avgHealthFactor: number;
  minHealthFactor: number;
  nLiquidations: number;
  badDebt: number;
  nActiveUsers: number;
  guardUpdateCount: number;
}

interface Decision {
  timestamp: number;
  action: string;
  oldLtv: number;
  newLtv: number;
  oldLiqThreshold: number;
  newLiqThreshold: number;
  isEmergency: boolean;
  reasoning: string;
  accepted: boolean;
}

const GUARD = {
  ltvMin: 0.50,
  ltvMax: 0.85,
  liqThresholdMin: 0.60,
  liqThresholdMax: 0.90,
  maxLtvDelta: 0.05,
  maxLiqThresholdDelta: 0.05,
};

let poolState: PoolState = {
  ethPrice: 2000,
  ltv: 0.75,
  liqThreshold: 0.80,
  totalDeposits: 500,
  totalBorrows: 600000,
  utilizationRate: 0.60,
  avgHealthFactor: 1.78,
  minHealthFactor: 1.25,
  nLiquidations: 0,
  badDebt: 0,
  nActiveUsers: 20,
  guardUpdateCount: 0,
};

let ethPriceHistory: number[] = [2000];
let healthFactorHistory: number[] = [1.78];
let decisions: Decision[] = [];

function recalcPoolMetrics() {
  const depositValue = poolState.totalDeposits * poolState.ethPrice;
  poolState.utilizationRate = depositValue > 0 ? poolState.totalBorrows / depositValue : 0;
  poolState.avgHealthFactor = depositValue > 0
    ? (depositValue * poolState.liqThreshold) / poolState.totalBorrows
    : 100;
  poolState.minHealthFactor = poolState.avgHealthFactor * 0.7;

  if (poolState.minHealthFactor < 1.0 && poolState.nActiveUsers > 0) {
    const toLiquidate = Math.ceil(poolState.nActiveUsers * 0.1);
    poolState.nLiquidations += toLiquidate;
    poolState.nActiveUsers -= toLiquidate;
    const lostDebt = poolState.totalBorrows * 0.1;
    const lostCollateral = poolState.totalDeposits * 0.1;
    if (lostCollateral * poolState.ethPrice < lostDebt) {
      poolState.badDebt += lostDebt - lostCollateral * poolState.ethPrice;
    }
    poolState.totalBorrows -= lostDebt;
    poolState.totalDeposits -= lostCollateral;
    recalcPoolMetrics();
  }

  ethPriceHistory.push(poolState.ethPrice);
  if (ethPriceHistory.length > 100) ethPriceHistory.shift();
  healthFactorHistory.push(poolState.avgHealthFactor);
  if (healthFactorHistory.length > 100) healthFactorHistory.shift();
}

// ============================================================================
// SSE Broadcast
// ============================================================================

const sseClients: Set<express.Response> = new Set();

function broadcast(event: string, data: any) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    client.write(msg);
  }
}

app.get("/api/stream", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  sseClients.add(res);
  req.on("close", () => sseClients.delete(res));

  res.write(`event: state\ndata: ${JSON.stringify(poolState)}\n\n`);
});

// ============================================================================
// LLM Integration
// ============================================================================

const llm = new OpenAI({
  apiKey: process.env.LLM_API_KEY || "dummy",
  baseURL: process.env.LLM_BASE_URL || "https://openrouter.ai/api/v1",
});

const SYSTEM_PROMPT = `You are an autonomous AI Risk Governor for a lending protocol (similar to Aave). You adjust risk parameters to protect the pool from bad debt while maintaining capital efficiency.

MECHANICS:
- LTV (loan-to-value): determines max borrowing power. 75% LTV = users borrow up to 75% of collateral value.
- Liquidation Threshold: health_factor = (collateral_value * liq_threshold) / debt. Below 1.0 = liquidation.
- Lower LTV/threshold = safer but less capital efficient.
- Higher LTV/threshold = more efficient but riskier.

HARD BOUNDS (on-chain RiskGovernor):
- LTV in [0.50, 0.85], Liq Threshold in [0.60, 0.90]
- Max change per update: 5% (0.05)
- LTV must always be <= liquidation_threshold

DECISION FRAMEWORK:
- HOLD: ETH stable, health factors > 1.5 → no change
- ADJUST: moderate ETH drop (5-10%) or declining health factors → lower incrementally
- ADJUST_EMERGENCY: severe ETH drop (>10%) or health factors near 1.0 → lower aggressively

OUTPUT — ONE valid JSON object, nothing else:
{"action":"hold|adjust|adjust_emergency","new_ltv":<float>,"new_liq_threshold":<float>,"is_emergency":<bool>,"reasoning":"<one sentence>"}`;

async function runAgentCycle(): Promise<Decision> {
  const ethReturns = [];
  for (let i = 1; i < ethPriceHistory.length; i++) {
    ethReturns.push(((ethPriceHistory[i] - ethPriceHistory[i - 1]) / ethPriceHistory[i - 1]).toFixed(4));
  }

  const userPrompt = `POOL STATE:
- eth_price_usd: ${poolState.ethPrice.toFixed(2)}
- current_ltv: ${poolState.ltv.toFixed(4)} (${(poolState.ltv * 100).toFixed(1)}%)
- current_liq_threshold: ${poolState.liqThreshold.toFixed(4)} (${(poolState.liqThreshold * 100).toFixed(1)}%)
- total_deposits_eth: ${poolState.totalDeposits.toFixed(2)}
- total_borrows_usd: ${poolState.totalBorrows.toFixed(2)}
- utilization_rate: ${poolState.utilizationRate.toFixed(4)} (${(poolState.utilizationRate * 100).toFixed(1)}%)
- avg_health_factor: ${poolState.avgHealthFactor.toFixed(3)}
- min_health_factor: ${poolState.minHealthFactor.toFixed(3)}
- n_liquidations: ${poolState.nLiquidations}
- bad_debt_usd: ${poolState.badDebt.toFixed(2)}
- n_active_users: ${poolState.nActiveUsers}
- guard_updates_used: ${poolState.guardUpdateCount} / 1000

MARKET:
- eth_returns_recent: [${ethReturns.slice(-8).join(", ")}]
- health_factor_history: [${healthFactorHistory.slice(-8).map(h => h.toFixed(3)).join(", ")}]

Decide. Respond with ONE JSON object.`;

  broadcast("log", { type: "info", message: `Agent analyzing pool state... ETH=$${poolState.ethPrice.toFixed(0)}, HF=${poolState.avgHealthFactor.toFixed(3)}` });

  const model = process.env.LLM_MODEL || "qwen/qwen-2.5-7b-instruct:free";
  const response = await llm.chat.completions.create({
    model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.3,
    max_tokens: 256,
  });

  const content = response.choices[0]?.message?.content || "";
  broadcast("log", { type: "llm", message: `LLM response: ${content}` });

  let parsed: any;
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found");
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    broadcast("log", { type: "error", message: `Failed to parse LLM output: ${content}` });
    return {
      timestamp: Date.now(),
      action: "error",
      oldLtv: poolState.ltv,
      newLtv: poolState.ltv,
      oldLiqThreshold: poolState.liqThreshold,
      newLiqThreshold: poolState.liqThreshold,
      isEmergency: false,
      reasoning: `Parse error: ${content.slice(0, 100)}`,
      accepted: false,
    };
  }

  const action = parsed.action || "hold";
  const newLtv = parsed.new_ltv ?? poolState.ltv;
  const newLiqThreshold = parsed.new_liq_threshold ?? poolState.liqThreshold;
  const isEmergency = parsed.is_emergency ?? false;
  const reasoning = parsed.reasoning || "";

  const decision: Decision = {
    timestamp: Date.now(),
    action,
    oldLtv: poolState.ltv,
    newLtv,
    oldLiqThreshold: poolState.liqThreshold,
    newLiqThreshold,
    isEmergency,
    reasoning,
    accepted: false,
  };

  if (action === "hold") {
    decision.accepted = true;
    broadcast("log", { type: "decision", message: `HOLD — ${reasoning}` });
  } else {
    const EPS = 1e-9;
    let violation = "";
    if (newLtv > newLiqThreshold + EPS) violation = "LTV > liq_threshold";
    else if (newLtv < GUARD.ltvMin - EPS || newLtv > GUARD.ltvMax + EPS) violation = "LTV out of bounds";
    else if (newLiqThreshold < GUARD.liqThresholdMin - EPS || newLiqThreshold > GUARD.liqThresholdMax + EPS) violation = "Liq threshold out of bounds";
    else if (Math.abs(newLtv - poolState.ltv) > GUARD.maxLtvDelta + EPS) violation = "LTV delta too large";
    else if (Math.abs(newLiqThreshold - poolState.liqThreshold) > GUARD.maxLiqThresholdDelta + EPS) violation = "Liq threshold delta too large";

    if (violation) {
      broadcast("log", { type: "error", message: `REJECTED (off-chain pre-check): ${violation}` });
    } else {
      // Submit on-chain tx via RiskGovernor.propose_parameters
      try {
        broadcast("log", { type: "info", message: `Submitting tx to RiskGovernor on Starknet Sepolia...` });
        const { txHash } = await proposeParameters(newLtv, newLiqThreshold, isEmergency);
        (decision as any).txHash = txHash;
        (decision as any).voyagerUrl = voyagerUrl(txHash);
        decision.accepted = true;
        poolState.ltv = newLtv;
        poolState.liqThreshold = newLiqThreshold;
        poolState.guardUpdateCount++;
        recalcPoolMetrics();
        broadcast("log", { type: "success", message: `ON-CHAIN: LTV ${(decision.oldLtv * 100).toFixed(1)}% → ${(newLtv * 100).toFixed(1)}%, Liq ${(decision.oldLiqThreshold * 100).toFixed(1)}% → ${(newLiqThreshold * 100).toFixed(1)}%` });
        broadcast("log", { type: "tx", message: `TX: ${voyagerUrl(txHash)}` });
      } catch (e: any) {
        console.error("On-chain tx error:", e);
        broadcast("log", { type: "error", message: `On-chain tx failed: ${e.message?.slice(0, 200) || String(e).slice(0, 200)}` });
      }
    }
  }

  decisions.push(decision);
  broadcast("decision", decision);
  broadcast("state", poolState);
  return decision;
}

// ============================================================================
// API Routes
// ============================================================================

app.get("/api/contracts", (_req, res) => {
  res.json({
    network: "Starknet Sepolia",
    pool: POOL_ADDRESS,
    governor: GOVERNOR_ADDRESS,
    poolUrl: voyagerContractUrl(POOL_ADDRESS),
    governorUrl: voyagerContractUrl(GOVERNOR_ADDRESS),
  });
});

app.get("/api/state", (_req, res) => {
  res.json(poolState);
});

app.get("/api/history", (_req, res) => {
  res.json(decisions);
});

app.post("/api/agent/trigger", async (_req, res) => {
  try {
    const decision = await runAgentCycle();
    res.json(decision);
  } catch (err: any) {
    broadcast("log", { type: "error", message: `Agent error: ${err.message}` });
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/cheat/crash", (req, res) => {
  const pct = req.body?.pct || 10;
  poolState.ethPrice *= (1 - pct / 100);
  recalcPoolMetrics();
  broadcast("log", { type: "market", message: `ETH crashed -${pct}% → $${poolState.ethPrice.toFixed(0)}` });
  broadcast("state", poolState);
  res.json({ ethPrice: poolState.ethPrice });
});

app.post("/api/cheat/pump", (req, res) => {
  const pct = req.body?.pct || 10;
  poolState.ethPrice *= (1 + pct / 100);
  recalcPoolMetrics();
  broadcast("log", { type: "market", message: `ETH pumped +${pct}% → $${poolState.ethPrice.toFixed(0)}` });
  broadcast("state", poolState);
  res.json({ ethPrice: poolState.ethPrice });
});

app.post("/api/cheat/reset", (_req, res) => {
  poolState = {
    ethPrice: 2000,
    ltv: 0.75,
    liqThreshold: 0.80,
    totalDeposits: 500,
    totalBorrows: 600000,
    utilizationRate: 0.60,
    avgHealthFactor: 1.78,
    minHealthFactor: 1.25,
    nLiquidations: 0,
    badDebt: 0,
    nActiveUsers: 20,
    guardUpdateCount: 0,
  };
  ethPriceHistory = [2000];
  healthFactorHistory = [1.78];
  decisions = [];
  recalcPoolMetrics();
  broadcast("log", { type: "info", message: "Pool reset to initial state" });
  broadcast("state", poolState);
  res.json(poolState);
});

app.post("/api/demo/crash", async (_req, res) => {
  broadcast("log", { type: "info", message: "Starting crash demo sequence..." });

  // Step 1: Initial market shock
  await delay(800);
  poolState.ethPrice *= 0.90;
  recalcPoolMetrics();
  broadcast("log", { type: "market", message: `Step 1/3: ETH crash -10% → $${poolState.ethPrice.toFixed(0)}` });
  broadcast("state", poolState);

  // Step 2: Severe crash
  await delay(1200);
  poolState.ethPrice *= 0.85;
  recalcPoolMetrics();
  broadcast("log", { type: "market", message: `Step 2/3: ETH crash -15% more → $${poolState.ethPrice.toFixed(0)}` });
  broadcast("state", poolState);

  // Step 3: Agent reacts to the full crash (single LLM call)
  await delay(800);
  broadcast("log", { type: "info", message: "Step 3/3: Agent analyzing crash and proposing risk adjustment..." });
  const finalDecision = await runAgentCycle();

  broadcast("log", { type: "info", message: "Demo sequence complete." });
  res.json({ status: "complete", finalDecision });
});

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ============================================================================
// Start
// ============================================================================

app.listen(PORT, () => {
  console.log(`VMOL Protocol server running on http://localhost:${PORT}`);
});
