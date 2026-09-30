/**
 * Direction of a money movement.
 * @type {Readonly<Record<string, string>>}
 */
export const TransactionTypes = {
  PAYMENT: "PAYMENT",
  REFUND: "REFUND",
};

/**
 * Provider-confirmed status of a transaction.
 * @type {Readonly<Record<string, string>>}
 */
export const TransactionStatuses = {
  PENDING: "PENDING",
  SUCCEEDED: "SUCCEEDED",
  FAILED: "FAILED",
  EXPIRED: "EXPIRED",
};
