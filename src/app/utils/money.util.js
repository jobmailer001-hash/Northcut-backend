/**
 * Minor units (kobo) per major unit (naira).
 * @type {number}
 */
const MINOR_UNITS_PER_MAJOR = 100;

/**
 * Cached Intl formatters, one per currency.
 * @type {Map<string, Intl.NumberFormat>}
 */
const formatters = new Map();

/**
 * Formats an integer minor-unit amount for display (emails). All money is stored and
 * computed in integer minor units; this is the only place it's converted, and only for text.
 * @param {number} amountInMinorUnits - e.g. 1250000.
 * @param {string} [currency="NGN"] - Currency code.
 * @returns {string} e.g. "₦12,500.00".
 */
export const formatMoney = (amountInMinorUnits, currency = "NGN") => {
  if (!formatters.has(currency)) {
    formatters.set(currency, new Intl.NumberFormat("en-NG", { style: "currency", currency }));
  }
  return formatters.get(currency).format(amountInMinorUnits / MINOR_UNITS_PER_MAJOR);
};
