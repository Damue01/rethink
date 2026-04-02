import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import pngToIco from "png-to-ico";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const sourceSvg = path.join(ROOT, "build", "icons", "source.svg");
const outDir = path.join(ROOT, "build", "icons", "generated");
const publicDir = path.join(ROOT, "public");

const sizes = [16, 24, 32, 48, 64, 128, 256];

await fs.mkdir(outDir, { recursive: true });
await fs.mkdir(publicDir, { recursive: true });

const svgBuffer = await fs.readFile(sourceSvg);
const pngFiles = [];

for (const size of sizes) {
  const outPath = path.join(outDir, `app-${size}.png`);
  await sharp(svgBuffer)
    .resize(size, size)
    .png()
    .toFile(outPath);
  pngFiles.push(outPath);
}

const icoBuffer = await pngToIco(pngFiles);
await fs.writeFile(path.join(outDir, "app.ico"), icoBuffer);

await fs.copyFile(
  path.join(outDir, "app-256.png"),
  path.join(outDir, "app.png"),
);

await fs.copyFile(
  path.join(outDir, "app-256.png"),
  path.join(publicDir, "app-256.png"),
);

await fs.copyFile(
  path.join(outDir, "app.ico"),
  path.join(publicDir, "app.ico"),
);

console.log("Generated icons:", path.relative(ROOT, outDir));