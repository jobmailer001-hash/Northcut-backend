/**
 * Removes `_id` from a serialized document; the `id` virtual replaces it.
 * @param {import("mongoose").Document} doc - The source document.
 * @param {Record<string, unknown>} ret - The plain object being returned.
 * @returns {Record<string, unknown>} The cleaned plain object.
 */
const removeMongoId = (doc, ret) => {
  delete ret._id;
  return ret;
};

/**
 * Shared toJSON options: expose `id` instead of `_id` and drop `__v`,
 * so API responses never leak Mongo internals.
 * @type {import("mongoose").ToObjectOptions}
 */
export const jsonOptions = {
  virtuals: true,
  versionKey: false,
  transform: removeMongoId,
};
