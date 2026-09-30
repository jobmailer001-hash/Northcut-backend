import { OrderStatuses } from "#constants/order.constants.js";
import { LOW_STOCK_THRESHOLD } from "#constants/product.constants.js";
import { Roles } from "#constants/user.constants.js";
import { listAdminOrders } from "#handlers/admin-order.handler.js";
import { count as countOrders, countByStatus, sumRevenue } from "#repositories/order.repository.js";
import { findLowStock } from "#repositories/product.repository.js";
import { count as countUsers } from "#repositories/user.repository.js";

/**
 * Orders that count as money received.
 * @type {string[]}
 */
const PAID_STATUSES = [OrderStatuses.PAID, OrderStatuses.SHIPPED, OrderStatuses.DELIVERED];

/**
 * Days covered by the "recent revenue" figure.
 * @type {number}
 */
const RECENT_REVENUE_DAYS = 30;

/**
 * Rows in each dashboard list.
 * @type {number}
 */
const DASHBOARD_LIST_SIZE = 5;

/**
 * Overview figures for the admin dashboard. Queries run in parallel.
 * @returns {Promise<Object>} Revenue, order counts, customer count, low stock, and recent orders.
 */
export const getDashboard = async () => {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const recentRevenueSince = new Date(Date.now() - RECENT_REVENUE_DAYS * 24 * 60 * 60 * 1000);

  const [ordersByStatus, allTimeRevenue, recentRevenue, ordersToday, customerCount, lowStockProducts, recent] =
    await Promise.all([
      countByStatus(),
      sumRevenue({ statuses: PAID_STATUSES }),
      sumRevenue({ statuses: PAID_STATUSES, since: recentRevenueSince }),
      countOrders({ createdAt: { $gte: startOfToday } }),
      countUsers({ role: Roles.CUSTOMER }),
      findLowStock({ threshold: LOW_STOCK_THRESHOLD, limit: DASHBOARD_LIST_SIZE }),
      listAdminOrders({ page: 1, limit: DASHBOARD_LIST_SIZE }),
    ]);

  return {
    revenue: {
      allTime: allTimeRevenue.revenue,
      recent: recentRevenue.revenue,
      recentDays: RECENT_REVENUE_DAYS,
    },
    orders: {
      today: ordersToday,
      awaitingShipment: ordersByStatus[OrderStatuses.PAID] ?? 0,
      byStatus: Object.fromEntries(Object.values(OrderStatuses).map((status) => [status, ordersByStatus[status] ?? 0])),
    },
    customers: { total: customerCount },
    lowStockProducts,
    lowStockThreshold: LOW_STOCK_THRESHOLD,
    recentOrders: recent.orders,
  };
};
