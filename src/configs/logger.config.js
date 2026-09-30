import winston from "winston";

import { env } from "#configs/env.config.js";

const { combine, timestamp, errors, json, colorize, printf } = winston.format;

/**
 * Human-readable single-line format for local development.
 * @type {import("logform").Format}
 */
const devFormat = printf(({ level, message, timestamp: time, stack, ...meta }) => {
  const metaText = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
  return `${time} ${level}: ${stack ?? message}${metaText}`;
});

/**
 * Application-wide winston logger. Console output is colourised text in development
 * and JSON in production; errors are also written to logs/error.log.
 * @type {import("winston").Logger}
 */
export const logger = winston.createLogger({
  level: env.logLevel,
  format: combine(timestamp(), errors({ stack: true }), json()),
  transports: [
    new winston.transports.Console({
      format: env.isProduction
        ? combine(timestamp(), errors({ stack: true }), json())
        : combine(colorize(), timestamp({ format: "HH:mm:ss" }), errors({ stack: true }), devFormat),
    }),
    new winston.transports.File({ filename: "logs/error.log", level: "error" }),
  ],
});
