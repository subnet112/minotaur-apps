# Refreshing the bundled Aerodrome token snapshot

`src/config/aerodrome-base-tokens.ts` is a **hardcoded snapshot** of Aerodrome's
whitelisted (`listed`) Base tokens. Aerodrome has no public token-list REST API
— its own frontend reads tokens on-chain from the **Sugar lens**, so we do the
same once and bundle the result (no runtime fetch, no CORS, no RPC dependency).
The merge with the Superchain list lives in `src/api/client.ts`.

Regenerate periodically (the whitelist changes slowly) or when a notable token
is missing.

## Source
- Contract: **LpSugar** on Base `0x69dD9db6d8f8E7d83887A704f447b1a584b599A1`
- Function: `tokens(uint256 limit, uint256 offset, address account, address[] addresses)`
  → `(address token_address, string symbol, uint8 decimals, uint256 account_balance, bool listed)[]`
- `limit`/`offset` paginate over **pools**; we keep entries with `listed == true`
  (whitelisted by the Aerodrome voter). `account = 0x0`, `addresses = []`.
- Sugar deployment addresses: `velodrome-finance/sugar` repo, `deployments/base.env`
  (`LP_SUGAR_ADDRESS_8453`).

## Regenerate (requires `foundry`/`cast`)
```bash
SUGAR=0x69dD9db6d8f8E7d83887A704f447b1a584b599A1
RPC=https://mainnet.base.org
SIG="tokens(uint256,uint256,address,address[])((address,string,uint8,uint256,bool)[])"
RAW=/tmp/aero-raw.txt; : > "$RAW"
# Page over all pools (~33k; step until a page returns 0 entries).
for off in $(seq 0 1500 60000); do
  out=$(cast call "$SUGAR" "$SIG" 1500 "$off" 0x0000000000000000000000000000000000000000 "[]" --rpc-url "$RPC" 2>/dev/null)
  n=$(printf '%s' "$out" | grep -oE '0x[0-9a-fA-F]{40}' | wc -l)
  printf '%s\n' "$out" >> "$RAW"
  echo "offset $off -> $n"
  [ "$n" -eq 0 ] && break
done

# Parse listed==true, dedupe by address, emit the TS module.
python3 - "$RAW" > src/config/aerodrome-base-tokens.ts <<'PY'
import re, sys, json
raw = open(sys.argv[1]).read()
pat = re.compile(r'\((0x[0-9a-fA-F]{40}),\s*"((?:[^"\\]|\\.)*)",\s*(\d+),\s*\d+,\s*(true|false)\)')
seen = {}
for m in pat.finditer(raw):
    seen.setdefault(m.group(1).lower(),
        {"address": m.group(1), "symbol": m.group(2), "decimals": int(m.group(3)), "listed": m.group(4) == "true"})
listed = sorted([v for v in seen.values() if v["listed"]], key=lambda t: t["symbol"].lower())
print("// Aerodrome whitelisted (listed) tokens on Base (chain 8453).")
print("// Snapshot from the on-chain Sugar lens — see infra/refresh-aerodrome-tokens.md.")
print(f"// {len(listed)} tokens.\n")
print("export interface AerodromeToken {\n  address: string\n  symbol: string\n  decimals: number\n}\n")
print("export const AERODROME_BASE_TOKENS: AerodromeToken[] = [")
for t in listed:
    print(f'  {{ address: {json.dumps(t["address"])}, symbol: {json.dumps(t["symbol"])}, decimals: {t["decimals"]} }},')
print("]")
PY
```

## After regenerating
- `pnpm exec vitest run tests/unit/api/client.test.ts` (sanity on the data + merge).
- Commit the regenerated `src/config/aerodrome-base-tokens.ts`.

(Logos are not included in this snapshot — the selector renders a symbol glyph
for entries without a `logoURI`. Whether to also bundle/fetch logos is a
separate decision.)
