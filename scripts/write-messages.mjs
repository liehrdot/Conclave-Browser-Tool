import { mkdirSync, writeFileSync } from "node:fs";
import { MESSAGES } from "./messages.mjs";

export function build(lang) {
  const i = lang === "de" ? 1 : 0;
  const out = {};
  for (const [key, texts] of Object.entries(MESSAGES)) out[key] = { message: texts[i] };
  return JSON.stringify(out, null, 2) + "\n";
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const lang of ["en", "de"]) {
    const dir = new URL(`../extension/_locales/${lang}/`, import.meta.url);
    mkdirSync(dir, { recursive: true });
    writeFileSync(new URL("messages.json", dir), build(lang));
  }
}
