// Generates PWA icons from an inline SVG. Run: node scripts/generate-icons.mjs
import sharp from "sharp";
import { mkdirSync } from "node:fs";

const mark = (pad) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="${pad ? 0 : 112}" fill="#3b35a6"/>
  <g transform="translate(${pad ? 96 : 64} ${pad ? 96 : 64}) scale(${pad ? 0.625 : 0.75})">
    <path d="M256 70c-38 0-68 30-68 68v100c0 38 30 68 68 68s68-30 68-68V138c0-38-30-68-68-68z" fill="#fff"/>
    <path d="M140 230v8c0 64 52 116 116 116s116-52 116-116v-8" fill="none" stroke="#fff" stroke-width="32" stroke-linecap="round"/>
    <path d="M256 354v52M196 420h120" stroke="#fff" stroke-width="32" stroke-linecap="round"/>
    <rect x="300" y="300" width="132" height="132" rx="24" fill="#8f8cff" stroke="#3b35a6" stroke-width="16"/>
    <path d="M330 366h72M366 330v72" stroke="#fff" stroke-width="18" stroke-linecap="round"/>
  </g>
</svg>`;

mkdirSync("public/icons", { recursive: true });
for (const [file, size, maskable] of [["icon-192.png", 192, false], ["icon-512.png", 512, false], ["icon-maskable-512.png", 512, true], ["apple-touch-icon.png", 180, true]]) {
  await sharp(Buffer.from(mark(maskable))).resize(size, size).png().toFile(`public/icons/${file}`);
}
await sharp(Buffer.from(mark(false))).resize(48, 48).png().toFile("src/app/icon.png");
console.log("icons written");
