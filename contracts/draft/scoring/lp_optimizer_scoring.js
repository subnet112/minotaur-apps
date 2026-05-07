// =============================================================================
// LPOptimizerApp — JS Scoring Module
//
// Scores V3 LP position management quality. Two intents:
//
//   rebalance: Move position to a new tick range.
//     - Is the position currently out of range (earning zero fees)?
//     - Does the new range capture the current price?
//     - How tight is the range (tighter = more capital efficient, but more IL risk)?
//     - How much value was retained through the rebalance swap?
//
//   compound: Collect fees and reinvest as liquidity.
//     - Were fees actually available to collect?
//     - How efficiently were they reinvested (minimal swap waste)?
//     - Was gas cost justified by fee value?
//
// The solver's job: determine WHEN to rebalance (price drifted out of range)
// and WHERE (optimal tick bounds given current volatility and price).
// =============================================================================

var config = {
  name: "LPOptimizerApp",
  version: "1.0.0",
  type: "lp_optimizer",
};

// ── ABI helpers ─────────────────────────────────────────────────────────────

function encodeAddress(addr) {
  return addr.replace("0x", "").toLowerCase().padStart(64, "0");
}

function encodeUint256(value) {
  var n = typeof value === "string" ? parseInt(value) : value;
  return n.toString(16).padStart(64, "0");
}

function decodeUint256(hex, offset) {
  var start = 2 + offset * 64;
  if (hex.length < start + 64) return 0;
  return parseInt(hex.slice(start, start + 64), 16);
}

function decodeInt24(hex, offset) {
  var val = decodeUint256(hex, offset);
  if (val >= 0x800000) val -= 0x1000000;
  return val;
}

// ── On-chain reads ──────────────────────────────────────────────────────────

async function getPoolSlot0(chainId, poolAddress) {
  try {
    // slot0() selector = 0x3850c7bd
    var result = await ethCall(chainId, poolAddress, "0x3850c7bd");
    return {
      sqrtPriceX96: decodeUint256(result, 0),
      tick: decodeInt24(result, 1),
    };
  } catch (e) {
    return null;
  }
}

async function getPoolTickSpacing(chainId, poolAddress) {
  try {
    // tickSpacing() selector = 0xd0c93a7c
    var result = await ethCall(chainId, poolAddress, "0xd0c93a7c");
    return decodeInt24(result, 0);
  } catch (e) {
    return 60; // default for 0.3% fee
  }
}

// ── Tick math helpers ───────────────────────────────────────────────────────

function tickToPrice(tick) {
  return Math.pow(1.0001, tick);
}

function isInRange(currentTick, tickLower, tickUpper) {
  return currentTick >= tickLower && currentTick < tickUpper;
}

function rangeWidth(tickLower, tickUpper) {
  return tickUpper - tickLower;
}

// ── Manifest ────────────────────────────────────────────────────────────────

var manifest = {
  intent_functions: [
    {
      name: "rebalance",
      description:
        "Rebalance a V3 LP position to a new tick range. " +
        "Removes liquidity, swaps to optimal ratio via solver's plan, " +
        "and mints new position in the proposed range. " +
        "Perpetual intent — fires when position is out of range.",
      params: {
        pool: {
          type: "address",
          description: "Uniswap V3 pool address",
          source: "user",
        },
        newTickLower: {
          type: "int24",
          description: "Lower tick bound for new position",
          source: "solver",
        },
        newTickUpper: {
          type: "int24",
          description: "Upper tick bound for new position",
          source: "solver",
        },
      },
      scoring_hints: {
        goal: "Maximize fee-earning potential while minimizing rebalance cost",
        primary_metric: "range optimality (captures current price, tight but not too tight)",
        secondary_metrics: [
          "value_retention (minimize swap slippage)",
          "gas_efficiency",
          "range_longevity (don't rebalance too frequently)",
        ],
      },
    },
    {
      name: "compound",
      description:
        "Collect earned trading fees and reinvest as additional liquidity. " +
        "Solver swaps fees to the optimal token ratio for the current position range. " +
        "Perpetual intent — fires when accumulated fees justify gas cost.",
      params: {
        pool: {
          type: "address",
          description: "Uniswap V3 pool address",
          source: "user",
        },
      },
      scoring_hints: {
        goal: "Maximize reinvested liquidity from collected fees",
        primary_metric: "liquidity_added relative to fee value",
        secondary_metrics: ["gas_efficiency", "swap_waste_minimization"],
      },
    },
  ],
};

// ── Scoring ─────────────────────────────────────────────────────────────────

async function score(plan, state, context) {
  var sim = context.simulation || {};

  if (!sim.success) {
    return { score: 0, valid: false, reason: "Simulation failed" };
  }

  var params = state.typed_context || state.raw_params || {};
  var intentSelector = state.intent_selector || params.intent_selector || "";

  // Dispatch to intent-specific scoring
  if (intentSelector.indexOf("rebalance") >= 0 || params.newTickLower !== undefined) {
    return scoreRebalance(plan, state, context);
  }
  if (intentSelector.indexOf("compound") >= 0) {
    return scoreCompound(plan, state, context);
  }

  // Fallback: try to detect from params
  if (params.new_tick_lower !== undefined || params.newTickLower !== undefined) {
    return scoreRebalance(plan, state, context);
  }
  return scoreCompound(plan, state, context);
}

// ── Rebalance scoring ───────────────────────────────────────────────────────

async function scoreRebalance(plan, state, context) {
  var sim = context.simulation || {};
  var params = state.typed_context || state.raw_params || {};
  var chainId = state.chain_id || context.chainId || 1;
  var gasUsed = sim.gas_used || sim.gasUsed || 0;

  var pool = params.pool || "";
  var newTickLower = parseInt(params.newTickLower || params.new_tick_lower || "0");
  var newTickUpper = parseInt(params.newTickUpper || params.new_tick_upper || "0");

  // Get current pool state
  var slot0 = await getPoolSlot0(chainId, pool);
  var tickSpacing = await getPoolTickSpacing(chainId, pool);
  var currentTick = slot0 ? slot0.tick : 0;

  var breakdown = {};
  var totalScore = 0;

  // ── Component 1: Range captures current price (30%) ───────────────────
  var rangeScore = 0;
  if (isInRange(currentTick, newTickLower, newTickUpper)) {
    rangeScore = 1.0;
  } else {
    // Out of range — how far?
    var distFromRange = currentTick < newTickLower
      ? newTickLower - currentTick
      : currentTick - newTickUpper;
    rangeScore = Math.max(0, 1 - distFromRange / 1000);
  }
  breakdown.range_captures_price = rangeScore;
  totalScore += rangeScore * 0.30;

  // ── Component 2: Range width optimality (25%) ─────────────────────────
  // Too tight = rebalance needed often, too wide = capital inefficient
  // Sweet spot: 200-2000 ticks depending on volatility
  var width = rangeWidth(newTickLower, newTickUpper);
  var widthScore = 0;
  if (width <= 0) {
    widthScore = 0;
  } else if (width < tickSpacing * 4) {
    widthScore = 0.3; // Too tight
  } else if (width > tickSpacing * 200) {
    widthScore = 0.4; // Too wide (like full range)
  } else {
    // Optimal zone: 4-200 tick spacings
    // Peak at ~20 tick spacings
    var idealWidth = tickSpacing * 20;
    var ratio = width / idealWidth;
    widthScore = ratio <= 1
      ? 0.5 + ratio * 0.5
      : Math.max(0.5, 1.0 - (ratio - 1) * 0.05);
  }
  breakdown.range_width_optimality = widthScore;
  totalScore += widthScore * 0.25;

  // ── Component 3: Value retention (30%) ────────────────────────────────
  // How much value was kept through the rebalance (vs lost to slippage)?
  var transfers = sim.token_transfers || sim.tokenTransfers || [];
  var contractAddr = (state.contract_address || "").toLowerCase();
  var onChainScore = sim.on_chain_score || 0;

  // Use on-chain score as proxy for value retention
  // on_chain_score is 0-10000 BPS → normalize to 0-1
  var valueScore = onChainScore > 0 ? onChainScore / 10000 : 0.5;
  breakdown.value_retention = valueScore;
  totalScore += valueScore * 0.30;

  // ── Component 4: Gas efficiency (15%) ─────────────────────────────────
  // Rebalance is gas-heavy (~500k-800k). Penalize above 1M.
  var gasScore = gasUsed > 0 ? Math.max(0, 1 - (gasUsed - 300000) / 1000000) : 0.5;
  gasScore = Math.max(0, Math.min(1, gasScore));
  breakdown.gas_efficiency = gasScore;
  totalScore += gasScore * 0.15;

  totalScore = Math.max(0, Math.min(1, totalScore));

  return {
    score: totalScore,
    valid: totalScore >= 0.3,
    reason:
      "Rebalance: tick=" + currentTick +
      " range=[" + newTickLower + "," + newTickUpper + "]" +
      " width=" + width +
      " in_range=" + isInRange(currentTick, newTickLower, newTickUpper) +
      " score=" + totalScore.toFixed(3),
    breakdown: breakdown,
    metadata: {
      current_tick: currentTick,
      new_tick_lower: newTickLower,
      new_tick_upper: newTickUpper,
      range_width: width,
      tick_spacing: tickSpacing,
      gas_used: gasUsed,
    },
  };
}

// ── Compound scoring ────────────────────────────────────────────────────────

async function scoreCompound(plan, state, context) {
  var sim = context.simulation || {};
  var gasUsed = sim.gas_used || sim.gasUsed || 0;
  var transfers = sim.token_transfers || sim.tokenTransfers || [];
  var contractAddr = (state.contract_address || "").toLowerCase();

  var breakdown = {};
  var totalScore = 0;

  // ── Component 1: Fees were actually collected (40%) ───────────────────
  // Look for token transfers TO the contract (fee collection)
  var totalFeesCollected = 0;
  for (var i = 0; i < transfers.length; i++) {
    var t = transfers[i];
    var toAddr = (t.to_addr || t.to || "").toLowerCase();
    if (toAddr === contractAddr) {
      totalFeesCollected += parseFloat(t.amount || t.value || "0");
    }
  }

  var feesScore = totalFeesCollected > 0 ? 1.0 : 0;
  breakdown.fees_collected = feesScore;
  totalScore += feesScore * 0.40;

  // ── Component 2: On-chain score (liquidity added) (35%) ───────────────
  var onChainScore = sim.on_chain_score || 0;
  var liquidityScore = onChainScore > 0 ? onChainScore / 10000 : 0;
  breakdown.liquidity_reinvested = liquidityScore;
  totalScore += liquidityScore * 0.35;

  // ── Component 3: Gas justification (25%) ──────────────────────────────
  // Compounding should only happen when fees >> gas cost
  // Rough heuristic: compound is worth it if fee value > 5x gas cost
  var gasScore = 0;
  if (gasUsed > 0 && totalFeesCollected > 0) {
    // Assume gas price ~1 gwei, native token ~$500
    // Very rough — the solver should handle the real math
    gasScore = gasUsed < 300000 ? 1.0 : Math.max(0, 1 - (gasUsed - 300000) / 500000);
  }
  breakdown.gas_justification = gasScore;
  totalScore += gasScore * 0.25;

  totalScore = Math.max(0, Math.min(1, totalScore));

  return {
    score: totalScore,
    valid: totalScore >= 0.2,
    reason:
      "Compound: fees_collected=" + totalFeesCollected +
      " gas=" + gasUsed +
      " score=" + totalScore.toFixed(3),
    breakdown: breakdown,
    metadata: {
      fees_collected: totalFeesCollected,
      gas_used: gasUsed,
      on_chain_score: sim.on_chain_score,
    },
  };
}

module.exports = {
  config: config,
  manifest: manifest,
  score: score,
  get_manifest: function () {
    return manifest;
  },
};
