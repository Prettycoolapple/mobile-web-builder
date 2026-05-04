// Vercel serverless entry — must live under repo-root `api/` (Vercel does not
// treat `artifacts/api-server/api/` as the `api` directory).
//
// Behaviour matches the previous `artifacts/api-server/api/index.ts` stub.
import "../artifacts/api-server/src/lib/loadEnv";
import app from "../artifacts/api-server/src/app";
import type { IncomingMessage, ServerResponse } from "http";

export default function handler(req: IncomingMessage, res: ServerResponse) {
  return (app as unknown as (req: IncomingMessage, res: ServerResponse) => void)(req, res);
}

export const config = {
  runtime: "nodejs20.x",
};
