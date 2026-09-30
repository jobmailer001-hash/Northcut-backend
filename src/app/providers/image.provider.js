import { cloudinary } from "#configs/cloudinary.config.js";
import { env } from "#configs/env.config.js";

/**
 * Uploads an image buffer to Cloudinary.
 * @param {Object} options
 * @param {Buffer} options.buffer - The image bytes (from multer memory storage).
 * @param {string} options.folder - Sub-folder under the configured root, e.g. "products".
 * @returns {Promise<{ url: string, publicId: string }>} The hosted image.
 */
export const uploadImage = async ({ buffer, folder }) => {
  const result = await new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      { folder: `${env.cloudinary.folder}/${folder}`, resource_type: "image" },
      (error, uploadResult) => (error ? reject(error) : resolve(uploadResult)),
    );
    uploadStream.end(buffer);
  });

  return { url: result.secure_url, publicId: result.public_id };
};

/**
 * Deletes an image from Cloudinary. Succeeds if the image is already gone.
 * @param {string} publicId - The image's Cloudinary public id.
 * @returns {Promise<void>}
 */
export const deleteImage = async (publicId) => {
  await cloudinary.uploader.destroy(publicId, { resource_type: "image", invalidate: true });
};
