import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build as esbuild } from "esbuild";
import esbuildPluginPino from "esbuild-plugin-pino";
import { copyFile, cp, mkdir, readFile, rm, unlink, writeFile } from "node:fs/promises";

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

async function buildAll() {
  const distDir = path.resolve(artifactDir, "dist");
  await rm(distDir, { recursive: true, force: true });

  await esbuild({
    entryPoints: [
      path.resolve(artifactDir, "src/index.ts"),
      path.resolve(artifactDir, "src/vercel-app.ts"),
    ],
    platform: "node",
    bundle: true,
    format: "esm",
    outdir: distDir,
    outExtension: { ".js": ".mjs" },
    logLevel: "info",
    // Some packages may not be bundleable, so we externalize them, we can add more here as needed.
    // Some of the packages below may not be imported or installed, but we're adding them in case they are in the future.
    // Examples of unbundleable packages:
    // - uses native modules and loads them dynamically (e.g. sharp)
    // - use path traversal to read files (e.g. @google-cloud/secret-manager loads sibling .proto files)
    external: [
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
      "@google/*",
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
    ],
    sourcemap: "linked",
    plugins: [
      // pino relies on workers to handle logging, instead of externalizing it we use a plugin to handle it
      esbuildPluginPino({ transports: ["pino-pretty"] })
    ],
    // Make sure packages that are cjs only (e.g. express) but are bundled continue to work in our esm output file
    banner: {
      js: `import { createRequire as __bannerCrReq } from 'node:module';
import __bannerPath from 'node:path';
import __bannerUrl from 'node:url';

globalThis.require = __bannerCrReq(import.meta.url);
globalThis.__filename = __bannerUrl.fileURLToPath(import.meta.url);
globalThis.__dirname = __bannerPath.dirname(globalThis.__filename);
    `,
    },
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
  for (const dir of ["privacy", "terms", "support", "contact"]) {
    await cp(path.join(artifactDir, dir), path.join(deployDir, dir), { recursive: true });
  }
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
