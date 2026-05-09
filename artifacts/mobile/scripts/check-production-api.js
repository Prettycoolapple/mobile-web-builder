const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const workspaceRoot = path.resolve(projectRoot, "..", "..");

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const env = {};
  for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[match[1]] = value;
  }
  return env;
}

function firstValue(env, names) {
  for (const name of names) {
    const value = process.env[name] || env[name];
    if (value && value.trim()) return { name, value: value.trim() };
  }
  return null;
}

function stripTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}

function normalizeApiUrl(rawValue, sourceName) {
  const withProtocol = /^https?:\/\//i.test(rawValue) ? rawValue : `https://${rawValue}`;
  const url = new URL(withProtocol);
  if (/\.supabase\.(co|com)$/i.test(url.hostname)) {
    throw new Error(`${sourceName} points at Supabase. It must point at the Vercel app instead.`);
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  if (!url.pathname.endsWith("/api")) {
    url.pathname = `${url.pathname}/api`;
  }
  return stripTrailingSlash(url.toString());
}

async function main() {
  const env = {
    ...readEnvFile(path.join(workspaceRoot, ".env.local")),
    ...readEnvFile(path.join(projectRoot, ".env.local")),
  };

  const configured = firstValue(env, [
    "EXPO_PUBLIC_API_URL",
    "EXPO_PUBLIC_APP_URL",
    "EXPO_PUBLIC_DOMAIN",
  ]);

  if (!configured) {
    console.error("No mobile API URL is configured.");
    console.error("Set EXPO_PUBLIC_API_URL in EAS production to your Vercel API URL.");
    console.error("Example: https://your-project.vercel.app/api");
    process.exit(1);
  }

  const apiBase = normalizeApiUrl(configured.value, configured.name);
  const healthUrl = `${apiBase}/healthz`;

  console.log(`Mobile API source: ${configured.name}`);
  console.log(`Mobile API base:   ${apiBase}`);
  console.log(`Checking:          ${healthUrl}`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const resp = await fetch(healthUrl, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    const text = await resp.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      // handled below
    }

    if (!resp.ok) {
      console.error(`Health check failed with HTTP ${resp.status}.`);
      console.error(text.trim().replace(/\s+/g, " ").slice(0, 300));
      process.exit(1);
    }

    if (!json || json.status !== "ok") {
      console.error("Health check did not return the expected JSON.");
      console.error(text.trim().replace(/\s+/g, " ").slice(0, 300));
      process.exit(1);
    }

    console.log("Health check OK. This is the URL your TestFlight build should use.");
  } finally {
    clearTimeout(timeout);
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
