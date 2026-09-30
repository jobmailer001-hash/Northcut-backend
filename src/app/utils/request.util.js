/**
 * Extracts the request details recorded in user logs.
 * @param {import("express").Request} req - Express request.
 * @returns {{ ip: string | undefined, userAgent: string | undefined }} Request context.
 */
export const getRequestContext = (req) => ({
  ip: req.ip,
  userAgent: req.get("user-agent"),
});
