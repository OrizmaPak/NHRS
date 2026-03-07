const REFRESH_TOKEN_KEY = 'nhrs.auth.refreshToken';

let inMemoryAccessToken: string | null = null;

export type SessionTokens = {
  accessToken: string;
  refreshToken: string;
};

export function getAccessToken(): string | null {
  return inMemoryAccessToken;
}

export function getRefreshToken(): string | null {
  return sessionStorage.getItem(REFRESH_TOKEN_KEY);
}

export function hasRefreshToken(): boolean {
  return Boolean(getRefreshToken());
}

export function setSessionTokens(tokens: SessionTokens): void {
  inMemoryAccessToken = tokens.accessToken;
  sessionStorage.setItem(REFRESH_TOKEN_KEY, tokens.refreshToken);
}

export function setAccessToken(accessToken: string): void {
  inMemoryAccessToken = accessToken;
}

export function clearSessionTokens(): void {
  inMemoryAccessToken = null;
  sessionStorage.removeItem(REFRESH_TOKEN_KEY);
}
