// The extension as a whole: manifest, texts in both languages, files it names.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { build } from "../scripts/write-messages.mjs";
import { MESSAGES } from "../scripts/messages.mjs";

const ext = (p) => new URL(`../extension/${p}`, import.meta.url);
const manifest = JSON.parse(readFileSync(ext("manifest.json"), "utf8"));

test("the messages files are up to date (run npm run messages)", () => {
  for (const lang of ["en", "de"]) assert.equal(readFileSync(ext(`_locales/${lang}/messages.json`), "utf8"), build(lang), lang);
});

test("every text the panel uses exists, in English and German", () => {
  const code = readFileSync(ext("content.js"), "utf8");
  const used = new Set([...code.matchAll(/\bt\("([A-Za-z]+)"/g)].map((m) => m[1]));
  for (const m of code.matchAll(/\bt\([^"()]*\? "([A-Za-z]+)" : "([A-Za-z]+)"/g)) { used.add(m[1]); used.add(m[2]); }
  for (const key of used) {
    assert.ok(MESSAGES[key], `missing text ${key}`);
    assert.ok(MESSAGES[key][0] && MESSAGES[key][1], `text ${key} needs both languages`);
  }
  for (const [key, [en, de]] of Object.entries(MESSAGES)) {
    const n = (s) => (s.match(/\$\d/g) || []).sort().join();
    assert.equal(n(en), n(de), `${key}: both languages fill in the same $1 …`);
  }
});

test("the manifest is Manifest V3, only for cardmarket.com, and every file it names exists", () => {
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.host_permissions, ["https://www.cardmarket.com/*"]);
  assert.deepEqual(manifest.permissions, ["storage"]);
  const files = [manifest.background.service_worker, ...manifest.content_scripts.flatMap((c) => c.js),
    ...Object.values(manifest.icons), ...Object.values(manifest.action.default_icon),
    ...manifest.web_accessible_resources.flatMap((w) => w.resources)];
  for (const f of files) assert.ok(existsSync(ext(f)), f);
  assert.equal(manifest.version, JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version);
});

test("the extension never goes near checkout", () => {
  for (const f of ["content.js", "lib/cart.js", "background.js"]) {
    assert.ok(!/checkout/i.test(readFileSync(ext(f), "utf8").replace(/\/\/.*$/gm, "")), f);
  }
});
