# Identity and access model

The static frontend supports OAuth 2.0 Authorization Code with PKCE for a public OIDC client. No client secret is present in the browser. Auth0 Free is the selected provider because its standards-based OIDC endpoints fit the current implementation without replacing the auth client with a provider-specific SDK. Create a Single Page Application (public client) and an API with identifier `https://collab-docs-api`. Configure the public values in `frontend/.env.example` using the tenant's authorization and token endpoints, client ID, redirect URI `https://collab-docs-4tb.pages.dev/`, and that API audience. Register the exact redirect URI with the provider and allow the Pages origin for browser token exchange.

The Worker independently verifies Bearer JWTs using the configured `AUTH_JWKS_URL`, `AUTH_ISSUER`, and `AUTH_AUDIENCE`. The access token's issuer and audience must match those exact Worker settings; a frontend login alone is not a substitute for server-side verification. Store these values in GitHub Actions secrets and production Worker secrets. Never put them in frontend variables or source control. The repository deploy workflow validates them and syncs them to the Worker after deploy.

The access token stays in `sessionStorage`, expires according to the returned access-token lifetime, and is never sent to an analytics service. For production, use short-lived tokens, strict CSP, a trusted OIDC provider, and test logout/expired-token behavior. The static-client PKCE implementation does not request or store refresh tokens. Sign in again when the access token expires.

## RBAC

Workspace members inherit the workspace role. An explicit document member role can restrict or grant document-specific viewer/editor access. Only a document owner can grant or remove per-document access. Share-by-email is currently limited to people who have signed in at least once so that the email resolves to an existing identity row; no email invitations are sent from the app.

Document access is checked by the Worker before issuing a one-time ticket. Ticket use is consumed transactionally in the document's SQLite storage. A websocket can no longer rely on custom Authorization headers (the browser WebSocket API doesn't expose them); instead it receives the short-lived single-use ticket and the Durable Object validates that same ticket and document scope. Viewers are rejected from sending CRDT edits.
