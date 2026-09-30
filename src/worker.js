import { logger } from "#configs/logger.config.js";
import { startWorker } from "#bootstrap/start-worker.js";

startWorker().catch((error) => {
  logger.error("Worker failed to start", { message: error.message, stack: error.stack });
  process.exit(1);
});
