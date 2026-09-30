import { env } from "#configs/env.config.js";
import { REFRESH_COOKIE_NAME, REFRESH_COOKIE_PATH } from "#constants/auth.constants.js";
import {
  completePasswordReset as completePasswordResetHandler,
  login as loginHandler,
  logout as logoutHandler,
  refresh as refreshHandler,
  requestPasswordReset as requestPasswordResetHandler,
  signup as signupHandler,
  verifyPasswordResetCode as verifyPasswordResetCodeHandler,
} from "#handlers/auth.handler.js";
import { changePassword as changePasswordHandler } from "#handlers/user.handler.js";
import { getRequestContext } from "#utils/request.util.js";

/**
 * Refresh-cookie attributes. Scoped to the auth routes so it's sent nowhere else.
 *
 * `sameSite: "strict"` only works because the browser sees the API on the frontend's own domain:
 * the frontend proxies /api/* to this API — Vite's dev-server proxy locally, vercel.json on Vercel
 * (see the frontend's CLAUDE.md → "API base URL & proxy"). If the frontend ever calls this API's domain directly, this
 * cookie becomes cross-site, is never sent back, and users are logged out on every reload. Keep the
 * proxy rather than loosening this to "none" (which browsers increasingly block for third parties).
 * @type {import("express").CookieOptions}
 */
const refreshCookieOptions = {
  httpOnly: true,
  secure: env.isProduction,
  sameSite: "strict",
  path: REFRESH_COOKIE_PATH,
};

/**
 * Sets the refresh-token cookie for the session's lifetime.
 * @param {import("express").Response} res - Express response.
 * @param {string} refreshToken - The session's refresh token.
 * @returns {void}
 */
const setRefreshCookie = (res, refreshToken) => {
  res.cookie(REFRESH_COOKIE_NAME, refreshToken, {
    ...refreshCookieOptions,
    maxAge: env.refreshTokenTtlSeconds * 1000,
  });
};

/**
 * Clears the refresh-token cookie.
 * @param {import("express").Response} res - Express response.
 * @returns {void}
 */
const clearRefreshCookie = (res) => {
  res.clearCookie(REFRESH_COOKIE_NAME, refreshCookieOptions);
};

/**
 * POST /auth/signup — creates a customer account and logs it in.
 * @param {import("express").Request} req - Express request.
 * @param {import("express").Response} res - Express response.
 * @returns {Promise<import("express").Response>} 201 with the access token and user.
 */
export const signup = async (req, res) => {
  const { refreshToken, accessToken, user } = await signupHandler({
    ...req.validated.body,
    context: getRequestContext(req),
  });
  setRefreshCookie(res, refreshToken);
  return res.status(201).json({ data: { accessToken, user } });
};

/**
 * POST /auth/login — checks credentials and starts a session.
 * @param {import("express").Request} req - Express request.
 * @param {import("express").Response} res - Express response.
 * @returns {Promise<import("express").Response>} 200 with the access token and user.
 */
export const login = async (req, res) => {
  const { refreshToken, accessToken, user } = await loginHandler({
    ...req.validated.body,
    context: getRequestContext(req),
  });
  setRefreshCookie(res, refreshToken);
  return res.status(200).json({ data: { accessToken, user } });
};

/**
 * POST /auth/refresh — issues a new access token from the refresh cookie.
 * @param {import("express").Request} req - Express request.
 * @param {import("express").Response} res - Express response.
 * @returns {Promise<import("express").Response>} 200 with the access token and user.
 */
export const refresh = async (req, res) => {
  try {
    const { accessToken, user } = await refreshHandler(req.cookies[REFRESH_COOKIE_NAME]);
    return res.status(200).json({ data: { accessToken, user } });
  } catch (error) {
    // A dead cookie is removed so the browser stops sending it; the error still propagates.
    clearRefreshCookie(res);
    throw error;
  }
};

/**
 * POST /auth/logout — deletes the session and clears the cookie.
 * @param {import("express").Request} req - Express request.
 * @param {import("express").Response} res - Express response.
 * @returns {Promise<import("express").Response>} 204.
 */
export const logout = async (req, res) => {
  await logoutHandler({ refreshToken: req.cookies[REFRESH_COOKIE_NAME], context: getRequestContext(req) });
  clearRefreshCookie(res);
  return res.status(204).end();
};

/**
 * PATCH /auth/password — changes the logged-in user's password and logs out their
 * other devices. Lives under /auth because only there does the browser send the
 * refresh cookie, which identifies the session to keep.
 * @param {import("express").Request} req - Express request.
 * @param {import("express").Response} res - Express response.
 * @returns {Promise<import("express").Response>} 204.
 */
export const changePassword = async (req, res) => {
  await changePasswordHandler({
    userId: req.user.id,
    ...req.validated.body,
    refreshToken: req.cookies[REFRESH_COOKIE_NAME],
    context: getRequestContext(req),
  });
  return res.status(204).end();
};

/**
 * POST /auth/password-reset/request — emails a reset code if the account exists.
 * @param {import("express").Request} req - Express request.
 * @param {import("express").Response} res - Express response.
 * @returns {Promise<import("express").Response>} 204 whether or not the email is registered.
 */
export const requestPasswordReset = async (req, res) => {
  await requestPasswordResetHandler({ ...req.validated.body, context: getRequestContext(req) });
  return res.status(204).end();
};

/**
 * POST /auth/password-reset/verify — exchanges a valid code for a reset token.
 * @param {import("express").Request} req - Express request.
 * @param {import("express").Response} res - Express response.
 * @returns {Promise<import("express").Response>} 200 with the reset token.
 */
export const verifyPasswordResetCode = async (req, res) => {
  const { resetToken } = await verifyPasswordResetCodeHandler(req.validated.body);
  return res.status(200).json({ data: { resetToken } });
};

/**
 * POST /auth/password-reset/complete — sets the new password and revokes all sessions.
 * @param {import("express").Request} req - Express request.
 * @param {import("express").Response} res - Express response.
 * @returns {Promise<import("express").Response>} 204.
 */
export const completePasswordReset = async (req, res) => {
  await completePasswordResetHandler({ ...req.validated.body, context: getRequestContext(req) });
  return res.status(204).end();
};
