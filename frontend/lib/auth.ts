import { createAuth0Client } from "@auth0/auth0-spa-js";

type AuthClient = Awaited<ReturnType<typeof createAuth0Client>>;

const CACHE_PREFIX = "@@auth0spajs@@";
let clientPromise: Promise<AuthClient> | null = null;

// Keep the SDK cache scoped to this browser tab. The SDK manages token expiry and
// refresh-token rotation; tokens are never copied into application-owned keys.
const sessionStorageCache = {
  get(key: string) {
    if (typeof window === "undefined") return undefined;
    const value = window.sessionStorage.getItem(key);
    if (!value) return undefined;
    try {
      return JSON.parse(value);
    } catch {
      window.sessionStorage.removeItem(key);
      return undefined;
    }
  },
  set(key: string, value: unknown) {
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(key, JSON.stringify(value));
    }
  },
  remove(key: string) {
    if (typeof window !== "undefined") window.sessionStorage.removeItem(key);
  },
  allKeys() {
    return typeof window === "undefined" ? [] : Object.keys(window.sessionStorage);
  },
};

function clearSdkCache(): void {
  if (typeof window === "undefined") return;
  for (const key of Object.keys(window.sessionStorage)) {
    if (key.startsWith(CACHE_PREFIX)) window.sessionStorage.removeItem(key);
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

  const authorizationUrl = new URL(process.env.NEXT_PUBLIC_OIDC_AUTHORIZATION_URL!);
  if (authorizationUrl.protocol !== "https:" && authorizationUrl.hostname !== "localhost") {
    throw new Error("The identity provider must use HTTPS.");
  }
  const clientId = process.env.NEXT_PUBLIC_OIDC_CLIENT_ID!;
  const redirectUri = process.env.NEXT_PUBLIC_OIDC_REDIRECT_URI || window.location.origin + "/";
  const audience = process.env.NEXT_PUBLIC_OIDC_AUDIENCE;
  const scope = process.env.NEXT_PUBLIC_OIDC_SCOPES || "openid profile email";

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
    cache: sessionStorageCache,
  });

  try {
    return await clientPromise;
  } catch (error) {
    clientPromise = null;
    throw error;
  }
}

function errorCode(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  const details = error as { error?: unknown; code?: unknown };
  return String(details.error || details.code || "");
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
    return (await client.getTokenSilently()) || null;
  } catch (error) {
    const code = errorCode(error);
    if (["login_required", "missing_refresh_token", "invalid_grant", "consent_required", "interaction_required"].includes(code)) {
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
  const hasCallback = url.searchParams.has("code") ||
    url.searchParams.has("state") ||
    url.searchParams.has("error");
  if (!hasCallback) return false;

  try {
    const client = await getAuthClient();
    const result = await client.handleRedirectCallback(url.toString());
    const state = result.appState as { returnTo?: unknown } | undefined;
    const returnTo = typeof state?.returnTo === "string" &&
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
  } catch {
    cleanCallbackUrl(url);
    throw new Error("Sign-in failed. Check the Auth0 callback settings and try again.");
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
    // If the identity provider is temporarily unavailable or not configured,
    // still end this tab's local session instead of leaving cached tokens behind.
    clearSdkCache();
    window.location.assign("/");
  }
}
