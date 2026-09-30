/**
 * User roles.
 * @type {Readonly<Record<string, string>>}
 */
export const Roles = {
  CUSTOMER: "CUSTOMER",
  ADMIN: "ADMIN",
};

/**
 * Account statuses; DISABLED accounts cannot log in.
 * @type {Readonly<Record<string, string>>}
 */
export const UserStatuses = {
  ACTIVE: "ACTIVE",
  DISABLED: "DISABLED",
};

/**
 * Most saved addresses a user can have.
 * @type {number}
 */
export const MAX_ADDRESSES_PER_USER = 10;
