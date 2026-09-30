import mongoose from "mongoose";

/**
 * Runs `work` inside a MongoDB transaction; everything it does commits or aborts together.
 * Mongoose may retry `work` on transient errors, so it must contain database writes only —
 * enqueue jobs, call providers, and send email after this resolves.
 * @template T
 * @param {(session: import("mongoose").ClientSession) => Promise<T>} work - Writes to run; pass `session` to every one.
 * @returns {Promise<T>} Whatever `work` returns.
 */
export const runInTransaction = async (work) => mongoose.connection.transaction(work);
