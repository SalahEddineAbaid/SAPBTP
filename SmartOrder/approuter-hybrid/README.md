# SmartOrder Hybrid AppRouter

This AppRouter is intentionally separate from the production `approuter/` module.
Use it to validate the XSUAA login flow, JWT forwarding, and routing before wiring
the deployed application end to end.

## Prerequisites

Bind at least XSUAA and Destination to the hybrid profile:

```sh
cds bind --to SmartOrder-auth,SmartOrder-destination --for hybrid
```

## Start Order

1. Start the CAP backend with XSUAA hybrid profile:

```sh
npm run hybrid
```

2. Start React in XSUAA mode:

```sh
cd app/orders-ui
npm run start:xsuaa
```

This starts React on port `3002`, which is the default `ui-local`
destination used by this hybrid AppRouter.

3. Start the dedicated hybrid AppRouter:

```sh
cds bind --profile hybrid --exec -- npm --prefix approuter-hybrid start
```

Open the AppRouter URL, usually:

```text
http://localhost:5000
```

In SAP BAS, expose/open port `5000`.

If the AppRouter returns `502 Bad Gateway` for `/index.html`, React is not
running on port `3002` or the AppRouter was started with a different
`SMARTORDER_UI_URL`.

## Expected Checks

- Opening `/` redirects to XSUAA login before React is loaded.
- Calling `/api/me` through the AppRouter returns the logged-in user, role, scopes, and `authType: "xsuaa"`.
- Calls to `/odata/v4/...` and `/api/...` reach the CAP backend with the forwarded JWT.
- Direct calls to `http://localhost:4004/api/...` should not be used for XSUAA validation because they bypass the AppRouter.
