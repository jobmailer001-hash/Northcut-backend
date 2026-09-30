/**
 * Every email the system can send; each has a builder in email.handler.js.
 * @type {Readonly<Record<string, string>>}
 */
export const EmailTemplates = {
  PASSWORD_RESET_CODE: "PASSWORD_RESET_CODE",
  ORDER_PLACED: "ORDER_PLACED",
  ORDER_PAID: "ORDER_PAID",
  ORDER_SHIPPED: "ORDER_SHIPPED",
  ORDER_CANCELLED: "ORDER_CANCELLED",
  ORDER_EXPIRED: "ORDER_EXPIRED",
};
