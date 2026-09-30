import { createHash, randomInt, timingSafeEqual } from "node:crypto";

import bcrypt from "bcrypt";

/**
 * bcrypt cost factor for password hashes.
 * @type {number}
 */
const BCRYPT_SALT_ROUNDS = 12;

/**
 * Number of digits in a password-reset code.
 * @type {number}
 */
const RESET_CODE_LENGTH = 6;

/**
 * Hashes a plain-text password with bcrypt.
 * @param {string} password - Plain-text password.
 * @returns {Promise<string>} The bcrypt hash.
 */
export const hashPassword = async (password) => bcrypt.hash(password, BCRYPT_SALT_ROUNDS);

/**
 * Compares a plain-text password with a bcrypt hash.
 * @param {string} password - Plain-text password.
 * @param {string} passwordHash - Stored bcrypt hash.
 * @returns {Promise<boolean>} Whether they match.
 */
export const isPasswordMatch = async (password, passwordHash) => bcrypt.compare(password, passwordHash);

/**
 * Hash compared against when no user matches a login email, so a missing account
 * takes as long to reject as a wrong password and can't be detected by timing.
 * @type {string}
 */
export const DUMMY_PASSWORD_HASH = bcrypt.hashSync("northcut-timing-equalizer", BCRYPT_SALT_ROUNDS);

/**
 * Generates a numeric password-reset code, zero-padded to a fixed length.
 * @returns {string} e.g. "048213".
 */
export const generateResetCode = () => {
  return String(randomInt(0, 10 ** RESET_CODE_LENGTH)).padStart(RESET_CODE_LENGTH, "0");
};

/**
 * Hashes a reset code for storage in Redis (the code itself is never stored).
 * @param {string} code - The plain reset code.
 * @returns {string} Hex SHA-256 digest.
 */
export const hashResetCode = (code) => createHash("sha256").update(code).digest("hex");

/**
 * Compares a submitted reset code with the stored hash in constant time.
 * @param {string} code - The code the user entered.
 * @param {string} codeHash - The stored hash.
 * @returns {boolean} Whether they match.
 */
export const isResetCodeMatch = (code, codeHash) => {
  return timingSafeEqual(Buffer.from(hashResetCode(code), "hex"), Buffer.from(codeHash, "hex"));
};
