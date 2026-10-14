const TOKEN_KEY = "collab-docs-access-token";
const EXPIRY_KEY = "collab-docs-access-expiry";
const STATE_KEY = "collab-docs-oauth-state";
const VERIFIER_KEY = "collab-docs-pkce-verifier";

function encodeUrlSafe(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function randomValue(size = 32): string {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return encodeUrlSafe(bytes);
}

export function getAccessToken(): string | null {
  if (typeof window === "undefined") return null;
  const token = sessionStorage.getItem(TOKEN_KEY);
  const expiresAt = Number(sessionStorage.getItem(EXPIRY_KEY) || 0);
  if (!token || (expiresAt > 0 && Date.now() >= expiresAt - 15_000)) {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(EXPIRY_KEY);
    return null;
  }
  return token;
}

export function clearAccessToken(): void {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(EXPIRY_KEY);
}

export async function startOidcLogin(): Promise<void> {
  const authorizeUrl = process.env.NEXT_PUBLIC_OIDC_AUTHORIZATION_URL;
  const clientId = process.env.NEXT_PUBLIC_OIDC_CLIENT_ID;
  const redirectUri = process.env.NEXT_PUBLIC_OIDC_REDIRECT_URI || window.location.origin + "/";
  if (!authorizeUrl || !clientId) {
    throw new Error("OIDC sign-in is not configured. Set the public authorization URL and client ID.");
  }

  const verifier = randomValue(48);
  const state = randomValue(32);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const challenge = encodeUrlSafe(new Uint8Array(digest));
  const url = new URL(authorizeUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", process.env.NEXT_PUBLIC_OIDC_SCOPES || "openid profile email");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  const audience = process.env.NEXT_PUBLIC_OIDC_AUDIENCE;
  if (audience) url.searchParams.set("audience", audience);

  sessionStorage.setItem(STATE_KEY, state);
  sessionStorage.setItem(VERIFIER_KEY, verifier);
  window.location.assign(url.toString());
}

export async function completeOidcLogin(url: URL): Promise<boolean> {
  const code = url.searchParams.get("code");
  const returnedState = url.searchParams.get("state");
  if (!code && !returnedState && !url.searchParams.get("error")) return false;
  if (url.searchParams.get("error")) {
    throw new Error("Sign-in was cancelled or rejected by the identity provider.");
  }

  const expectedState = sessionStorage.getItem(STATE_KEY);
  const verifier = sessionStorage.getItem(VERIFIER_KEY);
  if (!code || !returnedState || !expectedState || returnedState !== expectedState || !verifier) {
    throw new Error("Sign-in state could not be verified. Please try again.");
  }

  const tokenUrl = process.env.NEXT_PUBLIC_OIDC_TOKEN_URL;
  const clientId = process.env.NEXT_PUBLIC_OIDC_CLIENT_ID;
  const redirectUri = process.env.NEXT_PUBLIC_OIDC_REDIRECT_URI || window.location.origin + "/";
  if (!tokenUrl || !clientId) throw new Error("OIDC token endpoint is not configured.");

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    }),
  });
  const result = await response.json().catch(() => ({})) as {
    access_token?: string;
    token_type?: string;
    expires_in?: number;
    error_description?: string;
  };
  if (!response.ok || !result.access_token || (result.token_type && result.token_type.toLowerCase() !== "bearer")) {
    throw new Error(result.error_description || "The identity provider did not return a usable access token.");
  }

  sessionStorage.setItem(TOKEN_KEY, result.access_token);
  sessionStorage.setItem(EXPIRY_KEY, String(Date.now() + Math.max(60, result.expires_in || 300) * 1000));
  sessionStorage.removeItem(STATE_KEY);
  sessionStorage.removeItem(VERIFIER_KEY);
  url.searchParams.delete("code");
  url.searchParams.delete("state");
  url.searchParams.delete("session_state");
  url.searchParams.delete("iss");
  url.searchParams.delete("error");
  url.searchParams.delete("error_description");
  window.history.replaceState({}, "", url.pathname + (url.search ? url.search : "") + url.hash);
  return true;
}
