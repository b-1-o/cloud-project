# Collab Docs — Auth0 branding and production setup

These files prepare the branding assets and theme payload for the Auth0 tenant used by Collab Docs. **Committing them does not automatically change the hosted Auth0 login page**: Auth0 branding is configured in the Auth0 tenant separately.

## 1. Brand the hosted login page

After the Pages deployment finishes, verify these assets are publicly available:

- Wordmark: https://collab-docs-4tb.pages.dev/collab-docs-auth0.svg
- Favicon mark: https://collab-docs-4tb.pages.dev/collab-docs-auth0-mark.svg

In the Auth0 Dashboard, open **Branding → Universal Login** and edit the theme. Use `universal-login-theme.json` as the design reference:

- Background: `#0B0A10`
- Login panel: `#15141B`
- Primary button / accents: `#91475F`
- Inputs: `#1E1B25`, border `#3C3442`
- Main text: `#F9F6F8`; secondary text: `#C6C0CB`
- Rounded controls, 20 px panel corners, subtle panel shadow
- Logo position: centered; logo height: 56 px
- Social buttons: top, so Google appears before the email form

Use `branding-settings.json` for tenant-level logo, favicon, primary color, and page background. If you apply settings through the Management API rather than the Dashboard editor, merge them with the existing configuration; do not replace unrelated tenant settings.

For a fully custom theme API update, first read the **default** theme at `GET /api/v2/branding/themes/default`, then update that theme using the returned theme ID. Universal Login uses the default theme, so creating an unrelated additional theme will not change the live login page.

## 2. Remove the tenant name from the login copy

The default sentence can expose the internal tenant name, for example `Log in to dev-… to continue to Collab Docs`. In Auth0's Universal Login text customization for the login prompt, use product-facing copy such as:

- Title: `Sign in to Collab Docs`
- Description: `Continue to your workspace, documents, and teammates.`

Keep the sign-up, password-reset, and error messages consistent with the same product voice. This changes the text users see, not the tenant's underlying domain.

## 3. Mark the tenant as Production

In the Auth0 Dashboard, open **Settings → General → Environment Tag** and select **Production**, if the tenant/account plan allows it. This is an Auth0 tenant setting, not a Next.js `NODE_ENV` change.

The environment tag does **not** rename the tenant domain and does **not** clear a development-keys alert by itself. Auth0 does not allow a tenant's canonical name/domain to be renamed after creation.

## 4. Replace social development keys

The **Dev Keys** warning means a social connection is still using Auth0's shared test credentials. For Google sign-in:

1. Create/configure a Google OAuth 2.0 client for a Web application in Google Cloud.
2. Add this exact redirect URI to that Google OAuth client:
   `https://dev-iy8rk4v6x2psslz4.us.auth0.com/login/callback`
3. In Auth0, open **Authentication → Social → Google** and replace the shared development credentials with that Google client's Client ID and Client Secret.
4. Keep the Client Secret only in Auth0's connection settings; never add it to this repository or frontend environment variables.
5. Make sure the Google consent screen is published/configured for the people who should be able to sign in. Google may restrict an app left in testing mode to test users.

If Google sign-in is not needed, disable the Google connection instead of leaving it configured with shared development credentials.

## 5. Optional: use a product-owned authentication domain

The canonical tenant domain cannot be renamed. To remove `dev-…us.auth0.com` from the browser's address bar, configure an Auth0 custom domain on a domain you own and verify its DNS. Then change the Cloudflare Pages variable `NEXT_PUBLIC_OIDC_AUTHORIZATION_URL` to that HTTPS domain and update the Auth0 application's allowed callback, logout, and web-origin settings as required.

A custom domain is separate from the visual theme and from the Production environment tag. Do not enter a made-up domain: it must be owned and verified first.

## Files

- `universal-login-theme.json` — theme payload for the Auth0 default Universal Login theme.
- `branding-settings.json` — tenant-level logo, favicon, and color payload.
- `../frontend/public/collab-docs-auth0.svg` — horizontal wordmark for the login panel.
- `../frontend/public/collab-docs-auth0-mark.svg` — compact favicon mark.
