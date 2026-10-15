import { createAuth0Client } from "@auth0/auth0-spa-js";

type AuthClient = Awaited<ReturnType<typeof createAuth0Client>>;

const CACHE_PREFIX = "@@auth0spajs@@";
let clientPromise: Promise<AuthClient> | null = null;

/**
 * Persist Auth0 tokens across browser restarts.
 * sessionStorage cleared on tab close — that forced re-login every time.
 * localStorage + refresh tokens keep the session until the user signs out
 * or the refresh token is revoked / expires.
 */
function migrateSessionCacheToLocal(): void {
  if (typeof window === "undefined") return;
  try {
    for (const key of Object.keys(window.sessionStorage)) {
      if (!key.startsWith(CACHE_PREFIX)) continue;
      if (!window.localStorage.getItem(key)) {
        const value = window.sessionStorage.getItem(key);
        if (value) window.localStorage.setItem(key, value);
      }
      window.sessionStorage.removeItem(key);
    }
  } catch {
    // private mode / blocked storage — SDK will fall back to memory
  }
}

function clearSdkCache(): void {
  if (typeof window === "undefined") return;
  for (const store of [window.localStorage, window.sessionStorage]) {
    try {
      for (const key of Object.keys(store)) {
        if (key.startsWith(CACHE_PREFIX)) store.removeItem(key);
      }
    } catch {
      /* ignore */
    }
  }
}

function configured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_OIDC_AUTHORIZATION_URL &&
      process.env.NEXT_PUBLIC_OIDC_CLIENT_ID
  );
}

async function getAuthClient(): Promise<AuthClient> {
  if (typeof window === "undefined") {
    throw new Error("Sign-in is only available in the browser.");
  }
  if (!configured()) {
    throw new Error("OIDC sign-in is not configured. Set the public authorization URL and client ID.");
  }
  if (clientPromise) return clientPromise;

  migrateSessionCacheToLocal();

  const authorizationUrl = new URL(process.env.NEXT_PUBLIC_OIDC_AUTHORIZATION_URL!);
  if (authorizationUrl.protocol !== "https:" && authorizationUrl.hostname !== "localhost") {
    throw new Error("The identity provider must use HTTPS.");
  }
  const clientId = process.env.NEXT_PUBLIC_OIDC_CLIENT_ID!;
  const redirectUri = process.env.NEXT_PUBLIC_OIDC_REDIRECT_URI || window.location.origin + "/";
  const audience = process.env.NEXT_PUBLIC_OIDC_AUDIENCE;
  // offline_access is required for refresh tokens so getTokenSilently works after reopen
  const configuredScopes = process.env.NEXT_PUBLIC_OIDC_SCOPES || "openid profile email offline_access";
  const scope = configuredScopes.includes("offline_access")
    ? configuredScopes
    : configuredScopes + " offline_access";

  clientPromise = createAuth0Client({
    domain: authorizationUrl.host,
    clientId,
    authorizationParams: {
      redirect_uri: redirectUri,
      scope,
      ...(audience ? { audience } : {}),
    },
    useRefreshTokens: true,
    useRefreshTokensFallback: true,
    cacheLocation: "localstorage",
  });

  try {
    return await clientPromise;
  } catch (error) {
    clientPromise = null;
    throw error;
  }
}

function errorCode(error: unknown, providerDescription = ""): string {
  const details = (error && typeof error === "object" ? error : {}) as {
    error?: unknown;
    code?: unknown;
    name?: unknown;
    message?: unknown;
    error_description?: unknown;
  };
  const description = [
    providerDescription,
    typeof details.error_description === "string" ? details.error_description : "",
    typeof details.message === "string" ? details.message : "",
  ]
    .join(" ")
    .toLowerCase();

  if (/redirect_uri|redirect uri|callback url/.test(description)) return "redirect_uri_mismatch";
  if (/offline_access|allow offline access|refresh token.{0,30}(disabled|not enabled)/.test(description)) {
    return "offline_access_not_enabled";
  }
  if (/(origin|cross-origin).{0,50}(not allowed|denied)|not allowed.{0,30}origin/.test(description)) {
    return "origin_not_allowed";
  }
  if (/code_verifier|code verifier|pkce/.test(description)) return "pkce_error";
  if (
    /(grant_type|grant type).{0,50}(not allowed|not enabled|unsupported)|(?:not allowed|not enabled|unsupported).{0,50}(grant_type|grant type)/.test(
      description
    )
  ) {
    return "grant_type_not_allowed";
  }
  if (/scope.{0,50}(invalid|not allowed|unsupported)|(?:invalid|not allowed|unsupported).{0,50}scope/.test(description)) {
    return "invalid_scope";
  }
  if (/(client_id|client id).{0,50}(missing|invalid|unknown)|(?:missing|invalid|unknown).{0,50}(client_id|client id)/.test(description)) {
    return "client_configuration_error";
  }
  if (/audience.{0,50}(invalid|not allowed|unknown)|(?:invalid|not allowed|unknown).{0,50}audience/.test(description)) {
    return "audience_configuration_error";
  }
  if (/missing required parameter|parameter.{0,30}is required/.test(description)) return "missing_parameter";

  const explicit = details.error || details.code;
  if (typeof explicit === "string" && explicit) return explicit;
  if (description.includes("state")) return "invalid_state";
  if (description.includes("transaction")) return "missing_transaction";
  if (description.includes("callback")) return "callback_error";
  if (description.includes("network") || description.includes("fetch")) return "network_error";
  return typeof details.name === "string" && details.name !== "Error" ? details.name : "auth0_error";
}

function safeCode(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 64) || "auth0_error";
}

function cleanCallbackUrl(url: URL): void {
  for (const key of ["code", "state", "session_state", "iss", "error", "error_description"]) {
    url.searchParams.delete(key);
  }
  window.history.replaceState({}, "", url.pathname + (url.search ? url.search : "") + url.hash);
}

export async function getAccessToken(): Promise<string | null> {
  if (typeof window === "undefined" || !configured()) return null;
  try {
    const client = await getAuthClient();
    // Prefer refresh-token path; cache in localStorage survives tab/browser close
    return (await client.getTokenSilently({ cacheMode: "on" })) || null;
  } catch (error) {
    const code = errorCode(error);
    if (
      [
        "login_required",
        "missing_refresh_token",
        "invalid_grant",
        "consent_required",
        "interaction_required",
      ].includes(code)
    ) {
      return null;
    }
    throw new Error("Could not refresh your sign-in session. Check your connection or sign in again.");
  }
}

export async function startOidcLogin(): Promise<void> {
  const client = await getAuthClient();
  const returnTo = window.location.pathname + window.location.search + window.location.hash;
  await client.loginWithRedirect({ appState: { returnTo } });
}

export async function completeOidcLogin(url: URL): Promise<boolean> {
  const hasCallback =
    url.searchParams.has("code") || url.searchParams.has("state") || url.searchParams.has("error");
  if (!hasCallback) return false;

  try {
    const client = await getAuthClient();
    const result = await client.handleRedirectCallback(url.toString());
    const state = result.appState as { returnTo?: unknown } | undefined;
    const returnTo =
      typeof state?.returnTo === "string" &&
      state.returnTo.startsWith("/") &&
      !state.returnTo.startsWith("//")
        ? new URL(state.returnTo, window.location.origin)
        : null;

    if (returnTo && returnTo.origin === window.location.origin) {
      window.history.replaceState({}, "", returnTo.pathname + returnTo.search + returnTo.hash);
    } else {
      cleanCallbackUrl(url);
    }
    return true;
  } catch (error) {
    const providerDescription = url.searchParams.get("error_description") || "";
    const redirectError = url.searchParams.get("error");
    const code = safeCode(errorCode(error, providerDescription));
    console.warn("Auth0 callback processing failed", { code });
    cleanCallbackUrl(url);
    if (code === "invalid_state" || code === "missing_transaction") {
      throw new Error(
        "Auth0 sign-in state expired or could not be verified (" +
          code +
          "). Start sign-in again from the Collab Docs homepage."
      );
    }
    if (code === "invalid_grant" || code === "missing_code_verifier") {
      throw new Error(
        "Auth0 could not exchange the sign-in code (" + code + "). Check the allowed callback URL and retry sign-in."
      );
    }
    if (code === "redirect_uri_mismatch") {
      throw new Error(
        "Auth0 rejected the callback URL (redirect_uri_mismatch). The redirect URI in the application must exactly match https://collab-docs-4tb.pages.dev/."
      );
    }
    if (
      code === "offline_access_not_enabled" ||
      code === "grant_type_not_allowed" ||
      code === "client_configuration_error" ||
      code === "audience_configuration_error" ||
      code === "origin_not_allowed" ||
      code === "pkce_error" ||
      code === "missing_parameter"
    ) {
      throw new Error(
        "Auth0 sign-in configuration error (" +
          code +
          "). Check SPA settings: Refresh Token grant, Allow Offline Access on the API, Allowed Web Origins."
      );
    }
    if (code === "access_denied" || code === "unauthorized_client" || code === "invalid_scope") {
      throw new Error(
        "Auth0 rejected the sign-in request (" +
          code +
          "). Check Authorization Code + Refresh Token grants, scopes, and API offline access."
      );
    }
    if (code === "invalid_request" && redirectError === "invalid_request") {
      throw new Error(
        "Auth0 rejected the authorization request before issuing a sign-in code (invalid_request). Check Auth0 Dashboard → Monitoring → Logs."
      );
    }
    if (code === "invalid_request") {
      throw new Error(
        "Auth0 rejected the code exchange or callback processing (invalid_request). Verify Authorization Code + PKCE; SPA token endpoint auth method must be None."
      );
    }
    throw new Error(
      "Auth0 sign-in callback failed (" +
        code +
        "). Check Auth0 Dashboard → Monitoring → Logs for the failed event description."
    );
  }
}

export async function clearAccessToken(): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    const client = await getAuthClient();
    await client.logout({
      logoutParams: { returnTo: window.location.origin + "/" },
    });
  } catch {
    clearSdkCache();
    window.location.assign("/");
  }
}
