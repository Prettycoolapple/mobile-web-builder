import "./lib/loadEnv";
import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { getTrustProxySetting } from "./lib/env";

const app: Express = express();

app.set("trust proxy", getTrustProxySetting());

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
app.use(cors());

// Stripe webhooks need the raw body for signature verification, so the raw
// parser must run for this path BEFORE the global JSON parser. body-parser marks
// req._body once it parses, so express.json() then no-ops for this request.
app.use("/api/stripe/webhook", express.raw({ type: "application/json" }));

app.use(express.json({ limit: "8mb" }));
app.use(express.urlencoded({ extended: true, limit: "8mb" }));

app.use("/api", router);

export default app;
