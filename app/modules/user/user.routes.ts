import express from "express";

const AuthController = require("./AuthController") as typeof import("./AuthController");
const UserController = require("./user.controller") as typeof import("./user.controller");
const verifyToken = require("../../middlewares/protectApi") as typeof import("../../middlewares/protectApi");
const isNotVendor = require("../../middlewares/isNotVendor") as typeof import("../../middlewares/isNotVendor");
const requirePermission = require("../../middlewares/requirePermission") as (permissionKey: string) => express.RequestHandler;

const UserRouter = express.Router();

/**
 * @swagger
 * /users/meta:
 *   get:
 *     security:
 *       - bearerAuth: []
 *     tags:
 *       - Users
 *     summary: Get user management metadata
 *     description: Returns account statuses, permission groups, permission templates, and available role suggestions used by the users create/edit screens.
 *     responses:
 *       200:
 *         description: Users metadata
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UserMetaResponse'
 */
UserRouter.get("/meta", verifyToken, isNotVendor, requirePermission("users_view"), UserController.getMeta);
/**
 * @swagger
 * /users:
 *   get:
 *     security:
 *       - bearerAuth: []
 *     tags:
 *       - Users
 *     summary: Get all admin users
 *     description: Returns the administrative user list (admins, operations, logistics). Vendor users cannot call this endpoint. Pass includeVendors=true to also list the vendors' login accounts (same users_view permission).
 *     parameters:
 *       - in: query
 *         name: includeVendors
 *         required: false
 *         schema:
 *           type: boolean
 *         description: Also return vendor accounts (used by the Users screen)
 *     responses:
 *       200:
 *         description: Users list
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UserListResponse'
 *             examples:
 *               default:
 *                 value:
 *                   status: true
 *                   statusCode: 200
 *                   data:
 *                     - id: 1
 *                       firstName: Ahmed
 *                       lastName: Hesham
 *                       fullName: Ahmed Hesham
 *                       email: admin@homix.com
 *                       roleName: مدير
 *                       status: online
 *                       isActive: true
 *       401:
 *         description: Missing or invalid bearer token
 */
UserRouter.get("/", verifyToken, isNotVendor, requirePermission("users_view"), UserController.getAllUsers);
/**
 * @swagger
 * /users/{id}:
 *   get:
 *     security:
 *       - bearerAuth: []
 *     tags:
 *       - Users
 *     summary: Get user by ID
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: User details
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UserResponse'
 *       401:
 *         description: Missing or invalid bearer token
 *       404:
 *         description: User not found
 */
/**
 * @swagger
 * /users/me:
 *   get:
 *     security:
 *       - bearerAuth: []
 *     tags: [Users]
 *     summary: The signed-in user's own record (used to refresh a stale session)
 *     responses:
 *       200:
 *         description: Current user
 *       401:
 *         description: Unauthorized
 */
// Declared before "/:id" so express does not treat "me" as an id.
UserRouter.get("/me", verifyToken, UserController.getCurrentUser);

UserRouter.get("/:id", verifyToken, isNotVendor, requirePermission("users_view"), UserController.getUser);
/**
 * @swagger
 * /users/{id}:
 *   put:
 *     security:
 *       - bearerAuth: []
 *     tags:
 *       - Users
 *     summary: Update user
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UserUpsertRequest'
 *           examples:
 *             updateAdmin:
 *               value:
 *                 firstName: Ibrahim
 *                 email: ibrahim@homix.com
 *                 roleName: مدير
 *                 userType: "1"
 *                 permissions:
 *                   users_view: true
 *                   users_manage: true
 *     responses:
 *       200:
 *         description: User updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UserResponse'
 *       401:
 *         description: Missing or invalid bearer token
 *       404:
 *         description: User not found
 */
UserRouter.put("/:id", verifyToken, isNotVendor, requirePermission("users_manage"), UserController.editUser);
/**
 * @swagger
 * /users/login:
 *   post:
 *     tags:
 *       - Users
 *     summary: Login user
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/LoginRequest'
 *           examples:
 *             adminLogin:
 *               value:
 *                 email: admin@homix.com
 *                 password: Secret123!
 *     responses:
 *       200:
 *         description: Login result
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/LoginResponse'
 *       401:
 *         description: Invalid credentials
 */
UserRouter.post("/login", AuthController.login);
/**
 * @swagger
 * /users:
 *   post:
 *     security:
 *       - bearerAuth: []
 *     tags:
 *       - Users
 *     summary: Create user
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UserUpsertRequest'
 *           examples:
 *             createAdmin:
 *               value:
 *                 firstName: Nour
 *                 email: nour@homix.com
 *                 password: Secret123!
 *                 roleName: عمليات
 *                 userType: "3"
 *                 jobTitle: مسؤول متابعة طلبات
 *                 salary: 7500
 *                 phoneNumber: 01032288941
 *                 accountStatus: active
 *                 permissions:
 *                   orders_view: true
 *                   orders_edit: true
 *                   orders_create: true
 *     responses:
 *       200:
 *         description: User created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UserResponse'
 *       401:
 *         description: Missing or invalid bearer token
 *       409:
 *         description: User already exists
 */
UserRouter.post("/", verifyToken, isNotVendor, requirePermission("users_manage"), AuthController.addUser);
/**
 * @swagger
 * /users/{id}/status:
 *   patch:
 *     security:
 *       - bearerAuth: []
 *     tags:
 *       - Users
 *     summary: Update user account status
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               accountStatus:
 *                 type: string
 *                 enum: [active, inactive, suspended]
 *                 example: suspended
 *     responses:
 *       200:
 *         description: User status updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UserResponse'
 */
UserRouter.patch("/:id/status", verifyToken, isNotVendor, requirePermission("users_manage"), UserController.updateStatus);
/**
 * @swagger
 * /users/{id}:
 *   delete:
 *     security:
 *       - bearerAuth: []
 *     tags:
 *       - Users
 *     summary: Delete user
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: User deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/GenericMessageResponse'
 *       401:
 *         description: Missing or invalid bearer token
 *       404:
 *         description: User not found
 */
UserRouter.delete("/:id", verifyToken, isNotVendor, requirePermission("users_manage"), UserController.deleteUser);

export = UserRouter;
