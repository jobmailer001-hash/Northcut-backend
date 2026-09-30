import { logger } from "#configs/logger.config.js";
import { AvailabilityStatuses, PublicityStatuses } from "#constants/product.constants.js";
import connectMongoDb, { disconnectMongoDb } from "#db/mongodb/mongodb.connection.js";
import { create as createProductRepo, findBySku } from "#repositories/product.repository.js";

/**
 * Converts whole naira to kobo, the unit every stored amount uses.
 * @param {number} naira - Whole naira.
 * @returns {number} The amount in kobo.
 */
const toKobo = (naira) => naira * 100;

const { IN_STOCK, PRE_ORDER, OUT_OF_STOCK } = AvailabilityStatuses;
const { PUBLIC, HIDDEN } = PublicityStatuses;

/**
 * Sample catalog: 20 clothing products, 12 of them hidden drafts. Prices are in naira here
 * and stored in kobo. Products have no images — upload them from the admin edit page.
 * @type {Array<{ name: string, slug: string, sku: string, description: string, tags: string[],
 *   price: number, preorderPrice?: number, availabilityStatus: string, publicityStatus: string,
 *   stock?: number, preorderLimit?: number }>}
 */
const sampleProducts = [
  // Public
  {
    name: "Relaxed Wool Overshirt",
    slug: "relaxed-wool-overshirt",
    sku: "NC-OVS-001",
    description: "A brushed wool overshirt cut loose through the body, with twin chest pockets and horn buttons.",
    tags: ["outerwear"],
    price: 85000,
    availabilityStatus: IN_STOCK,
    publicityStatus: PUBLIC,
    stock: 14,
  },
  {
    name: "Heavyweight Boxy Tee — Black",
    slug: "heavyweight-boxy-tee-black",
    sku: "NC-TEE-002",
    description: "Dense 280gsm cotton jersey in a boxy, cropped fit with a tight ribbed collar.",
    tags: ["tops", "essentials"],
    price: 18000,
    availabilityStatus: IN_STOCK,
    publicityStatus: PUBLIC,
    stock: 40,
  },
  {
    name: "Pleated Wide-Leg Trousers",
    slug: "pleated-wide-leg-trousers",
    sku: "NC-TRS-003",
    description: "Double-pleated trousers in a fluid twill with a high rise and a full, straight leg.",
    tags: ["bottoms", "tailoring"],
    price: 62000,
    availabilityStatus: IN_STOCK,
    publicityStatus: PUBLIC,
    stock: 9,
  },
  {
    name: "Cropped Leather Bomber",
    slug: "cropped-leather-bomber",
    sku: "NC-JKT-004",
    description: "Soft lambskin bomber with a cropped body, ribbed trims and a two-way zip.",
    tags: ["outerwear", "leather"],
    price: 210000,
    preorderPrice: 180000,
    availabilityStatus: PRE_ORDER,
    publicityStatus: PUBLIC,
    preorderLimit: 15,
  },
  {
    name: "Merino Crewneck Knit",
    slug: "merino-crewneck-knit",
    sku: "NC-KNT-005",
    description: "Fine-gauge extra-fine merino crewneck — light enough to layer, warm enough to wear alone.",
    tags: ["knitwear", "essentials"],
    price: 74000,
    availabilityStatus: IN_STOCK,
    publicityStatus: PUBLIC,
    stock: 4,
  },
  {
    name: "Washed Denim Carpenter Jeans",
    slug: "washed-denim-carpenter-jeans",
    sku: "NC-DNM-006",
    description: "Vintage-washed 13oz denim with a hammer loop, utility pockets and a relaxed straight leg.",
    tags: ["bottoms", "denim"],
    price: 58000,
    availabilityStatus: OUT_OF_STOCK,
    publicityStatus: PUBLIC,
  },
  {
    name: "Ribbed Tank — Off White",
    slug: "ribbed-tank-off-white",
    sku: "NC-TNK-007",
    description: "A close-fitting 2x2 rib tank in combed cotton. The base layer for everything else.",
    tags: ["tops", "essentials"],
    price: 12500,
    availabilityStatus: IN_STOCK,
    publicityStatus: PUBLIC,
    stock: 60,
  },
  {
    name: "Nylon Utility Vest",
    slug: "nylon-utility-vest",
    sku: "NC-VST-008",
    description: "Matte ripstop nylon vest with bellows pockets and a snap-front placket.",
    tags: ["outerwear"],
    price: 49000,
    availabilityStatus: IN_STOCK,
    publicityStatus: PUBLIC,
    stock: 12,
  },

  // Hidden drafts
  {
    name: "Brushed Cotton Hoodie",
    slug: "brushed-cotton-hoodie",
    sku: "NC-HOD-009",
    description: "Loopback cotton hoodie brushed inside for softness, with a double-layer hood.",
    tags: ["loungewear", "tops"],
    price: 45000,
    availabilityStatus: IN_STOCK,
    publicityStatus: HIDDEN,
    stock: 25,
  },
  {
    name: "Drawstring Lounge Pants",
    slug: "drawstring-lounge-pants",
    sku: "NC-LNG-010",
    description: "Tapered lounge pants in the same brushed cotton as the hoodie, with an elasticated waist.",
    tags: ["loungewear", "bottoms"],
    price: 32000,
    availabilityStatus: IN_STOCK,
    publicityStatus: HIDDEN,
    stock: 30,
  },
  {
    name: "Double-Breasted Trench Coat",
    slug: "double-breasted-trench-coat",
    sku: "NC-CT-011",
    description: "Water-resistant cotton gabardine trench with storm flaps, a belted waist and a deep back vent.",
    tags: ["outerwear"],
    price: 240000,
    preorderPrice: 199000,
    availabilityStatus: PRE_ORDER,
    publicityStatus: HIDDEN,
    preorderLimit: 10,
  },
  {
    name: "Stripe Slim Tee",
    slug: "stripe-slim-tee",
    sku: "NC-TEE-012",
    description: "Yarn-dyed Breton stripe in a slim, slightly cropped fit.",
    tags: ["tops"],
    price: 16000,
    availabilityStatus: IN_STOCK,
    publicityStatus: HIDDEN,
    stock: 35,
  },
  {
    name: "Oversized Poplin Shirt",
    slug: "oversized-poplin-shirt",
    sku: "NC-SHT-013",
    description: "Crisp cotton poplin with dropped shoulders, a long back hem and a hidden button placket.",
    tags: ["tops", "shirts"],
    price: 38000,
    availabilityStatus: IN_STOCK,
    publicityStatus: HIDDEN,
    stock: 18,
  },
  {
    name: "Chunky Cable Cardigan",
    slug: "chunky-cable-cardigan",
    sku: "NC-KNT-014",
    description: "Hand-feel wool-blend cardigan with an all-over cable and oversized shawl collar.",
    tags: ["knitwear"],
    price: 88000,
    availabilityStatus: OUT_OF_STOCK,
    publicityStatus: HIDDEN,
  },
  {
    name: "Tailored Wool Blazer",
    slug: "tailored-wool-blazer",
    sku: "NC-BLZ-015",
    description: "Half-canvassed single-breasted blazer in a dry tropical wool, softly structured shoulders.",
    tags: ["outerwear", "tailoring"],
    price: 165000,
    availabilityStatus: IN_STOCK,
    publicityStatus: HIDDEN,
    stock: 6,
  },
  {
    name: "Canvas Cargo Shorts",
    slug: "canvas-cargo-shorts",
    sku: "NC-SHR-016",
    description: "Garment-dyed cotton canvas shorts with a relaxed fit and flap cargo pockets.",
    tags: ["bottoms"],
    price: 27000,
    availabilityStatus: IN_STOCK,
    publicityStatus: HIDDEN,
    stock: 22,
  },
  {
    name: "Mock-Neck Long-Sleeve Tee",
    slug: "mock-neck-long-sleeve-tee",
    sku: "NC-TEE-017",
    description: "Fitted long-sleeve in silky modal-cotton with a low mock neck.",
    tags: ["tops", "essentials"],
    price: 21000,
    availabilityStatus: IN_STOCK,
    publicityStatus: HIDDEN,
    stock: 28,
  },
  {
    name: "Quilted Liner Jacket",
    slug: "quilted-liner-jacket",
    sku: "NC-JKT-018",
    description: "Diamond-quilted liner jacket with a collarless neck — wear it alone or under a coat.",
    tags: ["outerwear"],
    price: 96000,
    preorderPrice: 82000,
    availabilityStatus: PRE_ORDER,
    publicityStatus: HIDDEN,
    preorderLimit: 20,
  },
  {
    name: "Linen Camp-Collar Shirt",
    slug: "linen-camp-collar-shirt",
    sku: "NC-SHT-019",
    description: "Washed European linen with an open camp collar and a straight, boxy hem.",
    tags: ["tops", "shirts"],
    price: 34000,
    availabilityStatus: IN_STOCK,
    publicityStatus: HIDDEN,
    stock: 16,
  },
  {
    name: "Raw Selvedge Straight Jeans",
    slug: "raw-selvedge-straight-jeans",
    sku: "NC-DNM-020",
    description: "Unwashed 14oz Japanese selvedge denim in a classic straight cut. Fades with you.",
    tags: ["bottoms", "denim"],
    price: 79000,
    availabilityStatus: IN_STOCK,
    publicityStatus: HIDDEN,
    stock: 11,
  },
];

/**
 * Inserts every sample product whose SKU isn't in the catalog yet, so re-running is safe.
 * @returns {Promise<void>}
 */
const seedProducts = async () => {
  await connectMongoDb();

  try {
    let createdCount = 0;

    for (const { price, preorderPrice = null, ...fields } of sampleProducts) {
      if (await findBySku(fields.sku)) {
        logger.info(`Skipped ${fields.sku} — already exists`);
        continue;
      }

      await createProductRepo({
        ...fields,
        pricing: { launchPrice: toKobo(price), preorderPrice: preorderPrice && toKobo(preorderPrice) },
      });
      createdCount += 1;
    }

    logger.info(`Products seeded: ${createdCount} created, ${sampleProducts.length - createdCount} skipped`);
  } finally {
    await disconnectMongoDb();
  }
};

seedProducts().catch((error) => {
  logger.error("Seeding products failed", { message: error.message, stack: error.stack });
  process.exit(1);
});
