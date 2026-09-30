import { logger } from "#configs/logger.config.js";
import { startApp } from "#bootstrap/start-app.js";

startApp().catch((error) => {
  logger.error("API failed to start", { message: error.message, stack: error.stack });
  process.exit(1);
});
