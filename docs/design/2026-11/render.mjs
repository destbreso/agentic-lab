// Renders each sheet (html/NN-*.html) to sheets/NN-*.png at 1440x900, 2x.
// PLAYWRIGHT is the path of a Playwright install, CHROMIUM a Chromium or headless-shell binary.
//   PLAYWRIGHT=... CHROMIUM=... node render.mjs . [NN]
import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";
const { chromium } = await import(process.env.PLAYWRIGHT + "/index.mjs");
const root = resolve(process.argv[2] ?? ".");
const only = process.argv[3];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  for (const f of readdirSync(join(root, "html")).filter((f) => /^\d\d-.*\.html$/.test(f)).sort()) {
    if (only && !f.startsWith(only)) continue;
    await page.goto("file://" + join(root, "html", f));
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(150);
    const out = join(root, "sheets", f.replace(/\.html$/, ".png"));
    await page.screenshot({ path: out });
    const over = await page.evaluate(() => [...document.querySelectorAll("[data-fit]")].filter((e) => e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1).map((e) => e.dataset.fit));
    console.log("wrote", out, over.length ? "OVERFLOW: " + over.join(",") : "");
  }
} finally { await browser.close(); }
