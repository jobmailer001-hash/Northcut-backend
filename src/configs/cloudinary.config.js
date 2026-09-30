import { v2 as cloudinary } from "cloudinary";

import { env } from "#configs/env.config.js";

cloudinary.config({
  cloud_name: env.cloudinary.cloudName,
  api_key: env.cloudinary.apiKey,
  api_secret: env.cloudinary.apiSecret,
  secure: true,
});

/**
 * Configured Cloudinary v2 client. Only the image provider should import this.
 * @type {typeof import("cloudinary").v2}
 */
export { cloudinary };
