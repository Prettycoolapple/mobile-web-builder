import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { build as esbuild } from "esbuild";
import esbuildPluginPino from "esbuild-plugin-pino";
import { copyFile, cp, mkdir, readFile, rm, stat, unlink, writeFile } from "node:fs/promises";

// Plugins (e.g. 'esbuild-plugin-pino') may use `require` to resolve dependencies
globalThis.require = createRequire(import.meta.url);

const artifactDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Vercel type-checks `.ts` sources listed in linked source maps when packaging
 * `includeFiles` (e.g. `api/vercel-app.mjs`). Strip the map so `src/app.ts` is never pulled in.
 */
async function stripLinkedSourcemap(bundlePath) {
  const body = await readFile(bundlePath, "utf8");
  const stripped = body.replace(/\r?\n\/\/# sourceMappingURL=[^\r\n]*\s*$/m, "");
  await writeFile(bundlePath, stripped, "utf8");
  await unlink(`${bundlePath}.map`).catch(() => {});
}

/**
 * Long-running Node server (`dist/index.mjs`): keep broad externals so esbuild stays fast
 * and optional native deps resolve from node_modules at runtime.
 */
const EXTERNALS_NODE_SERVER = [
  "*.node",
  "sharp",
  "better-sqlite3",
  "sqlite3",
  "canvas",
  "bcrypt",
  "argon2",
  "fsevents",
  "re2",
  "farmhash",
  "xxhash-addon",
  "bufferutil",
  "utf-8-validate",
  "ssh2",
  "cpu-features",
  "dtrace-provider",
  "isolated-vm",
  "lightningcss",
  "pg-native",
  "oracledb",
  "mongodb-client-encryption",
  "nodemailer",
  "handlebars",
  "knex",
  "typeorm",
  "protobufjs",
  "onnxruntime-node",
  "@tensorflow/*",
  "@prisma/client",
  "@mikro-orm/*",
  "@grpc/*",
  "@swc/*",
  "@aws-sdk/*",
  "@azure/*",
  "@opentelemetry/*",
  "@google-cloud/*",
  "googleapis",
  "firebase-admin",
  "@parcel/watcher",
  "@sentry/profiling-node",
  "@tree-sitter/*",
  "aws-sdk",
  "classic-level",
  "dd-trace",
  "ffi-napi",
  "grpc",
  "hiredis",
  "kerberos",
  "leveldown",
  "miniflare",
  "mysql2",
  "newrelic",
  "odbc",
  "piscina",
  "realm",
  "ref-napi",
  "rocksdb",
  "sass-embedded",
  "sequelize",
  "serialport",
  "snappy",
  "tinypool",
  "usb",
  "workerd",
  "wrangler",
  "zeromq",
  "zeromq-prebuilt",
  "playwright",
  "puppeteer",
  "puppeteer-core",
  "electron",
];

/**
 * Vercel serverless (`vercel-app.mjs`): the lambda does not ship a usable node_modules
 * tree for bare imports. Bundle all JS dependencies except known-native / unbundleable packages.
 * (Do not add wide patterns like `@google-cloud/*` here — that caused ERR_MODULE_NOT_FOUND.)
 */
const EXTERNALS_VERCEL_SERVERLESS = [
  "*.node",
  "sharp",
  "better-sqlite3",
  "sqlite3",
  "canvas",
  "bcrypt",
  "argon2",
  "fsevents",
  "re2",
  "farmhash",
  "xxhash-addon",
  "bufferutil",
  "utf-8-validate",
  "ssh2",
  "cpu-features",
  "dtrace-provider",
  "isolated-vm",
  "lightningcss",
  "pg-native",
  "oracledb",
  "mongodb-client-encryption",
  "onnxruntime-node",
  "@tensorflow/*",
  "@sentry/profiling-node",
  "ffi-napi",
  "puppeteer",
  "puppeteer-core",
  "electron",
  "usb",
  "serialport",
  "snappy",
  "leveldown",
  "rocksdb",
  "realm",
  "ref-napi",
];

const ESBUILD_BANNER = {
  js: `import { createRequire as __bannerCrReq } from 'node:module';
import __bannerPath from 'node:path';
import __bannerUrl from 'node:url';

globalThis.require = __bannerCrReq(import.meta.url);
globalThis.__filename = __bannerUrl.fileURLToPath(import.meta.url);
globalThis.__dirname = __bannerPath.dirname(globalThis.__filename);
`,
};

const ESBUILD_PLUGINS = [
  esbuildPluginPino({ transports: ["pino-pretty"] }),
];

async function buildAll() {
  const distDir = path.resolve(artifactDir, "dist");
  await rm(distDir, { recursive: true, force: true });

  const shared = {
    platform: "node",
    bundle: true,
    format: "esm",
    outdir: distDir,
    outExtension: { ".js": ".mjs" },
    logLevel: "info",
    sourcemap: "linked",
    plugins: ESBUILD_PLUGINS,
    banner: ESBUILD_BANNER,
  };

  await esbuild({
    ...shared,
    entryPoints: [path.resolve(artifactDir, "src/index.ts")],
    external: EXTERNALS_NODE_SERVER,
  });

  await esbuild({
    ...shared,
    entryPoints: [path.resolve(artifactDir, "src/vercel-app.ts")],
    external: EXTERNALS_VERCEL_SERVERLESS,
  });

  const vercelBundle = path.join(distDir, "vercel-app.mjs");
  await stripLinkedSourcemap(vercelBundle);

  const repoApiDir = path.resolve(artifactDir, "..", "..", "api");
  await mkdir(repoApiDir, { recursive: true });
  await copyFile(vercelBundle, path.join(repoApiDir, "vercel-app.mjs"));

  // Vercel `outputDirectory` must not point at this package root: that folder includes
  // `src/**/*.ts`, and Vercel runs TypeScript with NodeNext on it (TS2834, Express/pino-http).
  // Ship only static HTML/CSS/JS in `deploy/` and point vercel.json there.
  const deployDir = path.resolve(artifactDir, "deploy");
  await rm(deployDir, { recursive: true, force: true });
  await mkdir(deployDir, { recursive: true });
  for (const file of ["index.html", "site.js", "styles.css", "alpha-icon.svg"]) {
    await copyFile(path.join(artifactDir, file), path.join(deployDir, file));
  }
  const mobileAppIconPng = path.resolve(artifactDir, "..", "mobile", "assets", "images", "icon.png");
  await copyFile(mobileAppIconPng, path.join(deployDir, "favicon.png")).catch(() => {});
  for (const dir of ["privacy", "terms", "support", "contact", "sales-portal"]) {
    await cp(path.join(artifactDir, dir), path.join(deployDir, dir), { recursive: true });
  }

  await buildAdminPortal(deployDir);
}

async function buildAdminPortal(deployDir) {
  const adminPortalDir = path.resolve(artifactDir, "..", "admin-portal");

  try {
    await stat(adminPortalDir);
  } catch {
    console.warn("[build] admin-portal directory not found; skipping admin SPA build.");
    return;
  }

  console.log("[build] building admin portal SPA…");
  await new Promise((resolve, reject) => {
    const proc = spawn("pnpm", ["--filter", "@workspace/admin-portal", "run", "build"], {
      cwd: path.resolve(artifactDir, "..", ".."),
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    proc.on("error", reject);
    proc.on("exit", (code) => {
      if (code === 0) resolve(undefined);
      else reject(new Error(`admin-portal build exited with code ${code}`));
    });
  });

  const adminDist = path.join(adminPortalDir, "dist");
  const adminDeploy = path.join(deployDir, "admin");
  await rm(adminDeploy, { recursive: true, force: true });
  await cp(adminDist, adminDeploy, { recursive: true });
  console.log(`[build] copied admin SPA → ${adminDeploy}`);
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
