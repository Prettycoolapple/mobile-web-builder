import http from "http";
import { Server } from "socket.io";
import { eq, or, and } from "drizzle-orm";
import app from "./app";
import { logger } from "./lib/logger";
import { setIo } from "./lib/socket";
import { verifyActiveToken } from "./lib/auth";
import { db, dmThreads } from "@workspace/db";

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

// Socket.IO is incompatible with serverless runtimes (e.g. Vercel). We gate
// its initialization on an env flag so the same code can run either as a
// long-lived Node process (sockets on) or as a stateless serverless handler
// (sockets off, clients fall back to REST polling).
const enableSocketIo = process.env["ENABLE_SOCKET_IO"] !== "false";

const httpServer = http.createServer(app);

if (enableSocketIo) {
  const io = new Server(httpServer, {
    cors: { origin: "*" },
    transports: ["websocket", "polling"],
    path: "/api/socket.io",
    maxHttpBufferSize: 8 * 1024 * 1024,
  });

  setIo(io);

  io.use(async (socket, next) => {
    const token =
      (socket.handshake.auth?.token as string | undefined) ||
      (socket.handshake.query?.token as string | undefined);

    if (!token) {
      return next(new Error("Authentication required"));
    }

    const payload = await verifyActiveToken(token).catch(() => null);
    if (!payload) {
      return next(new Error("Invalid or replaced token"));
    }

    socket.data.userId = payload.sub;
    socket.data.role = payload.role;
    next();
  });

  io.on("connection", (socket) => {
    const userId: string = socket.data.userId as string;
    logger.info({ socketId: socket.id, userId }, "Socket connected");

    socket.join(`user:${userId}`);

    socket.on("join_thread", async (threadId: string, ack?: (err: string | null) => void) => {
      try {
        const [thread] = await db
          .select({ participantA: dmThreads.participantA, participantB: dmThreads.participantB })
          .from(dmThreads)
          .where(
            and(
              eq(dmThreads.id, threadId),
              or(eq(dmThreads.participantA, userId), eq(dmThreads.participantB, userId)),
            ),
          )
          .limit(1);

        if (!thread) {
          logger.warn({ socketId: socket.id, userId, threadId }, "Unauthorized join_thread attempt");
          if (typeof ack === "function") ack("Access denied");
          return;
        }

        socket.join(`thread:${threadId}`);
        logger.info({ socketId: socket.id, threadId }, "Joined thread room");
        if (typeof ack === "function") ack(null);
      } catch (err) {
        logger.error({ err, socketId: socket.id, threadId }, "join_thread DB error");
        if (typeof ack === "function") ack("Server error");
      }
    });

    socket.on("leave_thread", (threadId: string) => {
      socket.leave(`thread:${threadId}`);
    });

    socket.on("disconnect", () => {
      logger.info({ socketId: socket.id, userId }, "Socket disconnected");
    });
  });
} else {
  logger.info("Socket.IO disabled via ENABLE_SOCKET_IO=false; clients will use REST polling");
}

httpServer.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    logger.error(
      { port, err },
      `Port ${port} is already in use (another server may still be running). Stop that process or set PORT to a free port.`,
    );
  } else {
    logger.error({ err, port }, "HTTP server failed to start");
  }
  process.exit(1);
});

httpServer.listen(port, () => {
  logger.info({ port, enableSocketIo }, "Server listening");
});
