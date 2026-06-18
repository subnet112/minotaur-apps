# DexAggregatorApp redeploy runbook

A redeploy needs four things to be true before orders execute. Three are
on-chain and now happen — and are **asserted** — in one broadcast by
`DeployAndWireDexAggregator.s.sol`; the fourth is an off-chain platform record.
This runbook ties them together so a redeploy can't silently ship half-wired
(the failure mode that took prod down: the new contract had no WETH fee
approval, so every swap reverted in fee settlement).

| # | Step | Where | Handled by |
|---|------|-------|-----------|
| 1 | Intent registration (SWAP + BRIDGE selectors) | on-chain | constructor (automatic) |
| 2 | AppRegistry mapping (`appByContract[new] = appId`) | on-chain | script step 2 + read-back assert |
| 3 | WETH fee approval (paymaster → new contract) | on-chain | script step 3 + read-back assert |
| 4 | Platform deployment record → new address | off-chain | manual, below |

The script **reverts** if 1–3 aren't all true after broadcast, so an
incomplete deploy fails loud instead of executing.

## On-chain (one broadcast)

The deployer key must be the contract relayer **and** the AppRegistry
owner/allowlisted-developer **and** the fee paymaster. On the live Base config
that's all `MinoDeployerPK` (`0xD4cF…`), so one key does all three.

```bash
cd contracts
export DEPLOYER_PRIVATE_KEY=<MinoDeployerPK>
export VALIDATOR_REGISTRY=0x88a08d1105393EACE9B6f5ff678DbE508B8639aC   # Base
export APP_REGISTRY=0x0B5fE44e90515571761D86C28c4855F325EDE098        # Base
export WRAPPED_NATIVE_TOKEN=0x4200000000000000000000000000000000000006 # WETH (Base)
export PLATFORM_FEE_COLLECTOR=<treasury>      # current collector
export FEE_COLLECTOR=<positive-slippage collector>
export APP_PAYMASTER=0xD4cF78059243fAED77350f2dD7e73d5300465D70  # == deployer (so the script can approve)
# Fresh on-chain app id (NOT the platform "app_da6c96b84c60" id — a new bytes32 per deploy):
export APP_ID=$(cast keccak "dex-aggregator-$(date -u +%s)")
# sha256 of the current JS scoring bundle (unchanged by the scoring fix):
export MANIFEST_HASH=<sha256 of contracts/scoring/dex_aggregator_scoring.js>
# defaults are fine: SCORE_THRESHOLD=5000 FEE_MODE=APP MAX_PLATFORM_FEE_WEI=1e17 FEE_BPS=5000

# 1) DRY RUN first — simulates deploy+register+approve and runs the read-back
#    assertions WITHOUT broadcasting. If any wiring would be missing it reverts here.
forge script script/DeployAndWireDexAggregator.s.sol --rpc-url "$BASE_RPC_URL"

# 2) Broadcast for real once the dry run prints "DEPLOYED + WIRED + VERIFIED":
forge script script/DeployAndWireDexAggregator.s.sol --rpc-url "$BASE_RPC_URL" --broadcast
# -> grab DEX_AGGREGATOR=0x... from the output
```

If `APP_PAYMASTER`/`FEE_COLLECTOR` is ever NOT the deployer, the script reverts
up front (it can't sign the WETH approval for another key) — run
`WETH.approve(<new app>, max)` from the paymaster key separately in that case.

## Off-chain (platform deployment record)

The blockloop routes an order to whatever `contract_address` the platform's
deployment record holds for the app (`app_store.get_deployment`). Point it at
the new address — update the existing record (keeps `js_code_hash`/`abi`/status)
via the platform's own store API, on the box running the api:

```bash
NEW=0x<DEX_AGGREGATOR from above>
docker exec production-api-1 python - <<EOF
from minotaur_subnet.store.app_intent_store import AppIntentStore
import os
s = AppIntentStore(os.environ.get("APP_INTENTS_STORE_PATH", "/data/store.db"))
APP_ID = "app_da6c96b84c60"   # the platform (logical) app id
dep = s.get_deployment(APP_ID, chain_id=8453)
assert dep, "no existing deployment record"
dep.contract_address = "$NEW"
s.save_deployment(dep)
print("record now ->", s.get_deployment(APP_ID, chain_id=8453).contract_address)
EOF
```

## Verify

The on-chain wiring is already asserted by the script. Confirm end-to-end by
firing a small USDC→ETH order and watching it fill (the previous outage showed
up as an opaque `execution reverted` in the relayer during fee settlement —
that's exactly what the WETH-approval step prevents).
