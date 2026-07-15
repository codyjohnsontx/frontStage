/**
 * Linear OAuth 2.0 helpers (https://developers.linear.app/docs/oauth).
 * `actor=app` attributes Frontstage mutations to the integration identity
 * rather than the installing administrator (brief §39).
 */

const AUTHORIZE_URL = "https://linear.app/oauth/authorize";
const TOKEN_URL = "https://api.linear.app/oauth/token";

export interface LinearOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function buildAuthorizeUrl(config: LinearOAuthConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: "read,write",
    actor: "app",
    state,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

export interface TokenResponse {
  accessToken: string;
  tokenType: string;
  expiresIn?: number;
  scope?: string;
}

export async function exchangeCodeForToken(
  config: LinearOAuthConfig,
  code: string,
): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: "authorization_code",
      code,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new Error(`Linear token exchange failed: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as {
    access_token: string;
    token_type: string;
    expires_in?: number;
    scope?: string;
  };
  const result: TokenResponse = {
    accessToken: json.access_token,
    tokenType: json.token_type,
  };
  if (json.expires_in !== undefined) result.expiresIn = json.expires_in;
  if (json.scope !== undefined) result.scope = json.scope;
  return result;
}
