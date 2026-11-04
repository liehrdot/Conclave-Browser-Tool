// The extension's rules (extension/lib/cart.js) against pages shaped like Cardmarket's. Offline.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { JSDOM } from "jsdom";

const require = createRequire(import.meta.url);
const C = require("../extension/lib/cart.js");
const page = (name, url = "https://www.cardmarket.com/en/Magic/ShoppingCart") =>
  new JSDOM(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"), { url }).window.document;
const html = (body, url = "https://www.cardmarket.com/en/Magic/ShoppingCart") => new JSDOM(`<body>${body}</body>`, { url }).window.document;

test("prices are read the way Cardmarket writes them", () => {
  assert.equal(C.parsePrice("1,49 €"), 1.49);
  assert.equal(C.parsePrice("1.234,50 €"), 1234.5);
  assert.equal(C.parsePrice("0,02"), 0.02);
  assert.equal(C.parsePrice("–"), null);
});

test("slugs follow Cardmarket's URLs", () => {
  assert.equal(C.slugOf("Hero of Bladehold"), "Hero-of-Bladehold");
  assert.equal(C.slugOf("Tocasia's Welcome"), "Tocasias-Welcome");
  assert.equal(C.slugOf("Sheoldred, the Apocalypse"), "Sheoldred-the-Apocalypse");
});

test("offer rows give id, card, condition, price, language and stock without mixing stock into the price", () => {
  const offers = C.parseOffers(page("offers.html"), "https://www.cardmarket.com/en/Magic/Users/PapaSven/Offers/Singles");
  assert.equal(offers.length, 2);
  assert.deepEqual(offers[0], {
    id: "2183623163", seller: "PapaSven", set: "Modern-Horizons", slug: "Hero-of-Bladehold", name: "Hero of Bladehold",
    cond: "NM", price: 1.49, lang: "English", max: 3,
  });
  assert.equal(offers[1].price, 7.67);  // the row also says "7" in stock: never 77,67
});

test("the add-to-cart form is Cardmarket's own one in an offer row", () => {
  const f = C.addForm(page("offers.html"));
  assert.ok(f);
  assert.equal(f.getAttribute("data-ajax-action"), "ShoppingCart_Add_AddArticlesFromUserOffers");
  assert.equal(C.addForm(page("cart.html")), null);
});

test("the cart is read per article with its seller and amount", () => {
  const cart = C.parseCart(page("cart.html"));
  assert.equal(cart.items.length, 4);
  const byId = Object.fromEntries(cart.items.map((i) => [i.id, i]));
  assert.equal(byId["2183623163"].seller, "PapaSven");
  assert.equal(byId["2102303005"].seller, "cernyrytir");
  assert.equal(byId["2102303005"].qty, 6);
  assert.equal(byId["2145517710"].name, "Sheoldred, the Apocalypse");
  assert.equal(byId["2145517710"].cond, "EX");
  assert.equal(byId["2145517710"].price, 64.9);
  assert.deepEqual(cart.totals, { sellers: 2, articles: 9, value: 74.18, shipping: 3.3, total: 77.68 });
  assert.equal(cart.empty, false);
});

test("the cart reader also finds ids in row ids, idArticle[…] fields and links", () => {
  const doc = html(`
    <div><a href="/en/Magic/Users/Kluzut">Kluzut</a>
      <div id="articleRow2062969028"><a href="/en/Magic/Products/Singles/Zendikar/Scute-Mob">Scute Mob</a><span class="color-primary">0,30 €</span></div>
      <div class="row"><a href="/en/Magic/Products/Singles/Alpha/Shivan-Dragon">Shivan Dragon</a>
        <input type="hidden" name="idArticle[1755976014]" value="1755976014"><select name="amount"><option>1</option><option selected>2</option></select></div>
      <div class="row"><a href="/en/Magic/Products/Singles/Ice-Age/Brainstorm?idArticle=1885567550">Brainstorm</a></div>
    </div>`);
  const cart = C.parseCart(doc);
  assert.deepEqual(cart.items.map((i) => [i.id, i.seller, i.slug, i.qty]), [
    ["2062969028", "Kluzut", "Scute-Mob", 1], ["1755976014", "Kluzut", "Shivan-Dragon", 2], ["1885567550", "Kluzut", "Brainstorm", 1],
  ]);
});

test("an id is never given to a container that holds several articles", () => {
  const doc = html(`<section data-article-id="999999999"><a href="/en/Magic/Users/X">X</a>
    <div data-article-id="111111111"><a href="/en/Magic/Products/Singles/A/One">One</a></div>
    <div data-article-id="222222222"><a href="/en/Magic/Products/Singles/A/Two">Two</a></div></section>`);
  assert.deepEqual(C.parseCart(doc).items.map((i) => i.id), ["111111111", "222222222"]);
});

test("an empty cart is told apart from a cart the reader can't read", () => {
  assert.equal(C.parseCart(page("cart-empty.html")).empty, true);
  assert.equal(C.parseCart(html("<p>something new</p>")).empty, false);
});

test("Cloudflare's check is noticed in a page and in fetched HTML", () => {
  assert.equal(C.isChallenge(page("challenge.html")), true);
  assert.equal(C.isChallenge(readFileSync(new URL("./fixtures/challenge.html", import.meta.url), "utf8")), true);
  assert.equal(C.isChallenge("<html><head><title>Attention Required! | Cloudflare</title></head></html>"), true);
  assert.equal(C.isChallenge(page("cart.html")), false);
});

test("a snapshot keeps the articles and their totals", () => {
  const s = C.makeSnapshot(C.parseCart(page("cart.html")), { name: "Zurgo", now: new Date("2026-11-04T10:00:00Z") });
  assert.equal(s.name, "Zurgo");
  assert.equal(s.created, "2026-11-04T10:00:00.000Z");
  assert.deepEqual(s.totals, { sellers: 2, articles: 9, value: 74.18, shipping: 3.3, total: 77.68 });
  assert.match(s.id, /^s/);
});

test("restoring sends one idArticle/amount pair per article", () => {
  assert.deepEqual(C.restoreFields([{ id: "1", qty: 1 }, { id: "2", qty: 6 }]),
    [["idArticle[1]", "1"], ["amount[1]", "1"], ["idArticle[2]", "2"], ["amount[2]", "6"]]);
  assert.equal(C.formSeller([{ seller: "A" }, { seller: "B" }, { seller: "B" }]), "B");
  assert.equal(C.offersUrl("Herr Dingenskirchen"), "https://www.cardmarket.com/en/Magic/Users/Herr%20Dingenskirchen/Offers/Singles");
});

test("comparing finds what is missing, fewer, pricier and extra", () => {
  const cart = C.parseCart(page("cart.html"));
  const s = C.makeSnapshot(cart);
  assert.equal(C.diffCart(s, cart).ok, true);
  s.items.push({ id: "123456789", seller: "Sebjoker", name: "Sol Ring", price: 1, qty: 1 });
  s.items.find((i) => i.id === "2102303005").qty = 8;
  s.items.find((i) => i.id === "2145517710").price = 59.9;
  const d = C.diffCart(s, { items: cart.items.filter((i) => i.id !== "2183623163").concat({ id: "777777777", qty: 1 }) });
  assert.equal(d.ok, false);
  assert.deepEqual(d.missing.map((i) => i.id).sort(), ["123456789", "2183623163"]);
  assert.deepEqual(d.fewer.map((i) => [i.id, i.have, i.qty]), [["2102303005", 6, 8]]);
  assert.deepEqual(d.pricier.map((i) => [i.id, i.now]), [["2145517710", 64.9]]);
  assert.deepEqual(d.extra.map((i) => i.id), ["777777777"]);
  assert.deepEqual(d.foreign.map((i) => i.id), ["2145517710"]);  // the German Sheoldred
});

test("languages are read from the flag's label or tooltip, and other languages are pointed out", () => {
  const cart = C.parseCart(page("cart.html"));
  assert.equal(cart.items.find((i) => i.id === "2145517710").lang, "German");
  const doc = html(`<div><a href="/en/Magic/Users/X">X</a><div data-article-id="333333333">
    <a href="/en/Magic/Products/Singles/A/Divine-Visitation">Divine Visitation</a>
    <span class="icon" data-bs-original-title="Russian"></span><span title="Remove"></span></div></div>`);
  const r = C.parseCart(doc);
  assert.equal(r.items[0].lang, "Russian");
  const d = C.diffCart(C.makeSnapshot(r), r);
  assert.equal(d.ok, true);
  assert.deepEqual(d.foreign.map((i) => [i.id, i.lang]), [["333333333", "Russian"]]);
  assert.deepEqual(C.diffCart(C.makeSnapshot(cart), cart).foreign.map((i) => i.id), ["2145517710"]);
});

test("snapshots go out as text and come back, and the method doc's short form is read too", () => {
  const s = C.makeSnapshot(C.parseCart(page("cart.html")), { name: "Zurgo" });
  const back = C.importSnapshot(C.exportSnapshot(s));
  assert.equal(back.name, "Zurgo");
  assert.deepEqual(back.items, s.items);
  const doc = C.importSnapshot(JSON.stringify({ PapaSven: ["2164329369", "2183623163"], cernyrytir: ["2102303005x6"] }));
  assert.deepEqual(doc.items.map((i) => [i.seller, i.id, i.qty]), [["PapaSven", "2164329369", 1], ["PapaSven", "2183623163", 1], ["cernyrytir", "2102303005", 6]]);
  assert.equal(doc.totals.articles, 8);
  assert.equal(doc.totals.value, null);
  assert.throws(() => C.importSnapshot("hello"), /not-json/);
  assert.throws(() => C.importSnapshot("{}"), /no-articles/);
});

test("sameItems ignores order", () => {
  assert.equal(C.sameItems([{ id: "1", qty: 1 }, { id: "2", qty: 2 }], [{ id: "2", qty: 2 }, { id: "1" }]), true);
  assert.equal(C.sameItems([{ id: "1", qty: 1 }], [{ id: "1", qty: 2 }]), false);
});

test("the remove-all button is found on the cart page", () => {
  assert.equal(C.removeAllButton(page("cart.html")).value, "Remove all articles");
  assert.equal(C.removeAllButton(page("offers.html")), null);
});

test("page info holds the structure, never names or prices", () => {
  const info = C.pageInfo(page("cart.html"));
  assert.ok(info.includes("data-article-id"));
  assert.ok(!info.includes("Sheoldred"));
  assert.ok(!info.includes("64,90"));
});
