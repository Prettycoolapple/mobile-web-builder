import http from "http";
import { Server } from "socket.io";
import { eq, or, and } from "drizzle-orm";
import app from "./app";
import { logger } from "./lib/logger";
import { setIo } from "./lib/socket";
import { verifyToken } from "./lib/auth";
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

httpServer.listen(port, (err?: Error) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
