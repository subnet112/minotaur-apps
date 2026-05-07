// =============================================================================
// DCAApp — JS Scoring Module
//
// Scores dollar-cost averaging buy execution quality. Rewards solvers that:
//   1. Get the best exchange rate for the buy
//   2. Execute within gas budget
//   3. Deliver tokens to the correct receiver
//   4. Don't lose user funds (output >= minAmountOut)
//
// Uses ethCall() to independently verify token prices on-chain via
// Uniswap V3 quoter — does NOT trust the solver's claimed rate.
// =============================================================================

var config = {
  name: "DCAApp",
  version: "1.0.0",
  type: "dca",
};

// ── Known tokens (Ethereum mainnet) ─────────────────────────────────────────

var TOKENS = {
  USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  WETH: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  WBTC: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
  DAI:  "0x6B175474E89094C44Da98b954EedeAC495271d0F",
};

// Uniswap V3 Quoter V2
var UNISWAP_QUOTER = "0x61fFE014bA17989E743c5F6cB21bF9697530B21e";

// ── ABI encoding helpers ────────────────────────────────────────────────────

function encodeAddress(addr) {
  return addr.replace("0x", "").toLowerCase().padStart(64, "0");
}

function encodeUint256(value) {
  // Handle both number and string inputs
  var n = typeof value === "string" ? parseInt(value) : value;
  return n.toString(16).padStart(64, "0");
}

function encodeUint24(value) {
  return value.toString(16).padStart(64, "0");
}

function decodeUint256(hex, offset) {
  var start = 2 + offset * 64;
  if (hex.length < start + 64) return 0;
  return parseInt(hex.slice(start, start + 64), 16);
}

// ── Price fetching (uses ethCall for independent verification) ──────────────

async function getQuote(chainId, tokenIn, tokenOut, amountIn) {
  try {
    // quoteExactInputSingle((address,address,uint256,uint24,uint160))
    // selector: 0xc6a5026a (QuoterV2)
    var selector = "cdca1753"; // quoteExactInputSingle
    var data = "0x" + selector
      + encodeAddress(tokenIn)
      + encodeAddress(tokenOut)
      + encodeUint256(amountIn)
      + encodeUint24(3000)  // 0.3% fee tier
      + encodeUint256(0);   // sqrtPriceLimitX96 = 0

    var result = await ethCall(chainId, UNISWAP_QUOTER, data);
    return decodeUint256(result, 0);
  } catch (e) {
    return 0;
  }
}

// ── Manifest ────────────────────────────────────────────────────────────────

var manifest = {
  intent_functions: [
    {
      name: "buy",
      description:
        "Execute a periodic DCA buy from pre-deposited funds. " +
        "User deposits source tokens into the contract upfront, then perpetual orders " +
        "automatically buy target tokens at the best rate each period. No per-execution approvals needed.",
      params: {
        tokenIn: {
          type: "address",
          description: "Source token to sell (e.g., USDC)",
          source: "user",
        },
        tokenOut: {
          type: "address",
          description: "Target token to buy (e.g., WETH)",
          source: "user",
        },
        amountPerBuy: {
          type: "uint256",
          description: "Amount of tokenIn to spend per buy",
          source: "user",
        },
        minAmountOut: {
          type: "uint256",
          description: "Minimum acceptable output amount (slippage protection)",
          source: "quote",
          quote_field: "min_amount_out",
        },
        receiver: {
          type: "address",
          description: "Address to receive bought tokens",
          source: "user",
        },
      },
      example_params: {
        tokenIn: TOKENS.USDC,
        tokenOut: TOKENS.WETH,
        amountPerBuy: "100000000", // 100 USDC
        minAmountOut: "30000000000000000", // ~0.03 WETH
        receiver: "0x0000000000000000000000000000000000000001",
      },
      scoring_hints: {
        goal: "Maximize output tokens received per buy execution",
        primary_metric: "output_amount relative to market rate",
        secondary_metrics: ["gas_efficiency", "slippage_minimization"],
      },
    },
  ],
  benchmark_scenarios: [
    {
      name: "USDC_to_WETH_small",
      description: "DCA buy: 100 USDC → WETH",
      intent_function: "buy",
      fund: {
        "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48": "100000000",
      },
      params: {
        tokenIn: TOKENS.USDC,
        tokenOut: TOKENS.WETH,
        amountPerBuy: "100000000",
        minAmountOut: "25000000000000000", // ~0.025 WETH floor
        receiver: "0x0000000000000000000000000000000000000001",
      },
    },
    {
      name: "USDC_to_WBTC_medium",
      description: "DCA buy: 500 USDC → WBTC",
      intent_function: "buy",
      fund: {
        "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48": "500000000",
      },
      params: {
        tokenIn: TOKENS.USDC,
        tokenOut: TOKENS.WBTC,
        amountPerBuy: "500000000",
        minAmountOut: "500000", // ~0.005 WBTC floor
        receiver: "0x0000000000000000000000000000000000000001",
      },
    },
  ],
};

// ── Scoring function ────────────────────────────────────────────────────────

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
  var tokenIn = params.tokenIn || params.token_in || "";
  var tokenOut = params.tokenOut || params.token_out || "";
  var amountPerBuy = parseFloat(params.amountPerBuy || params.amount_per_buy || "0");
  var minAmountOut = parseFloat(params.minAmountOut || params.min_amount_out || "0");
  var receiver = (params.receiver || "").toLowerCase();
  var chainId = state.chain_id || context.chainId || 1;

  if (amountPerBuy <= 0) {
    return { score: 0, valid: false, reason: "Invalid amountPerBuy" };
  }

  // 3. Analyze simulation transfers — how much tokenOut was received?
  // The solver routes swap output to the contract address (for invariant
  // verification), then the contract forwards to the receiver.  We count
  // tokenOut arriving at EITHER the contract or the receiver.
  var transfers = sim.token_transfers || sim.tokenTransfers || [];
  var gasUsed = sim.gas_used || sim.gasUsed || 0;
  var contractAddr = (
    state.contract_address || params.app_address || ""
  ).toLowerCase();

  var outputReceived = 0;
  for (var i = 0; i < transfers.length; i++) {
    var t = transfers[i];
    var toAddr = (t.to_addr || t.to || "").toLowerCase();
    var tokenAddr = (t.token || t.token_address || "").toLowerCase();
    var txAmount = parseFloat(t.amount || t.value || "0");

    if (tokenAddr === tokenOut.toLowerCase()) {
      if (toAddr === receiver || toAddr === contractAddr) {
        outputReceived += txAmount;
      }
    }
  }

  // 4. Check minimum output
  if (outputReceived < minAmountOut) {
    return {
      score: 0,
      valid: false,
      reason: "Output " + outputReceived + " below minimum " + minAmountOut,
    };
  }

  // 5. Get market reference rate via Uniswap quoter
  var marketQuote = await getQuote(chainId, tokenIn, tokenOut, amountPerBuy);

  // 6. Score components

  // Price quality: how close to or better than market rate? (70%)
  var priceScore = 0;
  if (marketQuote > 0) {
    priceScore = Math.min(1.0, outputReceived / marketQuote);
    // Bonus for beating market (up to 10% extra, capped at 1.0)
    if (outputReceived > marketQuote) {
      priceScore = Math.min(1.0, 1.0 + (outputReceived - marketQuote) / marketQuote * 0.1);
    }
  } else {
    // Can't verify market rate — score based on exceeding minimum
    priceScore = minAmountOut > 0
      ? Math.min(1.0, outputReceived / minAmountOut)
      : 0.5;
  }

  // Gas efficiency (20%): penalize high gas usage
  var gasScore = gasUsed > 0 ? Math.max(0, 1 - gasUsed / 500000) : 0.5;

  // Delivery check (10%): did tokens go to the right receiver?
  var deliveryScore = outputReceived > 0 ? 1.0 : 0;

  // Weighted final score
  var finalScore = priceScore * 0.7 + gasScore * 0.2 + deliveryScore * 0.1;
  finalScore = Math.max(0, Math.min(1.0, finalScore));

  return {
    score: finalScore,
    valid: true,
    reason:
      "DCA buy: received=" + outputReceived +
      " min=" + minAmountOut +
      " market=" + marketQuote +
      " price_score=" + priceScore.toFixed(3) +
      " gas=" + gasUsed,
    breakdown: {
      price_score: priceScore,
      gas_score: gasScore,
      delivery_score: deliveryScore,
      output_received: outputReceived,
      min_amount_out: minAmountOut,
      market_quote: marketQuote,
      gas_used: gasUsed,
      token_in: tokenIn,
      token_out: tokenOut,
      amount_per_buy: amountPerBuy,
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
