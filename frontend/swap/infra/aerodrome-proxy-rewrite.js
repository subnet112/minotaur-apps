// CloudFront Function (runtime: cloudfront-js-2.0), viewer-request.
// Associated with the `/ext/aerodrome/*` behavior on the app distribution.
// Rewrites /ext/aerodrome/<x> -> /api/v1/<x> so the same-origin proxy path
// maps to Aerodrome's real API path. See cloudfront-aerodrome-proxy.md.
function handler(event) {
    var request = event.request;
    var prefix = '/ext/aerodrome/';
    if (request.uri.startsWith(prefix)) {
        request.uri = '/api/v1/' + request.uri.substring(prefix.length);
    }
    return request;
}
