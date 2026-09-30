import {
  addAddress as addAddressHandler,
  addFavourite as addFavouriteHandler,
  deleteAddress as deleteAddressHandler,
  getProfile as getProfileHandler,
  listAddresses as listAddressesHandler,
  listFavourites as listFavouritesHandler,
  removeFavourite as removeFavouriteHandler,
  updateAddress as updateAddressHandler,
  updateProfile as updateProfileHandler,
} from "#handlers/user.handler.js";
import { getRequestContext } from "#utils/request.util.js";

/**
 * GET /me — the logged-in user's profile.
 * @param {import("express").Request} req - Express request.
 * @param {import("express").Response} res - Express response.
 * @returns {Promise<import("express").Response>} 200 with the profile.
 */
export const getProfile = async (req, res) => {
  const profile = await getProfileHandler(req.user.id);
  return res.status(200).json({ data: { profile } });
};

/**
 * PATCH /me — updates the profile.
 * @param {import("express").Request} req - Express request.
 * @param {import("express").Response} res - Express response.
 * @returns {Promise<import("express").Response>} 200 with the profile.
 */
export const updateProfile = async (req, res) => {
  const profile = await updateProfileHandler({
    userId: req.user.id,
    ...req.validated.body,
    context: getRequestContext(req),
  });
  return res.status(200).json({ data: { profile } });
};

/**
 * GET /me/addresses — lists saved addresses.
 * @param {import("express").Request} req - Express request.
 * @param {import("express").Response} res - Express response.
 * @returns {Promise<import("express").Response>} 200 with the addresses.
 */
export const listAddresses = async (req, res) => {
  const addresses = await listAddressesHandler(req.user.id);
  return res.status(200).json({ data: { addresses } });
};

/**
 * POST /me/addresses — saves a new address.
 * @param {import("express").Request} req - Express request.
 * @param {import("express").Response} res - Express response.
 * @returns {Promise<import("express").Response>} 201 with all addresses.
 */
export const addAddress = async (req, res) => {
  const addresses = await addAddressHandler({ userId: req.user.id, fields: req.validated.body });
  return res.status(201).json({ data: { addresses } });
};

/**
 * PATCH /me/addresses/:addressId — edits an address or makes it the default.
 * @param {import("express").Request} req - Express request.
 * @param {import("express").Response} res - Express response.
 * @returns {Promise<import("express").Response>} 200 with all addresses.
 */
export const updateAddress = async (req, res) => {
  const addresses = await updateAddressHandler({
    userId: req.user.id,
    addressId: req.validated.params.addressId,
    changes: req.validated.body,
  });
  return res.status(200).json({ data: { addresses } });
};

/**
 * DELETE /me/addresses/:addressId — deletes an address.
 * @param {import("express").Request} req - Express request.
 * @param {import("express").Response} res - Express response.
 * @returns {Promise<import("express").Response>} 200 with the remaining addresses.
 */
export const deleteAddress = async (req, res) => {
  const addresses = await deleteAddressHandler({
    userId: req.user.id,
    addressId: req.validated.params.addressId,
  });
  return res.status(200).json({ data: { addresses } });
};

/**
 * GET /me/favourites — lists favourite products that are still public.
 * @param {import("express").Request} req - Express request.
 * @param {import("express").Response} res - Express response.
 * @returns {Promise<import("express").Response>} 200 with the products.
 */
export const listFavourites = async (req, res) => {
  const products = await listFavouritesHandler(req.user.id);
  return res.status(200).json({ data: { products } });
};

/**
 * PUT /me/favourites/:sku — adds a favourite (idempotent).
 * @param {import("express").Request} req - Express request.
 * @param {import("express").Response} res - Express response.
 * @returns {Promise<import("express").Response>} 204.
 */
export const addFavourite = async (req, res) => {
  await addFavouriteHandler({ userId: req.user.id, sku: req.validated.params.sku });
  return res.status(204).end();
};

/**
 * DELETE /me/favourites/:sku — removes a favourite (idempotent).
 * @param {import("express").Request} req - Express request.
 * @param {import("express").Response} res - Express response.
 * @returns {Promise<import("express").Response>} 204.
 */
export const removeFavourite = async (req, res) => {
  await removeFavouriteHandler({ userId: req.user.id, sku: req.validated.params.sku });
  return res.status(204).end();
};
