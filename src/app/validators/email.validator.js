import { z } from "zod";

import { EmailTemplates } from "#constants/email.constants.js";

/**
 * Payload of a job on the `emails` queue, validated by the worker before sending.
 * @type {import("zod").ZodObject}
 */
export const emailJobSchema = z.object({
  template: z.enum(Object.values(EmailTemplates)),
  to: z.email(),
  data: z.record(z.string(), z.unknown()).default({}),
});
