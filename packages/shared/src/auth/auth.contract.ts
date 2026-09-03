/**
 * HTTP contract of authentication. Shared so the client cannot invent a field the server
 * does not read, and the server cannot rename one without breaking the client's build.
 */
export const AUTH_ROUTES = {
  register: "/auth/register",
  login: "/auth/login",
  refresh: "/auth/refresh",
  logout: "/auth/logout",
  me: "/auth/me",
  sessions: "/auth/sessions",
} as const;

/** Name of the httpOnly cookie carrying the refresh token. */
export const REFRESH_COOKIE = "voreli_refresh";

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 32;
/**
 * Length only, no composition rules: rules about digits and symbols add friction without
 * adding strength (docs/specs/002-data-model-and-auth.md).
 */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 256;
export const DISPLAY_NAME_MAX_LENGTH = 64;

/** Lowercase letters, digits, dot, underscore and dash. Case is not significant. */
export const USERNAME_PATTERN = /^[a-z0-9._-]+$/;

/** Everything about a user that is safe to hand to any client. Never carries the hash. */
export interface PublicUser {
  readonly id: string;
  readonly username: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
  readonly createdAt: string;
}

export interface RegisterRequest {
  readonly inviteCode: string;
  readonly username: string;
  readonly password: string;
  readonly displayName?: string;
}

export interface LoginRequest {
  readonly username: string;
  readonly password: string;
}

/**
 * The access token is returned in the body on purpose: it belongs in memory, not in
 * localStorage, where any XSS would read it. The refresh token never appears here — it
 * travels as an httpOnly cookie the page's JavaScript cannot touch.
 */
export interface AuthenticatedResponse {
  readonly user: PublicUser;
  readonly accessToken: string;
  /** Seconds until the access token expires. */
  readonly expiresIn: number;
}

export interface RefreshedResponse {
  readonly accessToken: string;
  readonly expiresIn: number;
}

export interface SessionSummary {
  readonly id: string;
  readonly userAgent: string | null;
  readonly ip: string | null;
  readonly createdAt: string;
  readonly expiresAt: string;
  /** True for the session the current request is authenticated with. */
  readonly current: boolean;
}

export interface SessionListResponse {
  readonly sessions: readonly SessionSummary[];
}

/** Claims the server puts in the access token. */
export interface AccessTokenClaims {
  /** User id. */
  readonly sub: string;
  /** Session the token was minted from, so revoking a session kills its tokens. */
  readonly sid: string;
}
