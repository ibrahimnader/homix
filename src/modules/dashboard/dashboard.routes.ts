import express from "express";
import { z } from "zod";

import { asyncHandler, validateRequest } from "../../shared/http";
import { DashboardController } from "./dashboard.controller";
import { DashboardRepository } from "./dashboard.repo";
import { dashboardDateRangeSchema, financeAdjustmentsBodySchema, financeMonthSchema, financeOpexBodySchema } from "./dashboard.schemas";
import { DashboardService } from "./dashboard.service";

const verifyToken = require("../../../app/middlewares/protectApi");
const requirePermission = require("../../../app/middlewares/requirePermission");
const isAdmin = require("../../../app/middlewares/isAdmin");

const dashboardRepository = new DashboardRepository();
const dashboardService = new DashboardService(dashboardRepository);
const dashboardController = new DashboardController(dashboardService);

const dashboardCardParamSchema = z.object({
  cardKey: z.enum([
    "activeMakers",
    "activeProducts",
    "pendingOrders",
    "totalOrders",
    "totalSales",
  ]),
});

export const dashboardRouter = express.Router();

dashboardRouter.get(
  "/finance",
  verifyToken,
  isAdmin,
  requirePermission("finance_view"),
  validateRequest({ query: financeMonthSchema }),
  asyncHandler(dashboardController.getFinance),
);

dashboardRouter.put(
  "/finance/opex",
  verifyToken,
  isAdmin,
  requirePermission("finance_view"),
  validateRequest({ body: financeOpexBodySchema, query: financeMonthSchema }),
  asyncHandler(dashboardController.saveFinanceOpex),
);

dashboardRouter.put(
  "/finance/adjustments",
  verifyToken,
  isAdmin,
  requirePermission("finance_view"),
  validateRequest({ body: financeAdjustmentsBodySchema, query: financeMonthSchema }),
  asyncHandler(dashboardController.saveFinanceAdjustments),
);

/**
 * @swagger
 * components:
 *   parameters:
 *     DashboardStartDate:
 *       in: query
 *       name: startDate
 *       required: true
 *       schema:
 *         type: string
 *         format: date
 *       example: 2026-05-01
 *     DashboardEndDate:
 *       in: query
 *       name: endDate
 *       required: true
 *       schema:
 *         type: string
 *         format: date
 *       example: 2026-05-31
 */

/**
 * @swagger
 * /dashboard/cards:
 *   get:
 *     security:
 *       - bearerAuth: []
 *     tags:
 *       - Dashboard
 *     summary: Get dashboard cards for a date range
 *     description: Returns the dashboard summary cards for the selected period. Vendor users are automatically scoped to their own vendor data.
 *     parameters:
 *       - $ref: '#/components/parameters/DashboardStartDate'
 *       - $ref: '#/components/parameters/DashboardEndDate'
 *     responses:
 *       200:
 *         description: Dashboard cards payload
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DashboardCardsEnvelope'
 *             examples:
 *               adminView:
 *                 summary: Admin dashboard cards
 *                 value:
 *                   status: true
 *                   data:
 *                     - key: totalSales
 *                       currentValue: 847320
 *                       previousValue: 754000
 *                       changePercentage: 12.4
 *                       trend: up
 *                     - key: totalOrders
 *                       currentValue: 720
 *                       previousValue: 665
 *                       changePercentage: 8.1
 *                       trend: up
 *       400:
 *         description: Invalid date range
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Missing or invalid bearer token
 */
dashboardRouter.get(
  "/cards",
  verifyToken,
  requirePermission("dashboard_view"),
  validateRequest({ query: dashboardDateRangeSchema }),
  asyncHandler(dashboardController.getCards),
);

/**
 * @swagger
 * /dashboard/cards/{cardKey}:
 *   get:
 *     security:
 *       - bearerAuth: []
 *     tags:
 *       - Dashboard
 *     summary: Get a single dashboard card for a date range
 *     description: Returns a single dashboard KPI card for the selected period.
 *     parameters:
 *       - in: path
 *         name: cardKey
 *         required: true
 *         schema:
 *           type: string
 *           enum: [activeMakers, activeProducts, pendingOrders, totalOrders, totalSales]
 *       - $ref: '#/components/parameters/DashboardStartDate'
 *       - $ref: '#/components/parameters/DashboardEndDate'
 *     responses:
 *       200:
 *         description: Single dashboard card payload
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DashboardCardEnvelope'
 *             examples:
 *               totalSales:
 *                 value:
 *                   status: true
 *                   data:
 *                     key: totalSales
 *                     currentValue: 847320
 *                     previousValue: 754000
 *                     changePercentage: 12.4
 *                     trend: up
 *       400:
 *         description: Invalid date range or unsupported card key
 *       401:
 *         description: Missing or invalid bearer token
 */
dashboardRouter.get(
  "/cards/:cardKey",
  verifyToken,
  requirePermission("dashboard_view"),
  validateRequest({
    params: dashboardCardParamSchema,
    query: dashboardDateRangeSchema,
  }),
  asyncHandler(dashboardController.getSingleCard),
);

/**
 * @swagger
 * /dashboard/performance:
 *   get:
 *     security:
 *       - bearerAuth: []
 *     tags:
 *       - Dashboard
 *     summary: Get dashboard sales performance chart
 *     description: Returns the time-series used for the performance chart plus the total sales KPI summary for the selected period.
 *     parameters:
 *       - $ref: '#/components/parameters/DashboardStartDate'
 *       - $ref: '#/components/parameters/DashboardEndDate'
 *     responses:
 *       200:
 *         description: Sales performance payload
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DashboardPerformanceEnvelope'
 *             examples:
 *               adminPerformance:
 *                 value:
 *                   status: true
 *                   data:
 *                     role: admin
 *                     startDate: 2026-05-01
 *                     endDate: 2026-05-31
 *                     summary:
 *                       key: totalSales
 *                       label: إجمالي المبيعات (ج.م)
 *                       currentValue: 847320
 *                       previousValue: 754000
 *                       comparisonLabel: مقارنة بالفترة السابقة
 *                       changePercentage: 12.4
 *                       trend: up
 *                     series:
 *                       - date: 2026-05-01
 *                         orders: 18
 *                         sales: 42800
 *                       - date: 2026-05-04
 *                         orders: 21
 *                         sales: 51700
 *       400:
 *         description: Invalid date range
 *       401:
 *         description: Missing or invalid bearer token
 */
dashboardRouter.get(
  "/performance",
  verifyToken,
  requirePermission("dashboard_view"),
  validateRequest({ query: dashboardDateRangeSchema }),
  asyncHandler(dashboardController.getPerformance),
);

/**
 * @swagger
 * /dashboard/activities:
 *   get:
 *     security:
 *       - bearerAuth: []
 *     tags:
 *       - Dashboard
 *     summary: Get latest dashboard activities
 *     description: Returns the activity feed for the authenticated user's dashboard within the selected range.
 *     parameters:
 *       - $ref: '#/components/parameters/DashboardStartDate'
 *       - $ref: '#/components/parameters/DashboardEndDate'
 *     responses:
 *       200:
 *         description: Activity feed payload
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DashboardActivitiesEnvelope'
 *             examples:
 *               default:
 *                 value:
 *                   status: true
 *                   data:
 *                     role: admin
 *                     items:
 *                       - id: 91
 *                         entityId: 31668
 *                         entityType: order
 *                         text: تم اضافة طلب جديد رقم 31668
 *                         createdAt: 2026-05-02T00:45:00.000Z
 *       400:
 *         description: Invalid date range
 *       401:
 *         description: Missing or invalid bearer token
 */
dashboardRouter.get(
  "/activities",
  verifyToken,
  requirePermission("dashboard_view"),
  validateRequest({ query: dashboardDateRangeSchema }),
  asyncHandler(dashboardController.getActivities),
);

/**
 * @swagger
 * /dashboard/latest-orders:
 *   get:
 *     security:
 *       - bearerAuth: []
 *     tags:
 *       - Dashboard
 *     summary: Get latest orders widget data
 *     description: Returns the most recent orders in the selected range, automatically scoped for vendor users.
 *     parameters:
 *       - $ref: '#/components/parameters/DashboardStartDate'
 *       - $ref: '#/components/parameters/DashboardEndDate'
 *     responses:
 *       200:
 *         description: Latest orders payload
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DashboardLatestOrdersEnvelope'
 *             examples:
 *               default:
 *                 value:
 *                   status: true
 *                   data:
 *                     role: admin
 *                     items:
 *                       - id: 31668
 *                         orderNumber: "31668"
 *                         customerName: Lamiaa Saeid
 *                         productName: غرفة نوم - دريسينج
 *                         amount: 12999
 *                         status: 1
 *                         statusLabel: معلق
 *                         orderDate: 2026-05-02T00:45:00.000Z
 *       400:
 *         description: Invalid date range
 *       401:
 *         description: Missing or invalid bearer token
 */
dashboardRouter.get(
  "/latest-orders",
  verifyToken,
  requirePermission("dashboard_view"),
  validateRequest({ query: dashboardDateRangeSchema }),
  asyncHandler(dashboardController.getLatestOrders),
);

/**
 * @swagger
 * /dashboard/leaderboard:
 *   get:
 *     security:
 *       - bearerAuth: []
 *     tags:
 *       - Dashboard
 *     summary: Get dashboard leaderboard
 *     description: Admin users receive top vendors by sales. Vendor users receive top products by sales.
 *     parameters:
 *       - $ref: '#/components/parameters/DashboardStartDate'
 *       - $ref: '#/components/parameters/DashboardEndDate'
 *     responses:
 *       200:
 *         description: Leaderboard payload
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DashboardLeaderboardEnvelope'
 *             examples:
 *               adminLeaderboard:
 *                 value:
 *                   status: true
 *                   data:
 *                     role: admin
 *                     items:
 *                       - id: 4
 *                         name: ركنة للأثاث
 *                         rank: 1
 *                         secondaryLabel: صانع
 *                         totalSales: 284000
 *       400:
 *         description: Invalid date range
 *       401:
 *         description: Missing or invalid bearer token
 */
dashboardRouter.get(
  "/leaderboard",
  verifyToken,
  requirePermission("dashboard_view"),
  validateRequest({ query: dashboardDateRangeSchema }),
  asyncHandler(dashboardController.getLeaderboard),
);

// /**
//  * @swagger
//  * /dashboard/quick-actions:
//  *   get:
//  *     security:
//  *       - bearerAuth: []
//  *     tags:
//  *       - Dashboard
//  *     summary: Get dashboard quick actions
//  *     description: Returns the role-specific quick actions shown on the dashboard.
//  *     parameters:
//  *       - $ref: '#/components/parameters/DashboardStartDate'
//  *       - $ref: '#/components/parameters/DashboardEndDate'
//  *     responses:
//  *       200:
//  *         description: Quick actions payload
//  *         content:
//  *           application/json:
//  *             schema:
//  *               $ref: '#/components/schemas/DashboardQuickActionsEnvelope'
//  *             examples:
//  *               adminActions:
//  *                 value:
//  *                   status: true
//  *                   data:
//  *                     role: admin
//  *                     items:
//  *                       - key: add-maker
//  *                         label: صانع جديد
//  *                         description: إضافة صانع جديد
//  *                         icon: user-plus
//  *                         route: /vendors/new
//  *       400:
//  *         description: Invalid date range
//  *       401:
//  *         description: Missing or invalid bearer token
//  */

dashboardRouter.get(
  "/quick-actions",
  verifyToken,
  requirePermission("dashboard_view"),
  validateRequest({ query: dashboardDateRangeSchema }),
  asyncHandler(dashboardController.getQuickActions),
);

/**
 * @swagger
 * /dashboard/sales-distribution:
 *   get:
 *     security:
 *       - bearerAuth: []
 *     tags:
 *       - Dashboard
 *     summary: Get dashboard sales distribution
 *     description: Returns the donut-chart distribution data. Admin users are grouped by vendor, vendors are grouped by product.
 *     parameters:
 *       - $ref: '#/components/parameters/DashboardStartDate'
 *       - $ref: '#/components/parameters/DashboardEndDate'
 *     responses:
 *       200:
 *         description: Sales distribution payload
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DashboardSalesDistributionEnvelope'
 *             examples:
 *               distribution:
 *                 value:
 *                   status: true
 *                   data:
 *                     role: admin
 *                     items:
 *                       - label: غرفة النوم
 *                         value: 320000
 *                         percentage: 40
 *                         color: "#6366F1"
 *                       - label: الصالة
 *                         value: 200000
 *                         percentage: 25
 *                         color: "#10B981"
 *       400:
 *         description: Invalid date range
 *       401:
 *         description: Missing or invalid bearer token
 */
dashboardRouter.get(
  "/sales-distribution",
  verifyToken,
  requirePermission("dashboard_view"),
  validateRequest({ query: dashboardDateRangeSchema }),
  asyncHandler(dashboardController.getSalesDistribution),
);

// /**
//  * @swagger
//  * /dashboard/goals-progress:
//  *   get:
//  *     security:
//  *       - bearerAuth: []
//  *     tags:
//  *       - Dashboard
//  *     summary: Get dashboard goals progress
//  *     description: Returns the progress bars for the dashboard goals based on the selected date range and user role.
//  *     parameters:
//  *       - $ref: '#/components/parameters/DashboardStartDate'
//  *       - $ref: '#/components/parameters/DashboardEndDate'
//  *     responses:
//  *       200:
//  *         description: Goals progress payload
//  *         content:
//  *           application/json:
//  *             schema:
//  *               $ref: '#/components/schemas/DashboardGoalsProgressEnvelope'
//  *             examples:
//  *               adminGoals:
//  *                 value:
//  *                   status: true
//  *                   data:
//  *                     role: admin
//  *                     items:
//  *                       - key: salesTarget
//  *                         label: هدف المبيعات
//  *                         currentValue: 847000
//  *                         targetValue: 1000000
//  *                         progressPercentage: 84.7
//  *                         color: "#6366F1"
//  *       400:
//  *         description: Invalid date range
//  *       401:
//  *         description: Missing or invalid bearer token
//  */
// dashboardRouter.get(
//   "/goals-progress",
//   verifyToken,
//   validateRequest({ query: dashboardDateRangeSchema }),
//   asyncHandler(dashboardController.getGoalsProgress),
// );
