// =============================================================================
// PortfolioRebalancerApp — JS Scoring Module
//
// Engine convention: score(plan, state, context)
//   plan    = execution plan dict (metadata, interactions, calls)
//   state   = flattened IntentState (_intent_function, order params merged)
//   context = { simulation: {...}, state: {...}, oracle: {...}, timestamp, ... }
//
// Scores portfolio rebalance quality. Evaluates:
//   1. Simulation success
//   2. Allocation deviation from target weights (primary metric, 80%)
//   3. Gas efficiency (secondary metric, 20%)
//
// Prices are passed via order params → state.prices (USD per token).
// The JS sandbox blocks network access, so the MCP agent fetches prices
// externally and includes them in the order.
// =============================================================================

var config = {
  name: "PortfolioRebalancer",
  version: "1.0.0",
  type: "portfolio_rebalancer",
};

var manifest = {
  intent_functions: [
    {
      name: "rebalance",
      description:
        "Rebalance a portfolio to target token weights. User specifies tokens, target allocation percentages (in BPS), minimum acceptable amounts, and current market prices. Solver finds optimal swap routes to achieve the target allocation.",
      params: {
        tokens: {
          type: "address[]",
          description: "Array of token addresses in the portfolio",
          source: "user",
        },
        target_weights_bps: {
          type: "uint256[]",
          description:
            "Target allocation weights in BPS (must sum to 10000). E.g. [6000, 4000] for 60/40 split.",
          source: "user",
        },
        min_amounts_out: {
          type: "uint256[]",
          description:
            "Minimum acceptable balance for each token after rebalance (slippage protection)",
          source: "quote",
          quote_field: "suggested_min_amounts",
        },
        prices: {
          type: "object",
          description:
            "Market prices in USD keyed by token address. E.g. {'0xC02...': 2500.0, '0xA0b...': 1.0}. Passed by the MCP agent since the JS sandbox has no network access.",
          source: "user",
        },
        owner: {
          type: "address",
          description: "Address that owns the tokens being rebalanced",
          source: "system",
        },
      },
      example_params: {
        tokens: [
          "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
          "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        ],
        target_weights_bps: ["6000", "4000"],
        min_amounts_out: ["0", "0"],
        prices: {
          "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2": 2500.0,
          "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48": 1.0,
        },
        owner: "0x0000000000000000000000000000000000000001",
      },
      scoring_hints: {
        goal: "Minimize allocation deviation from target weights",
        primary_metric:
          "allocation_score: 1.0 - (sum of absolute weight deviations / 2)",
        secondary_metrics: ["gas_efficiency"],
      },
    },
  ],
};

// Token decimals lookup (hardcoded for known tokens)
var TOKEN_DECIMALS = {
  "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2": 18, // WETH
  "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": 6, // USDC
  "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599": 8, // WBTC
  "0x6b175474e89094c44da98b954eedeac495271d0f": 18, // DAI
  "0xdac17f958d2ee523a2206206994597c13d831ec7": 6, // USDT
};

function getDecimals(tokenAddr) {
  var lower = (tokenAddr || "").toLowerCase();
  return TOKEN_DECIMALS[lower] || 18;
}

function toHumanAmount(rawAmount, decimals) {
  // Convert raw token amount to human-readable using decimals
  var amount = parseFloat(rawAmount || "0");
  if (amount === 0 || decimals === 0) return amount;
  return amount / Math.pow(10, decimals);
}

function score(plan, state, context) {
  var sim = context.simulation || {};

  // 1. Check simulation success
  if (!sim.success) {
    return {
      score: 0,
      valid: false,
      reason: "Simulation failed: " + (sim.error || "unknown"),
    };
  }

  // 2. Extract order params from state
  var tokens = state.tokens || [];
  var targetWeightsBps = state.target_weights_bps || state.targetWeightsBps || [];
  var prices = state.prices || {};
  var owner = (state.owner || state.submitted_by || "").toLowerCase();
  var appAddr = (state.contract_address || "").toLowerCase();

  if (tokens.length === 0) {
    return { score: 0, valid: false, reason: "No tokens specified" };
  }
  if (tokens.length !== targetWeightsBps.length) {
    return { score: 0, valid: false, reason: "Tokens/weights length mismatch" };
  }

  // 3. Analyze token transfers from simulation
  var transfers = sim.token_transfers || sim.tokenTransfers || [];
  var gasUsed = sim.gas_used || sim.gasUsed || 0;

  // Build net balance changes per token from transfers
  var netFlows = {};
  for (var i = 0; i < tokens.length; i++) {
    netFlows[tokens[i].toLowerCase()] = 0;
  }

  for (var i = 0; i < transfers.length; i++) {
    var t = transfers[i];
    var tokenAddr = (t.token || t.token_address || "").toLowerCase();
    var fromAddr = (t.from_addr || t.from || "").toLowerCase();
    var toAddr = (t.to_addr || t.to || "").toLowerCase();
    var amount = parseFloat(t.amount || t.value || "0");

    if (netFlows[tokenAddr] !== undefined) {
      // Inflow to owner or app
      if (toAddr === owner || toAddr === appAddr) {
        netFlows[tokenAddr] += amount;
      }
      // Outflow from owner or app
      if (fromAddr === owner || fromAddr === appAddr) {
        netFlows[tokenAddr] -= amount;
      }
    }
  }

  // 4. Compute portfolio value and actual weights
  var totalPortfolioUsd = 0;
  var tokenUsdValues = [];

  for (var i = 0; i < tokens.length; i++) {
    var addr = tokens[i].toLowerCase();
    var decimals = getDecimals(addr);

    // Get price for this token (try both original case and lowercase)
    var price = prices[tokens[i]] || prices[addr] || 0;
    if (price === 0) {
      // Try matching by any key that contains this address
      var keys = Object.keys(prices);
      for (var k = 0; k < keys.length; k++) {
        if (keys[k].toLowerCase() === addr) {
          price = prices[keys[k]];
          break;
        }
      }
    }

    // Net flow in human-readable terms
    var netFlow = netFlows[addr] || 0;
    var humanFlow = toHumanAmount(netFlow, decimals);
    var usdValue = Math.abs(humanFlow) * price;

    // For portfolio valuation, we use absolute net flow as proxy
    // (In production, we'd read actual balances from state)
    tokenUsdValues.push({ token: addr, usdValue: usdValue, price: price });
    totalPortfolioUsd += usdValue;
  }

  // If no price data or no portfolio value, use a simpler scoring approach
  if (totalPortfolioUsd === 0) {
    // Fallback: score based on transfer count and gas
    var hasTransfers = transfers.length > 0;
    var gasScore = gasUsed > 0 ? Math.max(0, 1 - gasUsed / 1000000) : 0.5;
    var fallbackScore = hasTransfers ? 0.5 + gasScore * 0.2 : 0.3;

    return {
      score: fallbackScore,
      valid: true,
      reason: "Rebalance executed (no price data for detailed scoring)",
      breakdown: {
        allocation_score: 0.5,
        gas_score: gasScore,
        num_transfers: transfers.length,
      },
      metadata: {
        total_portfolio_usd: 0,
        prices_available: false,
      },
    };
  }

  // 5. Calculate actual weights vs target weights
  var totalDeviation = 0;
  var actualWeights = [];
  var targetWeights = [];

  for (var i = 0; i < tokens.length; i++) {
    var targetBps = parseInt(targetWeightsBps[i] || "0");
    var targetWeight = targetBps / 10000;
    var actualWeight =
      totalPortfolioUsd > 0 ? tokenUsdValues[i].usdValue / totalPortfolioUsd : 0;

    actualWeights.push(actualWeight);
    targetWeights.push(targetWeight);

    totalDeviation += Math.abs(actualWeight - targetWeight);
  }

  // 6. Score: allocation quality (80%) + gas efficiency (20%)
  // Deviation of 0 = perfect (1.0), deviation of 2.0 = worst (0.0)
  var allocationScore = Math.max(0, 1.0 - totalDeviation / 2.0);

  var gasScore = gasUsed > 0 ? Math.max(0, 1 - gasUsed / 1000000) : 0.5;

  var finalScore = allocationScore * 0.8 + gasScore * 0.2;
  finalScore = Math.max(0, Math.min(1.0, finalScore));

  // Build weight comparison for metadata
  var weightComparison = [];
  for (var i = 0; i < tokens.length; i++) {
    weightComparison.push({
      token: tokens[i],
      target_bps: parseInt(targetWeightsBps[i] || "0"),
      actual_pct: (actualWeights[i] * 100).toFixed(2) + "%",
      target_pct: (targetWeights[i] * 100).toFixed(2) + "%",
      deviation_pct: (Math.abs(actualWeights[i] - targetWeights[i]) * 100).toFixed(2) + "%",
    });
  }

  return {
    score: finalScore,
    valid: true,
    reason:
      "Rebalance scored: allocation_dev=" +
      (totalDeviation * 100).toFixed(2) +
      "% gas=" +
      gasUsed,
    breakdown: {
      allocation_score: allocationScore,
      total_deviation: totalDeviation,
      gas_score: gasScore,
      gas_used: gasUsed,
      num_transfers: transfers.length,
    },
    metadata: {
      total_portfolio_usd: totalPortfolioUsd,
      weight_comparison: weightComparison,
      prices_available: true,
    },
  };
}

function validate(plan, state, context) {
  // Structural validation before scoring
  if (!plan || !plan.calls || plan.calls.length === 0) {
    return { score: 0, valid: false, reason: "Empty execution plan" };
  }

  var tokens = state.tokens || [];
  var weights = state.target_weights_bps || state.targetWeightsBps || [];

  if (tokens.length === 0) {
    return { score: 0, valid: false, reason: "No tokens specified" };
  }
  if (tokens.length !== weights.length) {
    return { score: 0, valid: false, reason: "Tokens/weights length mismatch" };
  }

  // Validate weights sum to 10000
  var weightSum = 0;
  for (var i = 0; i < weights.length; i++) {
    weightSum += parseInt(weights[i] || "0");
  }
  if (weightSum !== 10000) {
    return {
      score: 0,
      valid: false,
      reason: "Weights must sum to 10000, got " + weightSum,
    };
  }

  return { score: 0, valid: true, reason: "Validation passed" };
}

module.exports = {
  config: config,
  manifest: manifest,
  score: score,
  validate: validate,
  get_manifest: function () {
    return manifest;
  },
};
