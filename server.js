require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const http = require("http");
const mainRouter = require("./config/routes");
const { NotFoundError } = require("./app/middlewares/errors");
const globalErrorHandler = require("./app/middlewares/errorhandler");
const fileUpload = require("express-fileupload");
require("./config/shopify");
const ShopifyHelper = require("./app/modules/helpers/shopifyHelper");
global.express = express;
const app = express();
const server = http.createServer(app); // Create HTTP server
const MB16 = 16 * 1024;
const { connectToDb } = require("./config/db.config");
const createDefaultData = require("./config/defaultData.seeder");
const { Server } = require("socket.io");
const User = require("./app/modules/user/user.model");

const startServer = async () => {
  try {
    // await ShopifyHelper.createWebhooks();
    await connectToDb();
    app.use(bodyParser.json({ limit: "1mb" }));
    app.use(bodyParser.urlencoded({ limit: "16mb", extended: true }));
    app.use(cors());

    // Set up Socket.IO AFTER initializing Express middleware
    const io = new Server(server, {
      cors: {
        origin: "*", // Allow all origins for testing
        methods: ["GET", "POST"],
      },
    });

    global.socketIO = io;

    app.get("/", (req, res) => {
      res.send(`<html>
  <head>
    <meta name="viewport" content="width=device-width,initial-scale=1.0" />
    <title>Socket.IO chat</title>
    <style>
      body { margin: 0; padding-bottom: 3rem; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }

      #form { background: rgba(0, 0, 0, 0.15); padding: 0.25rem; position: fixed; bottom: 0; left: 0; right: 0; display: flex; height: 3rem; box-sizing: border-box; backdrop-filter: blur(10px); }
      #input { border: none; padding: 0 1rem; flex-grow: 1; border-radius: 2rem; margin: 0.25rem; }
      #input:focus { outline: none; }
      #form > button { background: #333; border: none; padding: 0 1rem; margin: 0.25rem; border-radius: 3px; outline: none; color: #fff; }

      #messages { list-style-type: none; margin: 0; padding: 0; }
      #messages > li { padding: 0.5rem 1rem; }
      #messages > li:nth-child(odd) { background: #efefef; }
    </style>
  </head>
  <script src="/socket.io/socket.io.js"></script>
  <script>
    const socket = io();
    
    socket.on('connect', () => {
      console.log('Connected to server with ID:', socket.id);
      document.getElementById('messages').innerHTML += '<li>Connected to server!</li>';
      
      // Test subscription
      socket.emit('subscribe_notification', { userId: 1 });
    });
    
    socket.on('connect_error', (error) => {
      console.error('Connection error:', error);
      document.getElementById('messages').innerHTML += '<li>Connection error: ' + error.message + '</li>';
    });
    
    // Listen for notifications
    socket.on('notification', (data) => {
      console.log('Received notification:', data);
      document.getElementById('messages').innerHTML += 
        '<li><strong>Notification:</strong> ' + JSON.stringify(data) + '</li>';
    });
    
    // Form handling
    const form = document.getElementById('form');
    const input = document.getElementById('input');
    const messages = document.getElementById('messages');
    
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (input.value) {
        // Send the message as both a chat message and a test notification
        socket.emit('chat message', input.value);
        socket.emit('test_notification', {
          message: input.value,
          timestamp: new Date().toISOString()
        });
        
        messages.innerHTML += '<li>You: ' + input.value + '</li>';
        input.value = '';
      }
    });
  </script>
  <body>
    <ul id="messages"></ul>
    <form id="form" action="">
      <input id="input" autocomplete="off" /><button>Send</button>
    </form>
  </body>
</html>`);
    });

    app.use("/uploads", express.static("uploads"));
    app.use((error, req, res, next) => {
      if (error instanceof SyntaxError) {
        return res.status(400).json({
          status: "failed",
          message: "Enter a valid JSON object.",
        });
      }
      res.header(
        "Cache-Control",
        "private, no-cache, no-store, must-revalidate"
      );
      res.header("Expires", "-1");
      res.header("Pragma", "no-cache");

      return next();
    });

    app.disable("etag");

    // Set the port
    const defaultPort = 3000; // Change to 3000 to match your access URL
    let port = defaultPort;

    if (process.env.NODE_PORT && parseInt(process.env.NODE_PORT, 10)) {
      port = parseInt(process.env.NODE_PORT, 10);
    }

    app.use("/", mainRouter);
    // Handle 404 errors
    app.all("*", (req, res, next) => {
      next(new NotFoundError(`Can't find ${req.originalUrl} on this server!`));
    });

    // Global error handling middleware
    app.use(globalErrorHandler);

    // Listen on the HTTP server instead of the Express app
    server.listen(port, async () => {
      console.log(`Server running at http://localhost:${port}`);
      console.log("Webhooks created successfully");
      await createDefaultData();
      console.log("Default user created successfully");
    });

    // Set up Socket.IO events
    io.on("connection", (socket) => {
      console.log("A user connected with ID:", socket.id);

      socket.on("subscribe_notification", async (data) => {
        console.log("Subscribed to notification with data:", data);
        const userId = data.userId;
        try {
          const user = await User.findByPk(userId);
          if (user) {
            user.socketId = socket.id;
            await user.save();
            console.log(`User ${userId} registered with socket ${socket.id}`);

            // Send a confirmation back to the client
            socket.emit("notification", {
              message: "Successfully subscribed to notifications",
            });
          } else {
            console.log(`User with ID ${userId} not found`);
          }
        } catch (err) {
          console.error("Error in subscribe_notification:", err);
        }
      });

      socket.on("disconnect", async () => {
        console.log("User disconnected:", socket.id);
        try {
          if (socket.handshake.query && socket.handshake.query.userId) {
            await User.update(
              { socketId: null },
              {
                where: { id: socket.handshake.query.userId },
              }
            );
          }
        } catch (err) {
          console.error("Error updating user on disconnect:", err);
        }
      });

      // Add a chat message handler for testing
      socket.on("chat message", (msg) => {
        console.log("Message received:", msg);
        // Broadcast to all clients except sender
        socket.broadcast.emit("chat message", msg);
      });
    });
  } catch (error) {
    console.error("Failed to start server:", error);
  }
};

startServer();

module.exports = app;
