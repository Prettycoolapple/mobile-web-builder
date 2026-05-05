/**
 * Rasterize artifacts/mobile/assets/images/icon.svg → icon.png (1024×1024) for Expo.
 * Run from repo root: pnpm --filter @workspace/scripts exec tsx ./src/rasterizeAppIcon.ts
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const root = path.resolve(import.meta.dirname, "../..");
const svgPath = path.join(root, "artifacts/mobile/assets/images/icon.svg");
const outPath = path.join(root, "artifacts/mobile/assets/images/icon.png");

async function main() {
  const svg = fs.readFileSync(svgPath);
  await sharp(svg, { density: 288 })
    .resize(1024, 1024, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(outPath);
  console.log("Wrote", outPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
