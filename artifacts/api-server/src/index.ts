import http from "http";
import { Server } from "socket.io";
import app from "./app";
import { logger } from "./lib/logger";
import { setIo } from "./lib/socket";
import { verifyToken } from "./lib/auth";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const httpServer = http.createServer(app);

const io = new Server(httpServer, {
  cors: { origin: "*" },
  transports: ["websocket", "polling"],
});

setIo(io);

io.use((socket, next) => {
  const token =
    (socket.handshake.auth?.token as string | undefined) ||
    (socket.handshake.query?.token as string | undefined);

  if (!token) {
    return next(new Error("Authentication required"));
  }

  const payload = verifyToken(token);
  if (!payload) {
    return next(new Error("Invalid or expired token"));
  }

  (socket as any).userId = payload.sub;
  (socket as any).role = payload.role;
  next();
});

io.on("connection", (socket) => {
  const userId: string = (socket as any).userId;
  logger.info({ socketId: socket.id, userId }, "Socket connected");

  socket.on("join_thread", (threadId: string) => {
    socket.join(`thread:${threadId}`);
    logger.info({ socketId: socket.id, threadId }, "Joined thread room");
  });

  socket.on("leave_thread", (threadId: string) => {
    socket.leave(`thread:${threadId}`);
  });

  socket.on("disconnect", () => {
    logger.info({ socketId: socket.id, userId }, "Socket disconnected");
  });
});

httpServer.listen(port, (err?: Error) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
