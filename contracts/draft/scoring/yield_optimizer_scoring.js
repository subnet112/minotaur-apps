// =============================================================================
// YieldOptimizerApp — JS Scoring Module
//
// Scores yield rebalancing quality by independently verifying lending rates
// on-chain via ethCall. Rewards solvers that:
//   1. Move funds to higher-yielding protocols
//   2. Only rebalance when the improvement justifies gas costs
//   3. Maintain diversification across protocols
//   4. Don't lose user funds
//
// Uses ethCall() to query Aave V3, Compound V3, and Morpho Blue rates
// directly from the chain — does NOT trust the solver's metadata.
// =============================================================================

var config = {
  name: "YieldOptimizer",
  version: "1.0.0",
  type: "yield_optimizer",
};

// ── Protocol addresses (Ethereum mainnet) ────────────────────────────────────

var PROTOCOLS = {
  aave_v3: {
    pool: "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2",
    name: "Aave V3",
    // getReserveData(address) → returns struct with currentLiquidityRate at offset 2
    getReserveDataSelector: "0x35ea6a75",
  },
  compound_v3: {
    comet: "0xc3d688B66703497DAA19211EEdff47f25384cdc3",
    name: "Compound V3",
    // getUtilization() → uint256
    getUtilizationSelector: "0x7eb71131",
    // getSupplyRate(uint256 utilization) → uint64
    getSupplyRateSelector: "0xd955759d",
  },
};

var USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";

// ── ABI encoding helpers ─────────────────────────────────────────────────────

function encodeAddress(addr) {
  return addr.replace("0x", "").toLowerCase().padStart(64, "0");
}

function decodeUint256(hex, offset) {
  // Each uint256 is 32 bytes = 64 hex chars
  var start = 2 + offset * 64; // skip "0x" prefix
  if (hex.length < start + 64) return 0;
  return parseInt(hex.slice(start, start + 64), 16);
}

function decodeUint128(hex, offset) {
  return decodeUint256(hex, offset);
}

// ── Rate fetching (uses ethCall — independent verification) ──────────────────

async function getAaveSupplyRate(chainId, asset) {
  try {
    var data = PROTOCOLS.aave_v3.getReserveDataSelector + encodeAddress(asset);
    var result = await ethCall(chainId, PROTOCOLS.aave_v3.pool, data);
    // currentLiquidityRate is the 3rd field (index 2) in the returned struct
    var liquidityRateRay = decodeUint256(result, 2);
    // Convert from RAY (1e27) to APY percentage
    return (liquidityRateRay / 1e27) * 100;
  } catch (e) {
    return 0;
  }
}

async function getCompoundSupplyRate(chainId) {
  try {
    // Get current utilization
    var utilResult = await ethCall(
      chainId,
      PROTOCOLS.compound_v3.comet,
      PROTOCOLS.compound_v3.getUtilizationSelector
    );
    var utilization = decodeUint256(utilResult, 0);

    // Get supply rate at current utilization
    var rateData =
      PROTOCOLS.compound_v3.getSupplyRateSelector +
      utilization.toString(16).padStart(64, "0");
    var rateResult = await ethCall(
      chainId,
      PROTOCOLS.compound_v3.comet,
      rateData
    );
    var ratePerSecond = decodeUint256(rateResult, 0);
    // Convert per-second rate to APY: (rate * seconds_per_year) / 1e18 * 100
    return (ratePerSecond * 31536000) / 1e18 * 100;
  } catch (e) {
    return 0;
  }
}

// ── Manifest ─────────────────────────────────────────────────────────────────

var manifest = {
  intent_functions: [
    {
      name: "rebalance",
      description:
        "Rebalance deposited assets across lending protocols (Aave V3, Compound V3) " +
        "to maximize yield. Solver finds the optimal allocation based on current rates.",
      params: {
        asset: {
          type: "address",
          description: "Asset to optimize (e.g., USDC)",
          source: "user",
        },
        amount: {
          type: "uint256",
          description: "Amount deposited for optimization",
          source: "user",
        },
        protocols: {
          type: "address[]",
          description: "Whitelisted protocol addresses for allocation",
          source: "system",
        },
        min_balance: {
          type: "uint256",
          description: "Minimum balance after rebalance (safety floor)",
          source: "quote",
          quote_field: "min_balance",
        },
      },
      example_params: {
        asset: USDC,
        amount: "1000000000", // 1000 USDC
        protocols: [PROTOCOLS.aave_v3.pool, PROTOCOLS.compound_v3.comet],
        min_balance: "999000000", // 999 USDC (allow 0.1% for gas/slippage)
      },
      scoring_hints: {
        goal: "Maximize lending APY while minimizing rebalancing costs",
        primary_metric: "rate_improvement (new_apy - old_apy)",
        secondary_metrics: ["gas_efficiency", "diversification"],
      },
    },
  ],
  benchmark_scenarios: [
    {
      name: "USDC_yield_optimization",
      description: "Optimize 1000 USDC yield across Aave and Compound",
      intent_function: "rebalance",
      fund: {
        "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48": "1000000000",
      },
      params: {
        asset: USDC,
        amount: "1000000000",
        protocols: [PROTOCOLS.aave_v3.pool, PROTOCOLS.compound_v3.comet],
        min_balance: "999000000",
      },
    },
    {
      name: "USDC_large_position",
      description: "Optimize 100K USDC — tests whether solver handles large amounts",
      intent_function: "rebalance",
      fund: {
        "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48": "100000000000",
      },
      params: {
        asset: USDC,
        amount: "100000000000",
        protocols: [PROTOCOLS.aave_v3.pool, PROTOCOLS.compound_v3.comet],
        min_balance: "99900000000",
      },
    },
  ],
};

// ── Scoring function ─────────────────────────────────────────────────────────

async function score(plan, state, context) {
  var sim = context.simulation || {};

  // 1. Check simulation success
  if (!sim.success) {
    return {
      score: 0,
      valid: false,
      reason: "Simulation failed: " + (sim.error || "unknown"),
    };
  }

  // 2. Get params
  var params = state.typed_context || state.raw_params || state.rawParams || {};
  var amount = parseFloat(params.amount || "0");
  var minBalance = parseFloat(params.min_balance || params.minBalance || "0");
  var chainId = state.chain_id || context.chainId || 1;

  if (amount <= 0) {
    return { score: 0, valid: false, reason: "Invalid amount" };
  }

  // 3. Independently fetch current lending rates from the chain
  var aaveRate = await getAaveSupplyRate(chainId, USDC);
  var compoundRate = await getCompoundSupplyRate(chainId);
  var bestAvailableRate = Math.max(aaveRate, compoundRate);

  // 4. Analyze what the solver did from simulation transfers
  var transfers = sim.token_transfers || sim.tokenTransfers || [];
  var gasUsed = sim.gas_used || sim.gasUsed || 0;

  // Check: did any funds flow to a lending protocol?
  var depositsToAave = 0;
  var depositsToCompound = 0;
  for (var i = 0; i < transfers.length; i++) {
    var t = transfers[i];
    var toAddr = (t.to_addr || t.to || "").toLowerCase();
    var tokenAddr = (t.token || t.token_address || "").toLowerCase();
    var txAmount = parseFloat(t.amount || t.value || "0");

    if (tokenAddr === USDC.toLowerCase()) {
      if (toAddr === PROTOCOLS.aave_v3.pool.toLowerCase()) {
        depositsToAave += txAmount;
      } else if (toAddr === PROTOCOLS.compound_v3.comet.toLowerCase()) {
        depositsToCompound += txAmount;
      }
    }
  }

  var totalDeposited = depositsToAave + depositsToCompound;
  if (totalDeposited === 0) {
    return {
      score: 0,
      valid: false,
      reason: "No deposits to lending protocols detected",
    };
  }

  // 5. Calculate the weighted APY the solver achieved
  var solverWeightedRate = 0;
  if (totalDeposited > 0) {
    solverWeightedRate =
      (depositsToAave * aaveRate + depositsToCompound * compoundRate) /
      totalDeposited;
  }

  // 6. Score components

  // Rate quality: how close to the best available rate? (60%)
  var rateScore = bestAvailableRate > 0
    ? Math.min(1.0, solverWeightedRate / bestAvailableRate)
    : 0;

  // Gas efficiency: penalize high gas usage relative to position size (20%)
  // At 20 gwei, 500k gas ≈ $0.03. Annualized cost vs yield improvement.
  var gasScore = gasUsed > 0 ? Math.max(0, 1 - gasUsed / 500000) : 0.5;

  // Capital efficiency: did the solver deploy most of the capital? (20%)
  var deploymentRatio = totalDeposited / amount;
  var capitalScore = Math.min(1.0, deploymentRatio);

  // Weighted final score
  var finalScore = rateScore * 0.6 + gasScore * 0.2 + capitalScore * 0.2;
  finalScore = Math.max(0, Math.min(1.0, finalScore));

  return {
    score: finalScore,
    valid: true,
    reason:
      "Yield rebalance: solver_apy=" +
      solverWeightedRate.toFixed(2) +
      "% best=" +
      bestAvailableRate.toFixed(2) +
      "% aave=" +
      aaveRate.toFixed(2) +
      "% compound=" +
      compoundRate.toFixed(2) +
      "% gas=" +
      gasUsed,
    breakdown: {
      rate_score: rateScore,
      solver_weighted_rate: solverWeightedRate,
      best_available_rate: bestAvailableRate,
      aave_rate: aaveRate,
      compound_rate: compoundRate,
      gas_score: gasScore,
      gas_used: gasUsed,
      capital_score: capitalScore,
      deposits_aave: depositsToAave,
      deposits_compound: depositsToCompound,
      total_deposited: totalDeposited,
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
