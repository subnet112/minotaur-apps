// =============================================================================
// DexAggregatorApp — JS Scoring Module
//
// Engine convention: score(plan, state, context)
//   plan    = execution plan dict (metadata, interactions, calls)
//   state   = flattened IntentState (_intent_function, order params merged)
//   context = { simulation: {...}, state: {...}, oracle: {...}, timestamp, ... }
//
// Scores DEX swap execution quality. Evaluates:
//   1. Simulation success
//   2. Output amount vs minAmountOut (primary metric)
//   3. Gas efficiency
//   4. Price impact
// =============================================================================

var config = {
  name: "DexAggregator",
  version: "1.0.0",
  type: "dex_aggregator",
};

function runtimeParams(state) {
  return state.typed_context || state.raw_params || state.rawParams || {};
}

var manifest = {
  intent_functions: [
    {
      name: "swap",
      description:
        "Execute a token swap via the best DEX route. User specifies input/output tokens, amount, and minimum output. Solver finds optimal routing across allowed DEX targets.",
      params: {
        input_token: {
          type: "address",
          description: "Input token address",
          source: "user",
        },
        output_token: {
          type: "address",
          description: "Output token address",
          source: "user",
        },
        input_amount: {
          type: "uint256",
          description: "Amount of input tokens to swap",
          source: "user",
        },
        min_output_amount: {
          type: "uint256",
          description: "Minimum acceptable output amount",
          source: "quote",
          quote_field: "suggested_min_output",
        },
        receiver: {
          type: "address",
          description: "Address to receive output tokens (defaults to submitter)",
          source: "system",
        },
        permit_deadline: {
          type: "uint256",
          description: "ERC-2612 permit deadline (0 = use pre-approval)",
          source: "system",
        },
        permit_v: {
          type: "uint8",
          description: "ERC-2612 permit signature v",
          source: "system",
        },
        permit_r: {
          type: "bytes32",
          description: "ERC-2612 permit signature r",
          source: "system",
        },
        permit_s: {
          type: "bytes32",
          description: "ERC-2612 permit signature s",
          source: "system",
        },
      },
      example_params: {
        input_token: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
        output_token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        input_amount: "1000000000000000000",
        min_output_amount: "1800000000",
        receiver: "0x0000000000000000000000000000000000000001",
        permit_deadline: "0",
        permit_v: "0",
        permit_r: "0x0000000000000000000000000000000000000000000000000000000000000000",
        permit_s: "0x0000000000000000000000000000000000000000000000000000000000000000",
      },
      scoring_hints: {
        goal: "Maximize output tokens received relative to minAmountOut",
        primary_metric: "output_ratio (outputAmount / minAmountOut)",
        secondary_metrics: ["gas_efficiency", "price_impact"],
      },
    },
  ],
  // Benchmark scenarios are chain-aware. Each scenario has an optional
  // "chains" field: if present, the scenario only runs on those chain IDs.
  // If absent, it runs on all chains (backward compat).
  benchmark_scenarios: [
    // ── Ethereum mainnet (chain 1) ──────────────────────────────────
    {
      name: "WETH_to_USDC",
      description: "Standard ETH to stablecoin swap (Ethereum)",
      chains: [1, 31337],
      intent_function: "swap",
      fund: {
        "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2": "1000000000000000000",
      },
      params: {
        input_token: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
        output_token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        input_amount: "1000000000000000000",
        min_output_amount: "1800000000",
        receiver: "0x0000000000000000000000000000000000000001",
        permit_deadline: "0", permit_v: "0",
        permit_r: "0x0000000000000000000000000000000000000000000000000000000000000000",
        permit_s: "0x0000000000000000000000000000000000000000000000000000000000000000",
      },
    },
    {
      name: "WBTC_to_USDC",
      description: "BTC to stablecoin swap (Ethereum)",
      chains: [1, 31337],
      intent_function: "swap",
      fund: {
        "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599": "10000000",
      },
      params: {
        input_token: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
        output_token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        input_amount: "10000000",
        min_output_amount: "4000000000",
        receiver: "0x0000000000000000000000000000000000000001",
        permit_deadline: "0", permit_v: "0",
        permit_r: "0x0000000000000000000000000000000000000000000000000000000000000000",
        permit_s: "0x0000000000000000000000000000000000000000000000000000000000000000",
      },
    },
    {
      name: "WBTC_to_WETH",
      description: "BTC to ETH swap (Ethereum)",
      chains: [1, 31337],
      intent_function: "swap",
      fund: {
        "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599": "10000000",
      },
      params: {
        input_token: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
        output_token: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
        input_amount: "10000000",
        min_output_amount: "2300000000000000000",
        receiver: "0x0000000000000000000000000000000000000001",
        permit_deadline: "0", permit_v: "0",
        permit_r: "0x0000000000000000000000000000000000000000000000000000000000000000",
        permit_s: "0x0000000000000000000000000000000000000000000000000000000000000000",
      },
    },
    // ── Base mainnet (chain 8453) ───────────────────────────────────
    // Tiny trades — tests concentrated liquidity efficiency
    {
      name: "WETH_to_USDC_tiny",
      description: "Tiny ETH to USDC swap (0.0005 ETH, Base)",
      chains: [8453],
      intent_function: "swap",
      fund: {
        "0x4200000000000000000000000000000000000006": "500000000000000",
      },
      params: {
        input_token: "0x4200000000000000000000000000000000000006",
        output_token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        input_amount: "500000000000000",
        min_output_amount: "1000000",
        receiver: "0x0000000000000000000000000000000000000001",
        permit_deadline: "0", permit_v: "0",
        permit_r: "0x0000000000000000000000000000000000000000000000000000000000000000",
        permit_s: "0x0000000000000000000000000000000000000000000000000000000000000000",
      },
    },
    {
      name: "USDC_to_WETH_tiny",
      description: "Tiny USDC to ETH swap (2 USDC, Base)",
      chains: [8453],
      intent_function: "swap",
      fund: {
        "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913": "2000000",
      },
      params: {
        input_token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        output_token: "0x4200000000000000000000000000000000000006",
        input_amount: "2000000",
        min_output_amount: "500000000000000",
        receiver: "0x0000000000000000000000000000000000000001",
        permit_deadline: "0", permit_v: "0",
        permit_r: "0x0000000000000000000000000000000000000000000000000000000000000000",
        permit_s: "0x0000000000000000000000000000000000000000000000000000000000000000",
      },
    },
    // Medium trades — realistic retail size
    {
      name: "WETH_to_USDC_medium",
      description: "0.1 ETH to USDC swap (Base)",
      chains: [8453],
      intent_function: "swap",
      fund: {
        "0x4200000000000000000000000000000000000006": "100000000000000000",
      },
      params: {
        input_token: "0x4200000000000000000000000000000000000006",
        output_token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        input_amount: "100000000000000000",
        min_output_amount: "200000000",
        receiver: "0x0000000000000000000000000000000000000001",
        permit_deadline: "0", permit_v: "0",
        permit_r: "0x0000000000000000000000000000000000000000000000000000000000000000",
        permit_s: "0x0000000000000000000000000000000000000000000000000000000000000000",
      },
    },
    {
      name: "USDC_to_WETH_medium",
      description: "250 USDC to ETH swap (Base)",
      chains: [8453],
      intent_function: "swap",
      fund: {
        "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913": "250000000",
      },
      params: {
        input_token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        output_token: "0x4200000000000000000000000000000000000006",
        input_amount: "250000000",
        min_output_amount: "80000000000000000",
        receiver: "0x0000000000000000000000000000000000000001",
        permit_deadline: "0", permit_v: "0",
        permit_r: "0x0000000000000000000000000000000000000000000000000000000000000000",
        permit_s: "0x0000000000000000000000000000000000000000000000000000000000000000",
      },
    },
    // Large trades — tests deeper liquidity and price impact
    {
      name: "WETH_to_USDC_large",
      description: "1 ETH to USDC swap (Base)",
      chains: [8453],
      intent_function: "swap",
      fund: {
        "0x4200000000000000000000000000000000000006": "1000000000000000000",
      },
      params: {
        input_token: "0x4200000000000000000000000000000000000006",
        output_token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        input_amount: "1000000000000000000",
        min_output_amount: "2000000000",
        receiver: "0x0000000000000000000000000000000000000001",
        permit_deadline: "0", permit_v: "0",
        permit_r: "0x0000000000000000000000000000000000000000000000000000000000000000",
        permit_s: "0x0000000000000000000000000000000000000000000000000000000000000000",
      },
    },
    {
      name: "USDC_to_WETH_large",
      description: "2500 USDC to ETH swap (Base)",
      chains: [8453],
      intent_function: "swap",
      fund: {
        "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913": "2500000000",
      },
      params: {
        input_token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        output_token: "0x4200000000000000000000000000000000000006",
        input_amount: "2500000000",
        min_output_amount: "800000000000000000",
        receiver: "0x0000000000000000000000000000000000000001",
        permit_deadline: "0", permit_v: "0",
        permit_r: "0x0000000000000000000000000000000000000000000000000000000000000000",
        permit_s: "0x0000000000000000000000000000000000000000000000000000000000000000",
      },
    },
    // XL trades — stress tests price impact handling
    {
      name: "WETH_to_USDC_xl",
      description: "5 ETH to USDC swap (Base)",
      chains: [8453],
      intent_function: "swap",
      fund: {
        "0x4200000000000000000000000000000000000006": "5000000000000000000",
      },
      params: {
        input_token: "0x4200000000000000000000000000000000000006",
        output_token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        input_amount: "5000000000000000000",
        min_output_amount: "10000000000",
        receiver: "0x0000000000000000000000000000000000000001",
        permit_deadline: "0", permit_v: "0",
        permit_r: "0x0000000000000000000000000000000000000000000000000000000000000000",
        permit_s: "0x0000000000000000000000000000000000000000000000000000000000000000",
      },
    },
    {
      name: "USDC_to_WETH_xl",
      description: "10000 USDC to ETH swap (Base)",
      chains: [8453],
      intent_function: "swap",
      fund: {
        "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913": "10000000000",
      },
      params: {
        input_token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        output_token: "0x4200000000000000000000000000000000000006",
        input_amount: "10000000000",
        min_output_amount: "3500000000000000000",
        receiver: "0x0000000000000000000000000000000000000001",
        permit_deadline: "0", permit_v: "0",
        permit_r: "0x0000000000000000000000000000000000000000000000000000000000000000",
        permit_s: "0x0000000000000000000000000000000000000000000000000000000000000000",
      },
    },
    // Cross-pair: DAI ↔ WETH — tests routing through less common pairs
    {
      name: "WETH_to_DAI",
      description: "0.5 ETH to DAI swap (Base)",
      chains: [8453],
      intent_function: "swap",
      fund: {
        "0x4200000000000000000000000000000000000006": "500000000000000000",
      },
      params: {
        input_token: "0x4200000000000000000000000000000000000006",
        output_token: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb",
        input_amount: "500000000000000000",
        min_output_amount: "1000000000000000000000",
        receiver: "0x0000000000000000000000000000000000000001",
        permit_deadline: "0", permit_v: "0",
        permit_r: "0x0000000000000000000000000000000000000000000000000000000000000000",
        permit_s: "0x0000000000000000000000000000000000000000000000000000000000000000",
      },
    },
    {
      name: "DAI_to_USDC",
      description: "1000 DAI to USDC stablecoin swap (Base)",
      chains: [8453],
      intent_function: "swap",
      fund: {
        "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb": "1000000000000000000000",
      },
      params: {
        input_token: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb",
        output_token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        input_amount: "1000000000000000000000",
        min_output_amount: "950000000",
        receiver: "0x0000000000000000000000000000000000000001",
        permit_deadline: "0", permit_v: "0",
        permit_r: "0x0000000000000000000000000000000000000000000000000000000000000000",
        permit_s: "0x0000000000000000000000000000000000000000000000000000000000000000",
      },
    },
    // cbBTC pair — Bitcoin on Base
    {
      name: "cbBTC_to_USDC",
      description: "0.01 cbBTC to USDC swap (Base)",
      chains: [8453],
      intent_function: "swap",
      fund: {
        "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf": "1000000",
      },
      params: {
        input_token: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
        output_token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        input_amount: "1000000",
        min_output_amount: "500000000",
        receiver: "0x0000000000000000000000000000000000000001",
        permit_deadline: "0", permit_v: "0",
        permit_r: "0x0000000000000000000000000000000000000000000000000000000000000000",
        permit_s: "0x0000000000000000000000000000000000000000000000000000000000000000",
      },
    },
    {
      name: "cbBTC_to_WETH",
      description: "0.01 cbBTC to ETH swap (Base)",
      chains: [8453],
      intent_function: "swap",
      fund: {
        "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf": "1000000",
      },
      params: {
        input_token: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
        output_token: "0x4200000000000000000000000000000000000006",
        input_amount: "1000000",
        min_output_amount: "300000000000000000",
        receiver: "0x0000000000000000000000000000000000000001",
        permit_deadline: "0", permit_v: "0",
        permit_r: "0x0000000000000000000000000000000000000000000000000000000000000000",
        permit_s: "0x0000000000000000000000000000000000000000000000000000000000000000",
      },
    },
  ],
};

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

  // 2. Extract order params from state (snake_case primary, camelCase fallback)
  var params = runtimeParams(state);
  var minAmountOut = params.min_output_amount || params.min_amount_out || params.minAmountOut || "0";
  var tokenOut = (params.output_token || params.token_out || params.tokenOut || "").toLowerCase();
  var receiver = (params.receiver || params.submitted_by || "").toLowerCase();
  var appAddr = (state.contract_address || "").toLowerCase();

  // 3. Analyze token transfers from simulation
  var transfers = sim.token_transfers || sim.tokenTransfers || [];
  var gasUsed = sim.gas_used || sim.gasUsed || 0;

  if (transfers.length === 0) {
    return { score: 0, valid: false, reason: "No token transfers detected" };
  }

  // Find output token transfer to the receiver (or app address)
  var outputAmount = 0;
  for (var i = 0; i < transfers.length; i++) {
    var t = transfers[i];
    var toAddr = (t.to_addr || t.to || "").toLowerCase();
    var tokenAddr = (t.token || t.token_address || "").toLowerCase();

    // Output goes to receiver or app (app delivers in _checkIntent)
    if (tokenAddr === tokenOut && (toAddr === receiver || toAddr === appAddr)) {
      outputAmount += parseFloat(t.amount || t.value || "0");
    }
  }

  if (outputAmount === 0) {
    return {
      score: 0,
      valid: false,
      reason: "No output tokens received by receiver",
    };
  }

  // 4. Calculate output ratio
  var minOut = parseFloat(minAmountOut);
  if (minOut <= 0) {
    return { score: 0, valid: false, reason: "Invalid minAmountOut" };
  }

  var outputRatio = outputAmount / minOut;
  if (outputRatio < 1.0) {
    return {
      score: 0,
      valid: false,
      reason:
        "Output below minimum: " +
        outputAmount.toFixed(0) +
        " < " +
        minOut.toFixed(0),
    };
  }

  // 5. Score components
  // Output quality: 0.5 at exactly minAmountOut, linear to 1.0 at 2x min
  var outputScore = Math.min(1.0, 0.5 + (outputRatio - 1.0) * 0.5);

  // Gas efficiency: penalize high gas usage
  var gasScore = gasUsed > 0 ? Math.max(0, 1 - gasUsed / 1000000) : 0.5;

  // Price impact (if available from simulation)
  var priceImpact = sim.price_impact || sim.priceImpact || 0;
  var impactScore = Math.max(0, 1 - Math.abs(priceImpact) * 20);

  // Weighted final score
  var finalScore = outputScore * 0.7 + gasScore * 0.15 + impactScore * 0.15;
  finalScore = Math.max(0, Math.min(1.0, finalScore));

  return {
    score: finalScore,
    valid: true,
    reason:
      "Swap OK: output=" +
      outputAmount.toFixed(0) +
      " min=" +
      minOut.toFixed(0) +
      " ratio=" +
      outputRatio.toFixed(4) +
      " gas=" +
      gasUsed,
    breakdown: {
      output_score: outputScore,
      output_ratio: outputRatio,
      gas_score: gasScore,
      gas_used: gasUsed,
      impact_score: impactScore,
      num_transfers: transfers.length,
    },
    metadata: {
      output_amount: outputAmount,
      min_amount_out: minOut,
      surplus: outputAmount - minOut,
    },
  };
}

function validate(plan, state, context) {
  // Structural validation before scoring
  if (!plan || !plan.calls || plan.calls.length === 0) {
    return { score: 0, valid: false, reason: "Empty execution plan" };
  }

  var params = runtimeParams(state);
  var tokenIn = params.input_token || params.tokenIn || params.token_in || "";
  var tokenOut = params.output_token || params.tokenOut || params.token_out || "";
  if (!tokenIn || !tokenOut) {
    return {
      score: 0,
      valid: false,
      reason: "Missing input_token or output_token in state",
    };
  }
  if (tokenIn.toLowerCase() === tokenOut.toLowerCase()) {
    return { score: 0, valid: false, reason: "input_token == output_token" };
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
