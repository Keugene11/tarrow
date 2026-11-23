// Renders app icon + splash PNGs for @capacitor/assets. Usage: node scripts/make-icons.mjs
import { chromium } from "playwright";

const glyph = (stroke) => `<path d="M9 10.5h14M16 10.5v11.5" stroke="${stroke}" stroke-width="2.6" stroke-linecap="round" fill="none"/><path d="M12.2 18.4 16 22.2l3.8-3.8" stroke="${stroke}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`;
const shots = [
  // Full-bleed icon: the OS applies its own corner mask.
  { file: "assets/icon-only.png", size: 1024, svg: `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 32 32"><rect width="32" height="32" fill="#0a0a0a"/><g transform="translate(16 16) scale(1.25) translate(-16 -16.2)">${glyph("#fff")}</g></svg>` },
  // Android adaptive icon: glyph inside the 66% safe zone on transparent, plus solid background.
  { file: "assets/icon-foreground.png", size: 1024, transparent: true, svg: `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 32 32"><g transform="translate(16 16) scale(0.95) translate(-16 -16.2)">${glyph("#fff")}</g></svg>` },
  { file: "assets/icon-background.png", size: 1024, svg: `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="1024" height="1024" fill="#0a0a0a"/></svg>` },
  { file: "assets/splash.png", size: 2732, svg: `<svg xmlns="http://www.w3.org/2000/svg" width="2732" height="2732" viewBox="0 0 2732 2732"><rect width="2732" height="2732" fill="#ffffff"/><g transform="translate(1366 1366) scale(12) translate(-16 -16)"><rect width="32" height="32" rx="9" fill="#0a0a0a"/>${glyph("#fff")}</g></svg>` },
  { file: "assets/splash-dark.png", size: 2732, svg: `<svg xmlns="http://www.w3.org/2000/svg" width="2732" height="2732" viewBox="0 0 2732 2732"><rect width="2732" height="2732" fill="#ffffff"/><g transform="translate(1366 1366) scale(12) translate(-16 -16)"><rect width="32" height="32" rx="9" fill="#0a0a0a"/>${glyph("#fff")}</g></svg>` },
  { file: "public/icon-512.png", size: 512, svg: `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 32 32"><rect width="32" height="32" fill="#0a0a0a"/><g transform="translate(16 16) scale(1.25) translate(-16 -16.2)">${glyph("#fff")}</g></svg>` },
];

const browser = await chromium.launch();
for (const s of shots) {
  const page = await browser.newPage({ viewport: { width: s.size, height: s.size } });
  await page.setContent(`<html><body style="margin:0;background:transparent">${s.svg}</body></html>`);
  await page.locator("svg").screenshot({ path: s.file, omitBackground: !!s.transparent });
  await page.close();
  console.log("wrote", s.file);
}
await browser.close();
