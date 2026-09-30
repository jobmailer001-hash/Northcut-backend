import { Router } from "express";

import {
  cancelOrder,
  changeShippingAddress,
  getOrder,
  listOrders,
  placeOrder,
  placePreorder,
  startPayment,
} from "#controllers/order.controller.js";
import { authenticate } from "#middlewares/authenticate.middleware.js";
import { validate } from "#middlewares/validate.middleware.js";
import {
  cancelOrderBodySchema,
  changeShippingAddressBodySchema,
  listMyOrdersQuerySchema,
  orderNumberParamsSchema,
  placeOrderBodySchema,
  placePreorderBodySchema,
} from "#validators/order.validator.js";

/**
 * The logged-in customer's orders, mounted at /api/v1/orders.
 * @type {import("express").Router}
 */
export const orderRoutes = Router();

orderRoutes.use(authenticate);

orderRoutes.post("/", validate({ body: placeOrderBodySchema }), placeOrder);
orderRoutes.post("/preorder", validate({ body: placePreorderBodySchema }), placePreorder);
orderRoutes.get("/", validate({ query: listMyOrdersQuerySchema }), listOrders);
orderRoutes.get("/:orderNumber", validate({ params: orderNumberParamsSchema }), getOrder);
orderRoutes.post("/:orderNumber/payment", validate({ params: orderNumberParamsSchema }), startPayment);
orderRoutes.post(
  "/:orderNumber/cancel",
  validate({ params: orderNumberParamsSchema, body: cancelOrderBodySchema }),
  cancelOrder,
);
orderRoutes.patch(
  "/:orderNumber/shipping-address",
  validate({ params: orderNumberParamsSchema, body: changeShippingAddressBodySchema }),
  changeShippingAddress,
);
