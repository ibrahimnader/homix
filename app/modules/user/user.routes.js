const express = require("express");
const AuthController = require("./AuthController");
const UserController = require("./user.controller");
const verifyToken = require("../../middlewares/protectApi");
const isAdmin = require("../../middlewares/isAdmin");
const isNotVendor = require("../../middlewares/isNotVendor");
const UserRouter = express.Router();

/**
 * @swagger
 * /users:
 *   get:
 *     security:
 *       - bearerAuth: []
 *     tags:
 *       - Users
 *     summary: Get all users
 *     responses:
 *       200:
 *         description: List of users
 */
UserRouter.get("/", verifyToken, isNotVendor, UserController.getAllUsers);

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
 */
UserRouter.get("/:id", verifyToken, isNotVendor, UserController.getUser);

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
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *               firstName:
 *                 type: string
 *     responses:
 *       200:
 *         description: User updated successfully
 */
UserRouter.put("/:id", verifyToken, isAdmin, UserController.editUser);

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
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Login successful
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
 *     summary: Create new user
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *               firstName:
 *                 type: string
 *               userType:
 *                 type: string
 *     responses:
 *       200:
 *         description: User created successfully
 */
UserRouter.post("/", verifyToken, isAdmin, AuthController.addUser);

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
 */
UserRouter.delete("/:id", verifyToken, isAdmin, UserController.deleteUser);

module.exports = UserRouter;