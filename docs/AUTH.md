# Identity and access model

The static frontend uses Auth0's SPA SDK with OAuth 2.0 Authorization Code Flow + PKCE. The browser is a public client: do not create, request, or ship a client secret. Configure the tenant's /authorize URL, public client ID, token audience, callback URL, and scopes in the public frontend variables. The SDK requests offline_access and uses rotating refresh tokens to renew access tokens without requiring the user to sign in again each time an access token expires.

In Auth0, enable Refresh Token Rotation for the SPA and enable Allow Offline Access for the API. The SDK cache is backed by sessionStorage, scoped to the current tab, so the session can survive reloads in that tab without putting token data into localStorage. Browser storage is still accessible to same-origin JavaScript; prevent XSS, avoid unsafe HTML injection, and keep the Content Security Policy restrictive. Logout clears the SDK cache and redirects through Auth0.

### Authorize the SPA to request the API audience

The frontend requests an access token for the API identifier `https://collab-docs-api`. If the API's user-access policy requires a client grant, the SPA must be explicitly authorized for that API or Auth0 returns `Client is not authorized to access resource server` before issuing a code.

In Auth0 Dashboard, open **Applications → Applications → Collab Docs → APIs**, select **Edit** for the API identified by `https://collab-docs-api`, and set **User-Delegated Access** to **Authorized**. Select only the API permissions the application should be allowed to request, then save. This is a user-delegated authorization-code flow; do not enable Client Credentials or add a client secret to the SPA. The frontend currently requests `openid profile email offline_access`; API permissions are not currently used as the application's RBAC source of truth. The Worker's database-backed workspace/document membership checks remain authoritative.

If the API has a user access policy of `require_client_grant`, the per-application user-delegated grant is the intended fix. Avoid changing the API to `allow_all` just to work around a missing per-app grant, because that widens access for other applications.

The Worker independently verifies Bearer JWTs using the configured AUTH_JWKS_URL, AUTH_ISSUER, and AUTH_AUDIENCE. The access token's issuer and audience must match those exact Worker settings; a frontend login alone is not a substitute for server-side verification. Store these values in GitHub Actions secrets and production Worker secrets. Never put them in frontend variables or source control. The repository deploy workflow validates them and syncs them to the Worker after deploy.

## RBAC

Workspace members inherit the workspace role. An explicit document member role can restrict or grant document-specific viewer/editor access. Only a document owner can grant or remove per-document access. Share-by-email is currently limited to people who have signed in at least once so that the email resolves to an existing identity row; no email invitations are sent from the app.

Document access is enforced by the Worker's database-backed membership checks before it issues a one-time ticket. The app's current authorization source of truth is its workspace/document membership tables; it does not trust role names supplied by the browser. Auth0 API permissions/roles can be extended later, but configuring them alone does not replace these database checks.

Document access is checked by the Worker before issuing a one-time ticket. Ticket use is consumed transactionally in the document's SQLite storage. A websocket can no longer rely on custom Authorization headers (the browser WebSocket API doesn't expose them); instead it receives the short-lived single-use ticket and the Durable Object validates that same ticket and document scope. Viewers are rejected from sending CRDT edits.
