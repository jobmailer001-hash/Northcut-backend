import { Router } from "express";

import {
  addAddress,
  addFavourite,
  deleteAddress,
  getProfile,
  listAddresses,
  listFavourites,
  removeFavourite,
  updateAddress,
  updateProfile,
} from "#controllers/me.controller.js";
import { authenticate } from "#middlewares/authenticate.middleware.js";
import { validate } from "#middlewares/validate.middleware.js";
import {
  addressBodySchema,
  addressIdParamsSchema,
  favouriteSkuParamsSchema,
  updateAddressBodySchema,
  updateProfileBodySchema,
} from "#validators/me.validator.js";

/**
 * The logged-in user's own resources, mounted at /api/v1/me. Any role.
 * @type {import("express").Router}
 */
export const meRoutes = Router();

meRoutes.use(authenticate);

meRoutes.get("/", getProfile);
meRoutes.patch("/", validate({ body: updateProfileBodySchema }), updateProfile);

meRoutes.get("/addresses", listAddresses);
meRoutes.post("/addresses", validate({ body: addressBodySchema }), addAddress);
meRoutes.patch(
  "/addresses/:addressId",
  validate({ params: addressIdParamsSchema, body: updateAddressBodySchema }),
  updateAddress,
);
meRoutes.delete("/addresses/:addressId", validate({ params: addressIdParamsSchema }), deleteAddress);

meRoutes.get("/favourites", listFavourites);
meRoutes.put("/favourites/:sku", validate({ params: favouriteSkuParamsSchema }), addFavourite);
meRoutes.delete("/favourites/:sku", validate({ params: favouriteSkuParamsSchema }), removeFavourite);
