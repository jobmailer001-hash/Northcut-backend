import { env } from "#configs/env.config.js";
import { logger } from "#configs/logger.config.js";
import { EmailTemplates } from "#constants/email.constants.js";
import { sendEmail as sendEmailProvider } from "#providers/email.provider.js";
import { getQueue, QueueNames } from "#queues/queues.js";
import { findById as findUserById } from "#repositories/user.repository.js";
import { formatMoney } from "#utils/money.util.js";

/**
 * Sign-off appended to every email.
 * @type {string}
 */
const SIGN_OFF = "\n— Northcut";

/**
 * Joins email lines into a plain-text body with the standard greeting and sign-off.
 * @param {string} name - Recipient's name.
 * @param {string[]} lines - Body lines (empty strings become blank lines).
 * @returns {string} The email body.
 */
const composeBody = (name, lines) => [`Hi ${name},`, "", ...lines, SIGN_OFF].join("\n");

/**
 * Builders turning a template's data into a subject and plain-text body. Order templates
 * receive the data prepared by queueOrderEmail.
 * @type {Record<string, (data: Record<string, unknown>) => { subject: string, text: string }>}
 */
const emailBuilders = {
  [EmailTemplates.PASSWORD_RESET_CODE]: ({ name, code }) => ({
    subject: "Your Northcut password reset code",
    text: composeBody(name, [
      `Your password reset code is: ${code}`,
      "",
      `It expires in ${Math.round(env.passwordResetCodeTtlSeconds / 60)} minutes.`,
      "If you didn't ask to reset your password, you can ignore this email.",
    ]),
  }),

  [EmailTemplates.ORDER_PLACED]: ({ name, orderNumber, itemsSummary, total, orderUrl, holdMinutes }) => ({
    subject: `Order ${orderNumber} received`,
    text: composeBody(name, [
      `Thanks for your order ${orderNumber}.`,
      "",
      itemsSummary,
      `Total: ${total}`,
      "",
      `Your items are held for ${holdMinutes} minutes. If you haven't finished paying, you can do it here:`,
      orderUrl,
    ]),
  }),

  [EmailTemplates.ORDER_PAID]: ({ name, orderNumber, itemsSummary, total, orderUrl }) => ({
    subject: `Payment received for ${orderNumber}`,
    text: composeBody(name, [
      `We've received your payment of ${total} for order ${orderNumber}. We're getting it ready.`,
      "",
      itemsSummary,
      "",
      `Track your order: ${orderUrl}`,
    ]),
  }),

  [EmailTemplates.ORDER_SHIPPED]: ({ name, orderNumber, itemsSummary, orderUrl }) => ({
    subject: `Your order ${orderNumber} is on its way`,
    text: composeBody(name, [`Good news — order ${orderNumber} has shipped.`, "", itemsSummary, "", orderUrl]),
  }),

  [EmailTemplates.ORDER_CANCELLED]: ({ name, orderNumber, total, reason, isRefunded, orderUrl }) => ({
    subject: `Order ${orderNumber} cancelled`,
    text: composeBody(name, [
      `Order ${orderNumber} has been cancelled.`,
      ...(reason ? [`Reason: ${reason}`] : []),
      ...(isRefunded ? ["", `A full refund of ${total} is on its way to your original payment method.`] : []),
      "",
      orderUrl,
    ]),
  }),

  [EmailTemplates.ORDER_EXPIRED]: ({ name, orderNumber, shopUrl }) => ({
    subject: `Order ${orderNumber} expired`,
    text: composeBody(name, [
      `We didn't receive payment for order ${orderNumber} in time, so the items were released.`,
      `You're welcome to order again any time: ${shopUrl}`,
    ]),
  }),
};

/**
 * Enqueues an email for the worker to send, so the request never waits on the provider.
 * @param {Object} options
 * @param {string} options.template - One of EmailTemplates.
 * @param {string} options.to - Recipient address.
 * @param {Record<string, unknown>} options.data - Values the template needs.
 * @returns {Promise<void>}
 */
export const queueEmail = async ({ template, to, data }) => {
  await getQueue(QueueNames.EMAILS).add(template, { template, to, data });
};

/**
 * One line per order item, e.g. "2 × Classic Tee — ₦25,000.00".
 * @param {import("mongoose").Document} order - The order.
 * @returns {string} The items summary.
 */
const summarizeItems = (order) => {
  return order.items
    .map((item) => `${item.quantity} × ${item.name} — ${formatMoney(item.lineTotal, order.currency)}`)
    .join("\n");
};

/**
 * Queues an order email to the order's customer. Best-effort: a failure is logged and never
 * breaks the order, payment or job that triggered it.
 * @param {Object} options
 * @param {string} options.template - An ORDER_* EmailTemplate.
 * @param {import("mongoose").Document} options.order - The order (userId may be populated or not).
 * @param {string} [options.reason] - Cancellation reason, for ORDER_CANCELLED.
 * @returns {Promise<void>}
 */
export const queueOrderEmail = async ({ template, order, reason }) => {
  try {
    const user = await findUserById(order.userId?._id ?? order.userId);

    if (!user) {
      return;
    }

    await queueEmail({
      template,
      to: user.email,
      data: {
        name: user.name,
        orderNumber: order.orderNumber,
        itemsSummary: summarizeItems(order),
        total: formatMoney(order.total, order.currency),
        orderUrl: `${env.clientUrl}/orders/${order.orderNumber}`,
        shopUrl: `${env.clientUrl}/products`,
        holdMinutes: Math.round(env.orderHoldMs / 60000),
        reason,
        isRefunded: Boolean(order.paidAt),
      },
    });
  } catch (error) {
    logger.error("Couldn't queue order email", { template, orderNumber: order.orderNumber, message: error.message });
  }
};

/**
 * Builds an email from its template and sends it through the provider. Called by the worker.
 * @param {Object} options
 * @param {string} options.template - One of EmailTemplates.
 * @param {string} options.to - Recipient address.
 * @param {Record<string, unknown>} options.data - Values the template needs.
 * @returns {Promise<void>}
 */
export const deliverEmail = async ({ template, to, data }) => {
  const { subject, text } = emailBuilders[template](data);
  await sendEmailProvider({ to, subject, text });
};
