// Vercel build step: point the static pages at the game server running on Render.
import { writeFileSync } from 'node:fs';

const url = (process.env.QS_BACKEND_URL ?? '').trim().replace(/\/+$/, '');
if (!url) {
  console.error('QS_BACKEND_URL is not set. Add it in Vercel → Settings → Environment Variables,');
  console.error('e.g. https://quipsmash-server.onrender.com, then redeploy.');
  process.exit(1);
}
if (!/^https?:\/\//.test(url)) {
  console.error(`QS_BACKEND_URL must start with https:// (got "${url}")`);
  process.exit(1);
}
writeFileSync(new URL('../public/js/config.js', import.meta.url),
  `// Generated at build time by scripts/write-config.js — do not edit.\nexport const BACKEND_URL = ${JSON.stringify(url)};\n`);
console.log(`Game server: ${url}`);
