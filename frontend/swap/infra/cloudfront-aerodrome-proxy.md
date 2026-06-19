# CloudFront same-origin proxy for the Aerodrome token list

## Why
The swap token selector merges two keyless token lists: the **Superchain Token
List** (static CDN, CORS-open) and **Aerodrome's** own Base list
(`https://api.aerodrome.finance/api/v1/assets`). Aerodrome's API sends **no CORS
headers**, so a browser on `app.minotaursubnet.com` cannot read it cross-origin
(`CORS request did not succeed`). Without a fix the frontend silently falls back
to Superchain-only.

Fix: serve the Aerodrome list **same-origin** through the existing app
CloudFront distribution. The browser fetches `app.minotaursubnet.com/ext/aerodrome/assets`
(same-origin → no CORS); CloudFront fetches `api.aerodrome.finance/api/v1/assets`
server-side and caches the response. The frontend points `AERODROME_ASSETS_URL`
at the relative path `/ext/aerodrome/assets` (see `src/api/client.ts`).

This stays entirely client-side — nothing is added to the validator.

## What to create (one-time, in the app distribution `E2RILM96HX5PRK`)

### 1. CloudFront Function — URI rewrite `/ext/aerodrome/*` → `/api/v1/*`
Runtime `cloudfront-js-2.0`, associated on **viewer request** of the new behavior.

```js
function handler(event) {
    var request = event.request;
    var prefix = '/ext/aerodrome/';
    if (request.uri.startsWith(prefix)) {
        request.uri = '/api/v1/' + request.uri.substring(prefix.length);
    }
    return request;
}
```
(Use a CloudFront **Function**, not Lambda@Edge — ~$0.10/M invocations, no
duration charge.)

### 2. Origin — Aerodrome API
- Origin domain: `api.aerodrome.finance`
- Protocol: **HTTPS only**
- Origin path: *(empty — the function sets the full `/api/v1/...` path)*
- Name/ID: `aerodrome-api`
- Origin Shield: off

### 3. Cache behavior
- Path pattern: `/ext/aerodrome/*`
- Origin: `aerodrome-api`
- Viewer protocol policy: **Redirect HTTP to HTTPS**
- Allowed methods: **GET, HEAD**
- Cache policy: a custom policy with **MinTTL 3600 / DefaultTTL 3600 /
  MaxTTL 86400**, cache key = **path only** (no query strings / cookies /
  headers). MinTTL ≥ 3600 forces ~1h caching even if Aerodrome sends
  `no-cache`, which keeps cost in pennies and adds resilience to Aero blips.
  (`CachingOptimized` also works if Aerodrome returns cacheable headers, but the
  custom MinTTL guarantees it.)
- Function association: **Viewer request → the function above.**
- No origin request policy needed: CloudFront sends `Host: api.aerodrome.finance`
  to a custom origin by default, which is what the API expects.

## Apply via console (simplest)
Distribution `E2RILM96HX5PRK` → Functions (create + **Publish**) → Origins
(create `aerodrome-api`) → Behaviors (create `/ext/aerodrome/*` as above) →
Save. Wait ~5 min for **Deployed**.

## Apply via CLI (alternative)
```bash
# 1. Create + publish the function
aws cloudfront create-function \
  --name aerodrome-proxy-rewrite \
  --function-config Comment="Rewrite /ext/aerodrome/* to Aerodrome /api/v1/*",Runtime=cloudfront-js-2.0 \
  --function-code fileb://aerodrome-proxy-rewrite.js
# note the ETag from the response, then:
aws cloudfront publish-function --name aerodrome-proxy-rewrite --if-match <ETag>

# 2. Edit the distribution config (add origin + behavior + function assoc)
aws cloudfront get-distribution-config --id E2RILM96HX5PRK > dist.json
#   - add the aerodrome-api origin to .DistributionConfig.Origins
#   - add the /ext/aerodrome/* behavior to .DistributionConfig.CacheBehaviors
#     with FunctionAssociations -> EventType=viewer-request, FunctionARN=<published ARN>
aws cloudfront update-distribution --id E2RILM96HX5PRK \
  --distribution-config file://<edited DistributionConfig> --if-match <ETag from get>
```
(The console is less error-prone than hand-editing the full distribution JSON.)

## Verify
```bash
curl -s https://app.minotaursubnet.com/ext/aerodrome/assets | head -c 200
# expect: {"data":[{"address":"0x...","symbol":"...","decimals":...,...}, ...]}
curl -sI https://app.minotaursubnet.com/ext/aerodrome/assets | grep -i x-cache
# expect Hit from cloudfront on the 2nd call
```
Then hard-refresh `app.minotaursubnet.com`: the swap token selector should gain
the Aero-native long tail, and the `[swap] Aerodrome token list unavailable`
console warning should be gone.

## Cost
Pennies–~$1/mo at generous traffic: CloudFront has no fixed fee, the distribution
already exists, the JSON is small + cached (~1h TTL bounds origin fetches to
~24/day), and the Function is ~$0.10/M invocations.

## Rollback
Delete the `/ext/aerodrome/*` behavior (and/or the origin + function). The
frontend fetch of `/ext/aerodrome/assets` then fails and the selector falls back
to Superchain-only automatically — no frontend change required.
