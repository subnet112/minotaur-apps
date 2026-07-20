# Refreshing the bundled Ethereum token snapshot

`src/config/ethereum-tokens.ts` is a **hardcoded snapshot** of the curated
Ethereum mainnet (chain 1) token set: the **Uniswap Labs Default token list**
filtered to chainId 1, **plus wTAO** (which neither the Uniswap nor the
Superchain list carries). It's the Ethereum analogue of the bundled Aerodrome
Base snapshot — it adds the curated long tail the Superchain backbone omits, with
no runtime fetch, no CORS, no RPC dependency. The merge with the Superchain list
lives in `src/api/client.ts` (`ETH_CHAIN_ID` branch).

Regenerate periodically (the list moves slowly) or when a notable token is missing.

## Source
- Token list: **Uniswap Labs Default** — `https://tokens.uniswap.org`
  (Token Lists standard JSON; the same list Uniswap's own frontend ships).
- We keep `chainId === 1` entries, dedupe by lower-cased address, and always
  re-seed **wTAO** (`0x77E06c9eCCf2E797fd462A92B6D7642EF85b0A44`, symbol `wTAO`,
  `9` decimals — verified on-chain via `symbol()`/`name()`/`decimals()`).

If you need to add other tokens the Uniswap list lacks (e.g. more
Bittensor-ecosystem assets), add them to the `EXTRA` list in the script below
after verifying each address/decimals on-chain.

## Regenerate (needs `curl` + `python3`)
```bash
cd frontend/swap
curl -s https://tokens.uniswap.org -o /tmp/uni.json
python3 - > src/config/ethereum-tokens.ts <<'PY'
import json
d = json.load(open('/tmp/uni.json'))
ver = d.get('version', {})
# Tokens the Uniswap list omits — verify address/decimals on-chain before adding.
EXTRA = [
    {"address": "0x77E06c9eCCf2E797fd462A92B6D7642EF85b0A44", "symbol": "wTAO", "decimals": 9},
]
seen = {}
for t in d.get('tokens', []):
    if t.get('chainId') != 1 or not t.get('address'):
        continue
    seen.setdefault(t['address'].lower(),
        {"address": t['address'], "symbol": t['symbol'], "decimals": int(t['decimals'])})
for e in EXTRA:
    seen.setdefault(e["address"].lower(), e)
toks = sorted(seen.values(), key=lambda t: t["symbol"].lower())
print("// Curated Ethereum mainnet (chain 1) token snapshot.")
print("//")
print("// Sourced from the Uniswap Labs Default token list (https://tokens.uniswap.org),")
print("// filtered to chainId 1, plus wTAO (not carried by Uniswap/Superchain). The")
print("// Superchain list is the runtime backbone; this snapshot adds the curated")
print("// Ethereum long tail the same way AERODROME_BASE_TOKENS does for Base. Merged")
print("// with the Superchain list in src/api/client.ts. Refresh: see")
print("// infra/refresh-ethereum-tokens.md.")
print(f"// {len(toks)} tokens (Uniswap Labs Default v{ver.get('major')}.{ver.get('minor')}.{ver.get('patch')} + wTAO).\n")
print("export interface EthereumToken {")
print("  address: string")
print("  symbol: string")
print("  decimals: number")
print("}\n")
print("export const ETHEREUM_TOKENS: EthereumToken[] = [")
for t in toks:
    print(f'  {{ address: {json.dumps(t["address"])}, symbol: {json.dumps(t["symbol"])}, decimals: {t["decimals"]} }},')
print("]")
PY
```

## After regenerating
- `pnpm exec vitest run tests/unit/api/client.test.ts` (sanity on the data + merge).
- Commit the regenerated `src/config/ethereum-tokens.ts`.

(Logos are not included in this snapshot — the selector renders a symbol glyph
for entries without a `logoURI`, and `getChainTokens` backfills a SmolDapp CDN
logo URL by address. Same trade-off as the Aerodrome snapshot.)
