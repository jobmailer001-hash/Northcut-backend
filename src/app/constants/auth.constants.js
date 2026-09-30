/**
 * Name of the httpOnly cookie holding the refresh token.
 * @type {string}
 */
export const REFRESH_COOKIE_NAME = "refreshToken";

/**
 * Path the refresh cookie is scoped to — the browser only sends it to auth routes,
 * so any endpoint that needs the current session must live under /auth.
 * @type {string}
 */
export const REFRESH_COOKIE_PATH = "/api/v1/auth";
