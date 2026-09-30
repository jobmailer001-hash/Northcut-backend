import { EmailTemplates } from "#constants/email.constants.js";
import { UserLogActions } from "#constants/log.constants.js";
import { UserStatuses } from "#constants/user.constants.js";
import { AppError } from "#errors/app-error.js";
import { ErrorCodes } from "#errors/error-codes.js";
import { queueEmail } from "#handlers/email.handler.js";
import {
  create as createUserRepo,
  findByEmail,
  findById,
  updatePasswordHash,
} from "#repositories/user.repository.js";
import { writeUserLog } from "#utils/log.util.js";
import { isDuplicateKeyError } from "#utils/mongo.util.js";
import {
  DUMMY_PASSWORD_HASH,
  generateResetCode,
  hashPassword,
  hashResetCode,
  isPasswordMatch,
  isResetCodeMatch,
} from "#utils/password.util.js";
import {
  consumeResetToken,
  createSession,
  deleteResetCode,
  deleteSession,
  getResetCode,
  getSession,
  incrementResetCodeAttempts,
  revokeAllSessions,
  saveResetCode,
  saveResetToken,
} from "#utils/session.util.js";
import { generateRefreshToken, generateResetToken, signAccessToken } from "#utils/token.util.js";

/**
 * Wrong guesses allowed on a reset code before it is discarded.
 * @type {number}
 */
const MAX_RESET_CODE_ATTEMPTS = 5;

/**
 * @typedef {{ id: string, name: string, email: string, role: string }} AuthUser
 * @typedef {{ ip?: string, userAgent?: string }} RequestContext
 */

/**
 * Picks the fields the client needs about the logged-in user.
 * @param {import("mongoose").Document} user - The user document.
 * @returns {AuthUser} The user summary.
 */
const toAuthUser = (user) => ({ id: user.id, name: user.name, email: user.email, role: user.role });

/**
 * Creates a Redis session and an access token for a user.
 * @param {import("mongoose").Document} user - The user document.
 * @returns {Promise<{ refreshToken: string, accessToken: string, user: AuthUser }>} Session credentials.
 */
const startSession = async (user) => {
  const refreshToken = generateRefreshToken();
  await createSession({ refreshToken, userId: user.id, role: user.role, email: user.email });

  return {
    refreshToken,
    accessToken: signAccessToken({ userId: user.id, role: user.role }),
    user: toAuthUser(user),
  };
};

/**
 * Error for any reset-code failure; one message so responses don't reveal which check failed.
 * @returns {AppError} INVALID_RESET_CODE error.
 */
const invalidResetCodeError = () => {
  return new AppError("That code is invalid or has expired.", { code: ErrorCodes.INVALID_RESET_CODE });
};

/**
 * Registers a customer account and logs them in.
 * @param {Object} options
 * @param {string} options.name - Display name.
 * @param {string} options.email - Lowercased email.
 * @param {string} options.password - Plain-text password.
 * @param {RequestContext} options.context - Request context for the user log.
 * @returns {Promise<{ refreshToken: string, accessToken: string, user: AuthUser }>} Session credentials.
 * @throws {AppError} EMAIL_ALREADY_REGISTERED - if an account already uses the email.
 */
export const signup = async ({ name, email, password, context }) => {
  const passwordHash = await hashPassword(password);
  let user;

  try {
    user = await createUserRepo({ name, email, passwordHash });
  } catch (error) {
    if (isDuplicateKeyError(error, "email")) {
      throw new AppError("An account with this email already exists.", {
        code: ErrorCodes.EMAIL_ALREADY_REGISTERED,
      });
    }
    throw error;
  }

  await writeUserLog({ userId: user.id, action: UserLogActions.SIGNUP, context });
  return startSession(user);
};

/**
 * Checks credentials and starts a session.
 * @param {Object} options
 * @param {string} options.email - Lowercased email.
 * @param {string} options.password - Plain-text password.
 * @param {RequestContext} options.context - Request context for the user log.
 * @returns {Promise<{ refreshToken: string, accessToken: string, user: AuthUser }>} Session credentials.
 * @throws {AppError} INVALID_CREDENTIALS - if the email or password is wrong.
 * @throws {AppError} ACCOUNT_DISABLED - if the password is right but the account is disabled.
 */
export const login = async ({ email, password, context }) => {
  const user = await findByEmail({ email, withPassword: true });
  const isMatch = await isPasswordMatch(password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);

  if (!user || !isMatch) {
    if (user) {
      await writeUserLog({ userId: user.id, action: UserLogActions.LOGIN_FAILED, context });
    }
    throw new AppError("Incorrect email or password.", { code: ErrorCodes.INVALID_CREDENTIALS });
  }

  // Checked only after the password matches, so account status isn't revealed to anyone else.
  if (user.status === UserStatuses.DISABLED) {
    throw new AppError("This account has been disabled.", { code: ErrorCodes.ACCOUNT_DISABLED });
  }

  await writeUserLog({ userId: user.id, action: UserLogActions.LOGIN, context });
  return startSession(user);
};

/**
 * Issues a new access token from a refresh token. The refresh token is not rotated.
 * @param {string | undefined} refreshToken - The refresh token from the cookie.
 * @returns {Promise<{ accessToken: string, user: AuthUser }>} A fresh access token and user.
 * @throws {AppError} UNAUTHORIZED - if the session is missing/expired or the user is gone or disabled.
 */
export const refresh = async (refreshToken) => {
  const sessionExpiredError = new AppError("Your session has expired. Please log in again.", {
    code: ErrorCodes.UNAUTHORIZED,
  });

  if (!refreshToken) {
    throw sessionExpiredError;
  }

  const session = await getSession(refreshToken);

  if (!session) {
    throw sessionExpiredError;
  }

  // Role and status come from the database, not the session, so changes apply on next refresh.
  const user = await findById(session.userId);

  if (!user || user.status !== UserStatuses.ACTIVE) {
    await deleteSession(refreshToken);
    throw sessionExpiredError;
  }

  return { accessToken: signAccessToken({ userId: user.id, role: user.role }), user: toAuthUser(user) };
};

/**
 * Ends the session for a refresh token. Succeeds even if the session is already gone.
 * @param {Object} options
 * @param {string | undefined} options.refreshToken - The refresh token from the cookie.
 * @param {RequestContext} options.context - Request context for the user log.
 * @returns {Promise<void>}
 */
export const logout = async ({ refreshToken, context }) => {
  if (!refreshToken) {
    return;
  }

  const session = await deleteSession(refreshToken);

  if (session) {
    await writeUserLog({ userId: session.userId, action: UserLogActions.LOGOUT, context });
  }
};

/**
 * Emails a reset code if an active account uses the email. Behaves identically
 * either way so the endpoint can't be used to discover registered emails.
 * @param {Object} options
 * @param {string} options.email - Lowercased email.
 * @param {RequestContext} options.context - Request context for the user log.
 * @returns {Promise<void>}
 */
export const requestPasswordReset = async ({ email, context }) => {
  const user = await findByEmail({ email });

  if (!user || user.status !== UserStatuses.ACTIVE) {
    return;
  }

  const code = generateResetCode();
  await saveResetCode({ userId: user.id, codeHash: hashResetCode(code) });
  await queueEmail({
    template: EmailTemplates.PASSWORD_RESET_CODE,
    to: user.email,
    data: { name: user.name, code },
  });
  await writeUserLog({ userId: user.id, action: UserLogActions.PASSWORD_RESET_REQUESTED, context });
};

/**
 * Checks a reset code and exchanges it for a short-lived, single-use reset token.
 * The code is discarded after MAX_RESET_CODE_ATTEMPTS wrong guesses.
 * @param {Object} options
 * @param {string} options.email - Lowercased email.
 * @param {string} options.code - The 6-digit code from the email.
 * @returns {Promise<{ resetToken: string }>} The reset token.
 * @throws {AppError} INVALID_RESET_CODE - if the code is wrong, expired, or out of attempts.
 */
export const verifyPasswordResetCode = async ({ email, code }) => {
  const user = await findByEmail({ email });

  if (!user) {
    throw invalidResetCodeError();
  }

  const resetCode = await getResetCode(user.id);

  if (!resetCode) {
    throw invalidResetCodeError();
  }

  if (!isResetCodeMatch(code, resetCode.codeHash)) {
    const attempts = await incrementResetCodeAttempts(user.id);

    if (attempts >= MAX_RESET_CODE_ATTEMPTS) {
      await deleteResetCode(user.id);
    }
    throw invalidResetCodeError();
  }

  await deleteResetCode(user.id);

  const resetToken = generateResetToken();
  await saveResetToken({ resetToken, userId: user.id });
  return { resetToken };
};

/**
 * Sets a new password using a reset token, then logs the user out everywhere.
 * @param {Object} options
 * @param {string} options.resetToken - Token from verifyPasswordResetCode.
 * @param {string} options.password - The new plain-text password.
 * @param {RequestContext} options.context - Request context for the user log.
 * @returns {Promise<void>}
 * @throws {AppError} INVALID_RESET_TOKEN - if the token is invalid, expired or already used.
 */
export const completePasswordReset = async ({ resetToken, password, context }) => {
  const userId = await consumeResetToken(resetToken);

  if (!userId) {
    throw new AppError("This reset link has expired. Please start again.", {
      code: ErrorCodes.INVALID_RESET_TOKEN,
    });
  }

  const passwordHash = await hashPassword(password);
  const user = await updatePasswordHash(userId, passwordHash);

  if (!user) {
    throw new AppError("This reset link has expired. Please start again.", {
      code: ErrorCodes.INVALID_RESET_TOKEN,
    });
  }

  await revokeAllSessions(userId);
  await writeUserLog({ userId, action: UserLogActions.PASSWORD_RESET_COMPLETED, context });
};
