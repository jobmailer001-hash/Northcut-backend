import { env } from "#configs/env.config.js";
import { logger } from "#configs/logger.config.js";

/**
 * Sends an email. Development provider: writes the email to the log instead of
 * delivering it. Swap the body for the real provider's SDK call once one is chosen
 * (plan.md §9) — callers depend only on this signature.
 * @param {Object} options
 * @param {string} options.to - Recipient address.
 * @param {string} options.subject - Subject line.
 * @param {string} options.text - Plain-text body.
 * @returns {Promise<void>}
 * @throws {Error} In production, where logging email bodies would leak reset codes.
 */
export const sendEmail = async ({ to, subject, text }) => {
  if (env.isProduction) {
    throw new Error("No email provider configured for production.");
  }

  logger.info(`[dev email] to=${to} subject="${subject}"\n${text}`);
};
