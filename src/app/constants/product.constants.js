/**
 * Whether a product can be bought now, pre-ordered, or neither.
 * @type {Readonly<Record<string, string>>}
 */
export const AvailabilityStatuses = {
  IN_STOCK: "IN_STOCK",
  PRE_ORDER: "PRE_ORDER",
  OUT_OF_STOCK: "OUT_OF_STOCK",
};

/**
 * Whether customers can see a product. Products are hidden, never deleted,
 * so order history stays intact.
 * @type {Readonly<Record<string, string>>}
 */
export const PublicityStatuses = {
  PUBLIC: "PUBLIC",
  HIDDEN: "HIDDEN",
};

/**
 * Most images a single product can have (attached plus still-processing uploads).
 * @type {number}
 */
export const MAX_IMAGES_PER_PRODUCT = 4;

/**
 * Largest combined size of all images in one upload request, in bytes (10 MB).
 * @type {number}
 */
export const MAX_IMAGE_UPLOAD_TOTAL_BYTES = 10 * 1024 * 1024;

/**
 * How long staged upload bytes are kept before MongoDB's TTL index deletes them (24 h).
 * The worker normally finishes within seconds; this only cleans up jobs that failed for good.
 * @type {number}
 */
export const PENDING_IMAGE_UPLOAD_TTL_SECONDS = 24 * 60 * 60;

/**
 * In-stock products with this many available units or fewer count as low stock (admin dashboard).
 * @type {number}
 */
export const LOW_STOCK_THRESHOLD = 5;

/**
 * Most tags a single product can have.
 * @type {number}
 */
export const MAX_TAGS_PER_PRODUCT = 20;
