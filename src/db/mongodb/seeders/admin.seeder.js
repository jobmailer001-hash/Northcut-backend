import { parseArgs } from "node:util";

import { z } from "zod";

import { logger } from "#configs/logger.config.js";
import { Roles } from "#constants/user.constants.js";
import connectMongoDb, { disconnectMongoDb } from "#db/mongodb/mongodb.connection.js";
import { create as createUserRepo, findByEmail } from "#repositories/user.repository.js";
import { signupBodySchema } from "#validators/auth.validator.js";
import { hashPassword } from "#utils/password.util.js";

/**
 * Reads and validates --name, --email and --password from the command line.
 * @returns {{ name: string, email: string, password: string }} The admin's details.
 */
const readAdminArgs = () => {
  const { values } = parseArgs({
    options: {
      name: { type: "string" },
      email: { type: "string" },
      password: { type: "string" },
    },
  });

  const result = signupBodySchema.safeParse(values);

  if (!result.success) {
    logger.error(
      `Invalid arguments:\n${z.prettifyError(result.error)}\n\n` +
        'Usage: npm run seed:admin -- --name "Jane Doe" --email jane@example.com --password "at-least-8-chars"',
    );
    process.exit(1);
  }

  return result.data;
};

/**
 * Creates the first admin account. Refuses if the email is already registered.
 * @returns {Promise<void>}
 */
const seedAdmin = async () => {
  const { name, email, password } = readAdminArgs();
  await connectMongoDb();

  try {
    const existingUser = await findByEmail({ email });

    if (existingUser) {
      logger.error(`An account with ${email} already exists (role: ${existingUser.role}). Nothing changed.`);
      process.exitCode = 1;
      return;
    }

    const passwordHash = await hashPassword(password);
    const admin = await createUserRepo({ name, email, passwordHash, role: Roles.ADMIN });
    logger.info(`Admin created: ${admin.email} (id ${admin.id})`);
  } finally {
    await disconnectMongoDb();
  }
};

seedAdmin().catch((error) => {
  logger.error("Seeding admin failed", { message: error.message, stack: error.stack });
  process.exit(1);
});
