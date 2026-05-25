import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(__dirname, "../../pwa");
const dest = path.resolve(__dirname, "../public");

if (!existsSync(src)) {
  console.error(`copy-pwa: source ${src} not found (expected at build time, not at runtime)`);
  process.exit(0); // soft-exit so runtime starts don't fail
}

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });
console.log(`copy-pwa: ${src} → ${dest}`);
