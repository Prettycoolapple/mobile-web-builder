import type { IncomingMessage, ServerResponse } from "node:http";

declare const app: (req: IncomingMessage, res: ServerResponse) => void;
export default app;
