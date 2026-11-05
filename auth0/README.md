# Vixiny — Auth0 branding and production setup

Vixiny uses Auth0 as a public Single Page Application (SPA) with Authorization Code Flow + PKCE. The tenant domain, API audience, issuer and JWKS URL are infrastructure identifiers and intentionally remain unchanged during the product rebrand.

Committing branding files does not change the hosted Auth0 login page by itself. Apply the files below in the Auth0 Dashboard.

## 1. Update the Auth0 application allowlists

Open **Applications → Applications → the existing Vixiny SPA → Settings**. Keep the existing Client ID, client type, API audience, grant types, and refresh-token configuration.

Add all of these values to **Allowed Callback URLs**:

- `https://collab-docs-4tb.pages.dev/`
- `https://www.collabdocs.qd.je/`
- `http://localhost:3000/`

Add the same three URLs to **Allowed Logout URLs**.

Add these origins (without a trailing slash) to **Allowed Web Origins**:

- `https://collab-docs-4tb.pages.dev`
- `https://www.collabdocs.qd.je`
- `http://localhost:3000`

Save the application settings. The frontend now derives its callback from the current website origin, so the same build can run on the current Pages.dev address and the Vixiny custom domain. Auth0 must allow each origin explicitly.

The custom domain remains pending until its DNS CNAME is published and Cloudflare validates the domain. Keep the Pages.dev URLs allowed so existing users can still sign in.

## 2. Apply the Vixiny login branding

In **Branding → Universal Login**, apply the colors, fonts, borders and logo from `universal-login-theme.json`. In the Auth0 Dashboard's tenant branding settings, use `branding-settings.json` for the logo, favicon, primary color and page background.

The logo assets remain available at their existing Pages.dev paths to avoid breaking the hosted login while the custom domain is being validated:

- Wordmark: `https://collab-docs-4tb.pages.dev/collab-docs-auth0.svg`
- Mark / favicon: `https://collab-docs-4tb.pages.dev/collab-docs-auth0-mark.svg`

Set the Universal Login text to:

- Title: `Sign in to Vixiny`
- Description: `Continue to your documents, workspace, and collaborators.`

If using the Branding Management API, first read the current branding settings and the **default** Universal Login theme. Merge changes into the existing settings; do not replace unrelated tenant configuration or create a separate theme that is not active.

## 3. Keep the existing identity infrastructure

The existing tenant domain is `dev-iy8rk4v6x2psslz4.us.auth0.com`. Auth0 does not let you rename the tenant's canonical domain. This is expected and does not prevent the product from being branded as Vixiny.

Keep these identifiers unchanged:

- Issuer: `https://dev-iy8rk4v6x2psslz4.us.auth0.com/`
- JWKS: `https://dev-iy8rk4v6x2psslz4.us.auth0.com/.well-known/jwks.json`
- API audience: `https://collab-docs-api`

The API audience and issuer are verified by the Cloudflare Worker. Renaming them would require a coordinated Auth0 API and Worker-secret migration, so the brand update does not change them.

## 4. Google social connection

If Google sign-in is enabled, replace Auth0's shared development credentials with a Google OAuth client that you control. The Google OAuth redirect URI remains:

`https://dev-iy8rk4v6x2psslz4.us.auth0.com/login/callback`

Keep the Google Client Secret only in Auth0's social connection settings. Never add it to frontend variables or source control. Publish/configure the Google consent screen for the intended audience, or disable the connection if it is not needed.

## 5. Optional custom Auth0 domain

The Auth0 tenant's canonical domain cannot be renamed. A separate Auth0 custom domain can hide the tenant subdomain in the browser, but it requires a domain you own, DNS verification, and a corresponding Auth0 tenant configuration. Do not invent or add one until the custom domain is active.

## Files

- `universal-login-theme.json` — Vixiny styling for the active default Universal Login theme.
- `branding-settings.json` — Vixiny logo, favicon and colors.
- `../frontend/public/collab-docs-auth0.svg` — existing wordmark path, now displaying Vixiny.
- `../frontend/public/collab-docs-auth0-mark.svg` — existing favicon path, now branded Vixiny.
