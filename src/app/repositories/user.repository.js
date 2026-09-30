import { User } from "#models/user.model.js";

/**
 * Inserts a new user.
 * @param {Object} options
 * @param {string} options.name - Display name.
 * @param {string} options.email - Lowercased email.
 * @param {string} options.passwordHash - bcrypt hash.
 * @param {string} [options.role] - One of Roles; defaults to CUSTOMER.
 * @returns {Promise<import("mongoose").Document>} The created user.
 */
export const create = async ({ name, email, passwordHash, role }) => {
  return User.create({ name, email, passwordHash, role });
};

/**
 * Finds a user by email, optionally including the password hash.
 * @param {Object} options
 * @param {string} options.email - Lowercased email.
 * @param {boolean} [options.withPassword=false] - Include passwordHash for credential checks.
 * @returns {Promise<import("mongoose").Document | null>} The user, or null.
 */
export const findByEmail = async ({ email, withPassword = false }) => {
  const query = User.findOne({ email });
  return withPassword ? query.select("+passwordHash") : query;
};

/**
 * Finds a user by id, optionally including the password hash.
 * @param {string} userId - The user's id.
 * @param {Object} [options]
 * @param {boolean} [options.withPassword=false] - Include passwordHash for credential checks.
 * @returns {Promise<import("mongoose").Document | null>} The user, or null.
 */
export const findById = async (userId, { withPassword = false } = {}) => {
  const query = User.findById(userId);
  return withPassword ? query.select("+passwordHash") : query;
};

/**
 * Returns one page of users matching a filter, newest first, plus the total.
 * @param {Object} options
 * @param {Object} options.filter - Mongo filter.
 * @param {number} options.skip - Documents to skip.
 * @param {number} options.limit - Page size.
 * @returns {Promise<{ users: import("mongoose").Document[], total: number }>} The page and total.
 */
export const findPage = async ({ filter, skip, limit }) => {
  const [users, total] = await Promise.all([
    User.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    User.countDocuments(filter),
  ]);
  return { users, total };
};

/**
 * Finds one user matching a filter (e.g. `{ _id, role }`).
 * @param {Object} filter - Mongo filter.
 * @returns {Promise<import("mongoose").Document | null>} The user, or null.
 */
export const findOne = async (filter) => User.findOne(filter);

/**
 * Counts users matching a filter.
 * @param {Object} filter - Mongo filter.
 * @returns {Promise<number>} The count.
 */
export const count = async (filter) => User.countDocuments(filter);

/**
 * Sets a user's status, only for a user matching `filter` (e.g. customers only).
 * @param {Object} options
 * @param {Object} options.filter - Identifies the user.
 * @param {string} options.status - One of UserStatuses.
 * @returns {Promise<import("mongoose").Document | null>} The updated user, or null.
 */
export const updateStatus = async ({ filter, status }) => {
  return User.findOneAndUpdate(filter, { $set: { status } }, { returnDocument: "after" });
};

/**
 * Sets fields on a user.
 * @param {Object} options
 * @param {string} options.userId - The user's id.
 * @param {Object} options.set - Fields to `$set`.
 * @returns {Promise<import("mongoose").Document | null>} The updated user, or null if not found.
 */
export const updateById = async ({ userId, set }) => {
  return User.findByIdAndUpdate(userId, { $set: set }, { returnDocument: "after", runValidators: true });
};

/**
 * Saves changes made to a loaded user document (used for address edits).
 * @param {import("mongoose").Document} user - The modified user document.
 * @returns {Promise<import("mongoose").Document>} The saved user.
 */
export const save = async (user) => user.save();

/**
 * Adds a product to a user's favourites. No-op if it already is one.
 * @param {Object} options
 * @param {string} options.userId - The user's id.
 * @param {string} options.productId - The product's id.
 * @returns {Promise<import("mongoose").Document | null>} The updated user, or null if not found.
 */
export const addFavourite = async ({ userId, productId }) => {
  return User.findByIdAndUpdate(userId, { $addToSet: { favourites: productId } }, { returnDocument: "after" });
};

/**
 * Removes a product from a user's favourites. No-op if it wasn't one.
 * @param {Object} options
 * @param {string} options.userId - The user's id.
 * @param {string} options.productId - The product's id.
 * @returns {Promise<import("mongoose").Document | null>} The updated user, or null if not found.
 */
export const removeFavourite = async ({ userId, productId }) => {
  return User.findByIdAndUpdate(userId, { $pull: { favourites: productId } }, { returnDocument: "after" });
};

/**
 * Replaces a user's password hash.
 * @param {string} userId - The user's id.
 * @param {string} passwordHash - The new bcrypt hash.
 * @returns {Promise<import("mongoose").Document | null>} The updated user, or null if not found.
 */
export const updatePasswordHash = async (userId, passwordHash) => {
  return User.findByIdAndUpdate(userId, { passwordHash }, { returnDocument: "after" });
};
