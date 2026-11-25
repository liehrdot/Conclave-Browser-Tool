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
  // every quoted word inside a t(…) call, brackets balanced, so t(ok ? "a" : "b") and t(e.message === "x" ? "a" : "b") count too
  const used = new Set();
  for (const m of code.matchAll(/\bt\(/g)) {
    let depth = 1, end = m.index + m[0].length;
    for (; depth && end < code.length; end++) depth += code[end] === "(" ? 1 : code[end] === ")" ? -1 : 0;
    for (const k of code.slice(m.index + m[0].length, end - 1).matchAll(/"([A-Za-z]+)"/g)) used.add(k[1]);
  }
  assert.ok(used.has("importNotJson") && used.has("foundAll"), "the scan finds texts picked by a condition");
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

test("tripwire: the word checkout appears nowhere in the code (the rule: never automate checkout)", () => {
  for (const f of ["content.js", "lib/cart.js", "background.js"]) {
    assert.ok(!/checkout/i.test(readFileSync(ext(f), "utf8").replace(/\/\/.*$/gm, "")), f);
  }
});
