import pino from "pino";

const isHostedServerless = process.env.VERCEL === "1" || process.env.VERCEL === "true";
const isProduction = process.env.NODE_ENV === "production" || isHostedServerless;

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "res.headers['set-cookie']",
  ],
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
});
