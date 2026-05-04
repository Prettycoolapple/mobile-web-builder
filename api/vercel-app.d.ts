declare module "./vercel-app.mjs" {
  import type { IncomingMessage, ServerResponse } from "node:http";
  const app: (req: IncomingMessage, res: ServerResponse) => void;
  export default app;
}
