import multer from "multer";

import { AppError } from "#errors/app-error.js";
import { ErrorCodes } from "#errors/error-codes.js";

/**
 * The only image type accepted for upload.
 * @type {string}
 */
const JPEG_MIME_TYPE = "image/jpeg";

/**
 * Builds an INVALID_UPLOAD error.
 * @param {string} message - Client-facing reason.
 * @returns {AppError} The error.
 */
const invalidUploadError = (message) => new AppError(message, { code: ErrorCodes.INVALID_UPLOAD });

/**
 * Whether the bytes are really a JPEG. The declared MIME type is client-controlled, so the
 * file's own signature is checked too: every JPEG starts with the SOI marker FF D8 FF.
 * @param {Buffer} buffer - The file's bytes.
 * @returns {boolean} Whether it's a JPEG.
 */
const isJpeg = (buffer) => buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;

/**
 * Formats a byte count as whole megabytes for error messages.
 * @param {number} bytes - Byte count.
 * @returns {string} e.g. "10 MB".
 */
const toMegabytesLabel = (bytes) => `${Math.round(bytes / (1024 * 1024))} MB`;

/**
 * Builds middleware accepting up to `maxCount` JPEG images in one multipart field, kept in
 * memory and exposed as `req.files`. Checks run in order: type (declared, then real signature),
 * then count and combined size. Every failure becomes an INVALID_UPLOAD AppError.
 * @param {Object} options
 * @param {string} options.fieldName - Multipart field holding the images.
 * @param {number} options.maxCount - Most files accepted in one request.
 * @param {number} options.maxTotalBytes - Largest combined size of all files.
 * @returns {import("express").RequestHandler} Upload middleware.
 */
export const uploadJpegImages = ({ fieldName, maxCount, maxTotalBytes }) => {
  const sizeLimitMessage = `Images must add up to ${toMegabytesLabel(maxTotalBytes)} or less per upload.`;
  const countLimitMessage = `Upload at most ${maxCount} images at a time.`;

  /**
   * Client-facing messages for multer's own error codes.
   * @type {Record<string, string>}
   */
  const multerErrorMessages = {
    // One file over the combined limit already breaks it.
    LIMIT_FILE_SIZE: sizeLimitMessage,
    LIMIT_FILE_COUNT: countLimitMessage,
    // Multer reports extra files in the field as "unexpected".
    LIMIT_UNEXPECTED_FILE: `${countLimitMessage} Send them in the \`${fieldName}\` field.`,
  };

  /**
   * Multer instance keeping files in memory (they're staged in MongoDB for the worker).
   * @type {import("multer").Multer}
   */
  const imageUploader = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxTotalBytes, files: maxCount },
    fileFilter: (req, file, callback) => {
      if (file.mimetype !== JPEG_MIME_TYPE) {
        callback(invalidUploadError("Only JPEG images are allowed."));
        return;
      }
      callback(null, true);
    },
  });

  return (req, res, next) => {
    imageUploader.array(fieldName, maxCount)(req, res, (error) => {
      if (error instanceof multer.MulterError) {
        return next(invalidUploadError(multerErrorMessages[error.code] ?? error.message));
      }
      if (error) {
        return next(error);
      }

      const files = req.files ?? [];

      if (files.some((file) => !isJpeg(file.buffer))) {
        return next(invalidUploadError("Only JPEG images are allowed."));
      }

      const totalBytes = files.reduce((sum, file) => sum + file.size, 0);

      if (totalBytes > maxTotalBytes) {
        return next(invalidUploadError(sizeLimitMessage));
      }
      return next();
    });
  };
};
