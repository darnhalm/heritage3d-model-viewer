# Public Geoscan links

The adapter supports public `https://cloud.geoscan.ru/shared/projects/{access}` and
`https://cloud.geoscan.ru/embedded/projects/{project}/{access}/` links. It never uses
a user's login, Geoscan account, or API key. Revoking public access prevents resolution.
Private projects and projects without a completed `CESIUM_TILES_3TZ` dataset are rejected.

Geoscan's API and archive storage do not currently expose CORS headers to other sites.
This server component is therefore required; the Object Storage website alone cannot
serve these links. The browser retains the public project URL and the selected dataset,
and requests archive byte ranges from the adapter. Signed URLs stay on the server, are
renewed before expiration and retried once on expiration. Each response is limited to
1 MiB, and full-archive requests are refused. The viewer reads in 1 MiB windows,
with up to four windows per random-access read in parallel. The adapter coalesces
identical in-flight byte requests and retains up to 32 MiB / 256 ranges for 30 seconds,
scoped to the public access link, dataset and project version. Public-access metadata
is still checked before cache lookup; responses remain `no-store` in the browser.
No model is copied into this repository or uploaded to the viewer's bucket.

The client retries the same range at most twice after a transport error or HTTP
429/500/502/503/504, with abortable delays of 500 ms and 1 s. Changing scenes cancels
the backoff. Access errors and changed archives are not retried by this mechanism;
server-side signature renewal remains a separate single retry.

## Local preview

Requires Node 22+ with trusted system certificates for Geoscan and Yandex Object Storage.

```sh
npm run build
npm run serve:geoscan
```

Open `http://127.0.0.1:43498/` and paste a public link into the model URL field, or use
`?load=` with the URL encoded as one query parameter. A project with several models
shows a model selector. `dataset=<dataset UUID>` in the public link preserves a choice.

Run server tests with `node --test server/geoscan.test.mjs`.

## Production

The deployed adapter is `h3d-geoscan-proxy`, function ID `d4eb71kvccndgbgedg7f`.
Its public endpoint is `https://functions.yandexcloud.net/d4eb71kvccndgbgedg7f`.

Deploy `geoscan.mjs`, `index.js` and the `certs/` directory together, at the root of a ZIP, to a Node 22+
Yandex Cloud Function with entry point `index.handler`, 256 MiB memory and a 90 second
timeout. No dependencies or cloud credentials are needed by the handler. Enable public
invocation, since the upstream project's public link itself grants access.

Build the viewer with `GEOSCAN_PROXY_URL=https://functions.yandexcloud.net/<function-id>`.
The manual viewer deployment workflow reads this value from the repository variable
`GEOSCAN_PROXY_URL`. An ordinary web server can instead mount `createGeoscanHandler()`
at `/api/geoscan`; in that case no build variable is required.

CORS defaults to the exact production viewer origin,
`https://playcanvasviewer.website.yandexcloud.net`. To host the viewer on other domains,
set `GEOSCAN_ALLOWED_ORIGINS` to their comma-separated origins (no paths or trailing slash).
Foreign browser origins, including `null`, receive 403 before any upstream requests.
Local preview permits only its own loopback origins. Embedding our hosted player in an
iframe still uses the player's origin and does not require adding the embedding website.
Requests without Origin are supported for same-origin use and server clients: CORS is
a browser restriction, not authentication or protection against direct scripted traffic.

The server only accepts the fixed Geoscan host and public UUID routes. Upstream API
redirects to sign-in are refused, archive URLs must be HTTPS Yandex Object Storage,
and only one bounded byte range is forwarded. The adapter responds with CORS headers
and exposes archive validators, so changing the model during a session is detected by
the archive reader instead of mixing bytes from different versions.

The Geoscan endpoints are the public web application's current API rather than a
versioned integration contract; changes there may require an adapter update.

## Upstream TLS chain

Geoscan currently presents a Russian Trusted CA certificate and does not send its
intermediate. `certs/geoscan-ca.pem` contains the official root and both intermediates,
downloaded with HTTPS verification from the links published by Gosuslugi:

- https://gu-st.ru/content/lending/russian_trusted_root_ca_pem.crt
- https://gu-st.ru/content/lending/russian_trusted_sub_ca_pem.crt
- https://gu-st.ru/content/lending/russian_trusted_sub_ca_2024_pem.crt

SHA-256 fingerprints, in the same order:

```text
D26D2D0231B7C39F92CC738512BA54103519E4405D68B5BD703E9788CA8ECF31
BBBDE2103E790B999EC62BD03CF625A5A2E7C316E10AFE6A490EEDEAD8B3FD9B
2155785036C900DBB5F1BB2A1569C80C55595BD6BF94867A29BBDDBC7D88A3F2
```

These certificates are used only for HTTPS requests to `cloud.geoscan.ru`. The
adapter keeps certificate and hostname verification enabled; it does not change
the operating system trust store or the process-wide TLS defaults.
