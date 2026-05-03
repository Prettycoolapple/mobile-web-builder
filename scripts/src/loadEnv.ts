import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

function findWorkspaceRoot(startDir: string): string {
  let dir = startDir;

  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) {
      return dir;
    }
    dir = path.dirname(dir);
  }

  return startDir;
}

const scriptsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = findWorkspaceRoot(scriptsRoot);

const envBaseFiles = [
  path.join(workspaceRoot, ".env"),
  path.join(scriptsRoot, ".env"),
];
const envLocalFiles = [
  path.join(workspaceRoot, ".env.local"),
  path.join(scriptsRoot, ".env.local"),
];

for (const envPath of envBaseFiles) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath, override: false });
  }
}
for (const envPath of envLocalFiles) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath, override: true });
  }
}
