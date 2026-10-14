# Identity and access model

The static frontend supports OAuth 2.0 Authorization Code with PKCE for a public OIDC client. No client secret is present in the browser. Configure the public values in `frontend/.env.example` using your identity provider's authorization and token endpoints, client ID, redirect URI, and API audience. Register the exact redirect URI with the provider. The provider must allow CORS for its token endpoint.

The Worker independently verifies Bearer JWTs using the configured `AUTH_JWKS_URL`, `AUTH_ISSUER`, and `AUTH_AUDIENCE`. The access token's issuer and audience must match those exact Worker settings; a frontend login alone is not a substitute for server-side verification. Set those values as Worker variables, not client-side public variables.

The access token stays in `sessionStorage`, expires according to the returned access-token lifetime, and is never sent to an analytics service. For production, use short-lived tokens, strict CSP, a trusted OIDC provider, and test logout/expired-token behavior. The static-client PKCE implementation does not request or store refresh tokens. Sign in again when the access token expires.

## RBAC

Workspace members inherit the workspace role. An explicit document member role can restrict or grant document-specific viewer/editor access. Only a document owner can grant or remove per-document access. Share-by-email is currently limited to people who have signed in at least once so that the email resolves to an existing identity row; no email invitations are sent from the app.

Document access is checked by the Worker before issuing a one-time ticket. Ticket use is consumed transactionally in the document's SQLite storage. A websocket can no longer rely on custom Authorization headers (the browser WebSocket API doesn't expose them); instead it receives the short-lived single-use ticket and the Durable Object validates that same ticket and document scope. Viewers are rejected from sending CRDT edits.
