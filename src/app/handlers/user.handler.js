import { UserLogActions } from "#constants/log.constants.js";
import { PublicityStatuses } from "#constants/product.constants.js";
import { MAX_ADDRESSES_PER_USER } from "#constants/user.constants.js";
import { AppError } from "#errors/app-error.js";
import { ErrorCodes } from "#errors/error-codes.js";
import { toPublicProduct } from "#handlers/product.handler.js";
import { findByIds as findProductsByIds, findBySku } from "#repositories/product.repository.js";
import {
  addFavourite as addFavouriteRepo,
  findById,
  removeFavourite as removeFavouriteRepo,
  save as saveUser,
  updateById,
  updatePasswordHash,
} from "#repositories/user.repository.js";
import { writeUserLog } from "#utils/log.util.js";
import { hashPassword, isPasswordMatch } from "#utils/password.util.js";
import { revokeOtherSessions } from "#utils/session.util.js";

/**
 * @typedef {{ ip?: string, userAgent?: string }} RequestContext
 * @typedef {{ id: string, name: string, email: string, role: string, createdAt: Date }} Profile
 */

/**
 * Loads the authenticated user or throws (the account may have been deleted since the token was issued).
 * @param {string} userId - The user's id.
 * @param {Object} [options]
 * @param {boolean} [options.withPassword=false] - Include passwordHash.
 * @returns {Promise<import("mongoose").Document>} The user.
 * @throws {AppError} UNAUTHORIZED
 */
const getUserOrThrow = async (userId, { withPassword = false } = {}) => {
  const user = await findById(userId, { withPassword });

  if (!user) {
    throw new AppError("Your session has expired. Please log in again.", { code: ErrorCodes.UNAUTHORIZED });
  }
  return user;
};

/**
 * Picks the profile fields returned by /me.
 * @param {import("mongoose").Document} user - The user document.
 * @returns {Profile} The profile.
 */
const toProfile = (user) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  role: user.role,
  createdAt: user.createdAt,
});

/**
 * Makes one address the default and clears the flag on every other.
 * @param {import("mongoose").Document} user - The user document (modified in place).
 * @param {string} addressId - The address to make default.
 * @returns {void}
 */
const setDefaultAddress = (user, addressId) => {
  user.addresses.forEach((address) => {
    address.isDefault = address.id === addressId;
  });
};

/**
 * Finds one of the user's addresses or throws.
 * @param {import("mongoose").Document} user - The user document.
 * @param {string} addressId - The address id.
 * @returns {import("mongoose").Document} The address subdocument.
 * @throws {AppError} ADDRESS_NOT_FOUND
 */
const getAddressOrThrow = (user, addressId) => {
  const address = user.addresses.id(addressId);

  if (!address) {
    throw new AppError("Address not found.", { code: ErrorCodes.ADDRESS_NOT_FOUND });
  }
  return address;
};

/**
 * Throws if another of the user's addresses already has this label — labels identify saved
 * addresses, so they're unique per user, ignoring case and surrounding spaces.
 * @param {import("mongoose").Document} user - The user document.
 * @param {string} label - The label to check.
 * @param {string} [exceptAddressId] - The address being edited, which may keep its own label.
 * @returns {void}
 * @throws {AppError} ADDRESS_LABEL_TAKEN
 */
const assertAddressLabelAvailable = (user, label, exceptAddressId) => {
  const normalizedLabel = label.trim().toLowerCase();
  const isTaken = user.addresses.some(
    (address) => address.id !== exceptAddressId && address.label?.trim().toLowerCase() === normalizedLabel,
  );

  if (isTaken) {
    throw new AppError(`You already have an address labelled "${label.trim()}".`, {
      code: ErrorCodes.ADDRESS_LABEL_TAKEN,
      details: { label: label.trim() },
    });
  }
};

/**
 * Gets the authenticated user's profile.
 * @param {string} userId - The user's id.
 * @returns {Promise<Profile>} The profile.
 * @throws {AppError} UNAUTHORIZED
 */
export const getProfile = async (userId) => toProfile(await getUserOrThrow(userId));

/**
 * Updates the authenticated user's name.
 * @param {Object} options
 * @param {string} options.userId - The user's id.
 * @param {string} options.name - New display name.
 * @param {RequestContext} options.context - Request context for the user log.
 * @returns {Promise<Profile>} The updated profile.
 * @throws {AppError} UNAUTHORIZED
 */
export const updateProfile = async ({ userId, name, context }) => {
  const user = await updateById({ userId, set: { name } });

  if (!user) {
    throw new AppError("Your session has expired. Please log in again.", { code: ErrorCodes.UNAUTHORIZED });
  }

  await writeUserLog({ userId, action: UserLogActions.PROFILE_UPDATED, context, meta: { fields: ["name"] } });
  return toProfile(user);
};

/**
 * Changes the password after checking the current one, then logs out every other device.
 * @param {Object} options
 * @param {string} options.userId - The user's id.
 * @param {string} options.currentPassword - Current plain-text password.
 * @param {string} options.newPassword - New plain-text password.
 * @param {string | undefined} options.refreshToken - This device's session, which stays logged in.
 * @param {RequestContext} options.context - Request context for the user log.
 * @returns {Promise<void>}
 * @throws {AppError} UNAUTHORIZED | INVALID_CURRENT_PASSWORD
 */
export const changePassword = async ({ userId, currentPassword, newPassword, refreshToken, context }) => {
  const user = await getUserOrThrow(userId, { withPassword: true });

  if (!(await isPasswordMatch(currentPassword, user.passwordHash))) {
    throw new AppError("Your current password is incorrect.", { code: ErrorCodes.INVALID_CURRENT_PASSWORD });
  }

  await updatePasswordHash(userId, await hashPassword(newPassword));
  await revokeOtherSessions({ userId, keepRefreshToken: refreshToken });
  await writeUserLog({ userId, action: UserLogActions.PASSWORD_CHANGED, context });
};

/**
 * Lists the user's saved addresses.
 * @param {string} userId - The user's id.
 * @returns {Promise<Object[]>} The addresses.
 * @throws {AppError} UNAUTHORIZED
 */
export const listAddresses = async (userId) => (await getUserOrThrow(userId)).addresses;

/**
 * Saves a new address. The first address, or one sent with `isDefault: true`, becomes the default.
 * @param {Object} options
 * @param {string} options.userId - The user's id.
 * @param {Object} options.fields - Validated address fields.
 * @returns {Promise<Object[]>} All addresses after the change.
 * @throws {AppError} UNAUTHORIZED | ADDRESS_LIMIT_REACHED | ADDRESS_LABEL_TAKEN
 */
export const addAddress = async ({ userId, fields }) => {
  const user = await getUserOrThrow(userId);

  assertAddressLabelAvailable(user, fields.label);

  if (user.addresses.length >= MAX_ADDRESSES_PER_USER) {
    throw new AppError(`You can save up to ${MAX_ADDRESSES_PER_USER} addresses.`, {
      code: ErrorCodes.ADDRESS_LIMIT_REACHED,
    });
  }

  const { isDefault, ...addressFields } = fields;
  const shouldBeDefault = Boolean(isDefault) || user.addresses.length === 0;

  user.addresses.push({ ...addressFields, isDefault: false });
  const newAddress = user.addresses.at(-1);

  if (shouldBeDefault) {
    setDefaultAddress(user, newAddress.id);
  }

  return (await saveUser(user)).addresses;
};

/**
 * Edits an address. `isDefault: true` makes it the default; `false` is ignored
 * (change the default by making another address default).
 * @param {Object} options
 * @param {string} options.userId - The user's id.
 * @param {string} options.addressId - The address id.
 * @param {Object} options.changes - Validated partial address fields.
 * @returns {Promise<Object[]>} All addresses after the change.
 * @throws {AppError} UNAUTHORIZED | ADDRESS_NOT_FOUND | ADDRESS_LABEL_TAKEN
 */
export const updateAddress = async ({ userId, addressId, changes }) => {
  const user = await getUserOrThrow(userId);
  const address = getAddressOrThrow(user, addressId);
  const { isDefault, ...addressChanges } = changes;

  if (addressChanges.label !== undefined) {
    assertAddressLabelAvailable(user, addressChanges.label, addressId);
  }

  address.set(addressChanges);

  if (isDefault) {
    setDefaultAddress(user, addressId);
  }

  return (await saveUser(user)).addresses;
};

/**
 * Deletes an address. If it was the default, the next remaining address becomes default.
 * @param {Object} options
 * @param {string} options.userId - The user's id.
 * @param {string} options.addressId - The address id.
 * @returns {Promise<Object[]>} All addresses after the change.
 * @throws {AppError} UNAUTHORIZED | ADDRESS_NOT_FOUND
 */
export const deleteAddress = async ({ userId, addressId }) => {
  const user = await getUserOrThrow(userId);
  const address = getAddressOrThrow(user, addressId);
  const wasDefault = address.isDefault;

  user.addresses.pull(addressId);

  if (wasDefault && user.addresses.length) {
    setDefaultAddress(user, user.addresses[0].id);
  }

  return (await saveUser(user)).addresses;
};

/**
 * Lists the user's favourite products that are still public.
 * @param {string} userId - The user's id.
 * @returns {Promise<Object[]>} Public products.
 * @throws {AppError} UNAUTHORIZED
 */
export const listFavourites = async (userId) => {
  const user = await getUserOrThrow(userId);
  const products = await findProductsByIds({
    productIds: user.favourites,
    publicityStatus: PublicityStatuses.PUBLIC,
  });
  return products.map(toPublicProduct);
};

/**
 * Adds a public product to the user's favourites. Adding one twice is a no-op.
 * @param {Object} options
 * @param {string} options.userId - The user's id.
 * @param {string} options.sku - The product's SKU.
 * @returns {Promise<void>}
 * @throws {AppError} PRODUCT_NOT_FOUND
 */
export const addFavourite = async ({ userId, sku }) => {
  const product = await findBySku(sku);

  if (!product || product.publicityStatus !== PublicityStatuses.PUBLIC) {
    throw new AppError("Product not found.", { code: ErrorCodes.PRODUCT_NOT_FOUND });
  }

  await addFavouriteRepo({ userId, productId: product.id });
};

/**
 * Removes a product from the user's favourites. Succeeds even if it wasn't one.
 * @param {Object} options
 * @param {string} options.userId - The user's id.
 * @param {string} options.sku - The product's SKU.
 * @returns {Promise<void>}
 */
export const removeFavourite = async ({ userId, sku }) => {
  const product = await findBySku(sku);

  if (product) {
    await removeFavouriteRepo({ userId, productId: product.id });
  }
};
