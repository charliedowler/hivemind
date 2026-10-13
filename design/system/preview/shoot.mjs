import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const require = createRequire(process.env.PLAYWRIGHT_FROM ?? import.meta.url);
const { chromium } = require("playwright");

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await page.goto(pathToFileURL(join(root, "preview.html")).href, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: join(root, "preview.png"), fullPage: true });
const crops = process.env.PREVIEW_CROPS;
if (crops) {
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let top = 0, index = 0; top < height; top += 1500, index += 1) {
    await page.screenshot({ path: join(crops, `crop-${String(index).padStart(2, "0")}.png`), clip: { x: 0, y: top, width: 1440, height: Math.min(1500, height - top) }, fullPage: true });
  }
  console.log(`height ${height}`);
}
await browser.close();
