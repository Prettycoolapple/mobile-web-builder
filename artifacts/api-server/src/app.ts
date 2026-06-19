import "./lib/loadEnv";
import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { getAllowedOrigins, getTrustProxySetting } from "./lib/env";

const app: Express = express();

app.set("trust proxy", getTrustProxySetting());

// Lock CORS to known browser origins. A missing Origin header (native apps,
// curl, server-to-server, same-origin navigations) is allowed — those callers
// are not browsers enforcing CORS, so this never affects the mobile app. The
// allowlist's job is to stop *other websites* calling the API from a browser.
const allowedOrigins = new Set(getAllowedOrigins());
const allowLocalhostOrigins = process.env.NODE_ENV !== "production";
function isAllowedOrigin(origin: string): boolean {
  const normalized = origin.replace(/\/+$/, "");
  if (allowedOrigins.has(normalized)) return true;
  if (allowLocalhostOrigins && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(normalized)) {
    return true;
  }
  return false;
}

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || isAllowedOrigin(origin)) {
        callback(null, true);
        return;
      }
      // Disallowed browser origin: omit CORS headers (the browser then blocks
      // the response) rather than erroring the request.
      callback(null, false);
    },
    credentials: true,
  }),
);

// Stripe webhooks need the raw body for signature verification, so the raw
// parser must run for this path BEFORE the global JSON parser. body-parser marks
// req._body once it parses, so express.json() then no-ops for this request.
app.use("/api/stripe/webhook", express.raw({ type: "application/json" }));

app.use(express.json({ limit: "8mb" }));
app.use(express.urlencoded({ extended: true, limit: "8mb" }));

app.use("/share", (req, res, next) => {
  req.url = `/share${req.url}`;
  router(req, res, next);
});

app.use("/property-share", (req, res, next) => {
  req.url = `/property-share${req.url}`;
  router(req, res, next);
});

app.use("/api", router);

export default app;
