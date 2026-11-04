// The extension's rules, without any screen or browser API: reading Cardmarket's pages, building and comparing
// snapshots. The content script loads this file first (it sets globalThis.ConclaveCart); the tests require() it.
// Method: docs/how-it-works.md (Flo's notes from restoring a 63-card cart by hand with Claude in Chrome).
(function (root) {
  "use strict";

  const BASE = "https://www.cardmarket.com";
  const CART_PATH = "/en/Magic/ShoppingCart";
  // Cardmarket asked for slow traffic: at least this long between two requests the extension makes.
  const MIN_GAP_MS = 2500;
  const CONDITIONS = ["MT", "NM", "EX", "GD", "LP", "PL", "PO"];

  // ---- Cloudflare's "Just a moment …" check: never try to get around it, stop and let the person solve it ----
  const CHALLENGE = /cf-chl|challenge-platform|cf_chl_opt|<title>\s*(?:Just a moment|Attention Required! \| Cloudflare)|Checking your browser before/i;
  function isChallenge(page) {
    if (page == null) return false;
    if (typeof page === "string") return CHALLENGE.test(page);
    const html = page.documentElement ? page.documentElement.outerHTML : "";
    return CHALLENGE.test(html) || /^\s*Just a moment/i.test(page.title || "");
  }

  // ---- numbers: Cardmarket writes 1.234,56 € on every language's pages ----
  function parsePrice(text) {
    if (text == null) return null;
    const m = String(text).replace(/\s/g, "").match(/-?[\d.]*\d(?:,\d+)?/);
    if (!m) return null;
    const n = Number(m[0].replace(/\./g, "").replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  const sameMoney = (a, b) => a != null && b != null && Math.abs(a - b) < 0.005;

  // "Hero of Bladehold" → "Hero-of-Bladehold", "Tocasia's Welcome" → "Tocasias-Welcome" (as in Cardmarket's URLs)
  function slugOf(name) {
    return String(name || "").split(" // ")[0].normalize("NFKD").replace(/[̀-ͯ]/g, "")
      .replace(/['’,.:!?"()]/g, "").trim().replace(/[\s/]+/g, "-").replace(/-+/g, "-");
  }
  // "/en/Magic/Products/Singles/Modern-Horizons/Hero-of-Bladehold" → {set, card}
  function productOf(href) {
    const parts = String(href || "").split(/[?#]/)[0].split("/");
    const i = parts.indexOf("Singles");
    return i < 0 ? { set: "", card: "" } : { set: parts[i + 1] || "", card: parts[i + 2] || "" };
  }
  const nameFromSlug = (slug) => decodeURIComponent(slug || "").replace(/-/g, " ").trim();
  const sellerOf = (href) => {
    const m = String(href || "").match(/\/Users\/([^/?#]+)/);
    return m ? decodeURIComponent(m[1]) : "";
  };

  // The language sits on the flag icon (.icon.me-2) as aria-label or tooltip title. Flo's notes: always check it,
  // a Russian and two German cards slipped into an English cart once.
  const LANGUAGES = ["English", "German", "French", "Spanish", "Italian", "Portuguese", "Russian", "Japanese", "Korean",
    "S-Chinese", "T-Chinese", "Simplified Chinese", "Traditional Chinese"];
  function langIn(row) {
    for (const n of row.querySelectorAll(".icon.me-2, [aria-label], [data-bs-original-title], [title]")) {
      for (const a of ["aria-label", "data-bs-original-title", "title"]) {
        const v = (n.getAttribute(a) || "").trim();
        if (LANGUAGES.some((l) => l.toLowerCase() === v.toLowerCase())) return v;
      }
    }
    return "";
  }

  // ---- one article row (an offer page's stockRow, or a row in the cart) ----
  // The doc's lesson: never read the whole row's text, the stock count sticks to the price ("7" + "7,67 €" = "77,67 €").
  function readRow(row) {
    const sel = 'a[href*="/Products/Singles/"]';
    const link = row.matches(sel) ? row : row.querySelector(sel);
    const { set, card } = productOf(link && link.getAttribute("href"));
    const price = row.querySelector("span.color-primary, .price-container span, [class*='price']");
    const badge = [...row.querySelectorAll("span.badge, .article-condition span, [class*='condition']")]
      .map((b) => b.textContent.trim().toUpperCase()).find((t) => CONDITIONS.includes(t));
    const name = (link && link.textContent.trim()) || nameFromSlug(card);
    return {
      set, slug: card, name,
      cond: badge || "",
      price: price ? parsePrice(price.textContent) : null,
      lang: langIn(row),
    };
  }

  // ---- offer pages: /en/Magic/Users/<seller>/Offers/Singles?name=… ----
  function parseOffers(doc, url) {
    const seller = sellerOf(url || (doc.location && doc.location.href));
    return [...doc.querySelectorAll('[id^="stockRow"]')].map((r) => {
      const sel = r.querySelector("select");
      return { id: r.id.replace("stockRow", ""), seller, ...readRow(r), max: sel ? sel.options.length : 1 };
    }).filter((o) => /^\d+$/.test(o.id));
  }
  // The add-to-cart form Cardmarket's own script listens to (a self-built form gets no handler and reloads the page).
  const addForm = (doc) => doc.querySelector('[id^="stockRow"] form[data-ajax-action*="ShoppingCart"], [id^="stockRow"] form[data-ajax-action]');

  // ---- the cart page: /en/Magic/ShoppingCart ----
  // The cart's markup isn't in the doc, so its article ids are looked for in every place Cardmarket puts them on
  // other pages: data attributes, row ids, form fields and links. "Copy page info" helps when none of them fits.
  const ID_ATTRS = ["data-article-id", "data-id-article", "data-idarticle", "data-id-amount", "data-article"];
  function idsIn(el) {
    const found = [];
    for (const a of ID_ATTRS) {
      const v = el.getAttribute && el.getAttribute(a);
      if (v && /^\d{5,}$/.test(v)) found.push(v);
    }
    const idm = el.id && el.id.match(/^(?:article|stock|cartArticle|shoppingCartArticle)Row(\d{5,})$/i);
    if (idm) found.push(idm[1]);
    const name = el.getAttribute && el.getAttribute("name");
    const nm = name && name.match(/^idArticle\[(\d{5,})\]$/);
    if (nm) found.push(nm[1]);
    else if (name === "idArticle" && /^\d{5,}$/.test(el.value || "")) found.push(el.value);
    const href = el.getAttribute && el.getAttribute("href");
    const hm = href && href.match(/[?&]idArticle=(\d{5,})/);
    if (hm) found.push(hm[1]);
    return found;
  }
  // the smallest ancestor that is one article: it holds a card link and no other article's id
  function rowFor(el, id) {
    let best = null;
    for (let n = el; n && n.nodeType === 1 && n.tagName !== "BODY"; n = n.parentElement) {
      if (n.querySelector('a[href*="/Products/Singles/"]') || (n.matches && n.matches('a[href*="/Products/Singles/"]'))) { best = n; break; }
    }
    if (!best) return null;
    // grow to the full row (tr or a *Row element) if the card link sits in a nested cell
    const wide = best.closest("tr, [id*='Row'], .article-row, [class*='article-row']");
    if (wide && !otherIds(wide, id)) best = wide;
    return otherIds(best, id) ? null : best;
  }
  function otherIds(n, id) {
    return [n, ...n.querySelectorAll("*")].some((x) => idsIn(x).some((v) => v !== id));
  }
  function qtyIn(row) {
    const sel = row.querySelector("select[name*='amount' i], select");
    if (sel && sel.value && /^\d+$/.test(sel.value)) return Number(sel.value);
    const inp = row.querySelector("input[name*='amount' i]:not([type=hidden]), input[type=number]");
    if (inp && /^\d+$/.test(inp.value || "")) return Number(inp.value);
    const d = row.getAttribute("data-amount") || (row.querySelector("[data-amount]") || { getAttribute: () => null }).getAttribute("data-amount");
    if (d && /^\d+$/.test(d)) return Number(d);
    for (const c of row.querySelectorAll(".amount, [class*='amount'], td, span")) {
      const m = c.children.length === 0 && c.textContent.trim().match(/^(\d{1,3})\s*x$/i);
      if (m) return Number(m[1]);
    }
    return 1;
  }
  function sellerFor(row) {
    for (let n = row.parentElement; n && n.tagName !== "BODY"; n = n.parentElement) {
      const a = [...n.querySelectorAll('a[href*="/Users/"]')].find((x) => !row.contains(x) && sellerOf(x.getAttribute("href")));
      if (a) return sellerOf(a.getAttribute("href"));
    }
    const own = row.querySelector('a[href*="/Users/"]');
    return own ? sellerOf(own.getAttribute("href")) : "";
  }
  function parseCart(doc) {
    const seen = new Map();
    for (const el of doc.querySelectorAll("[data-article-id], [data-id-article], [data-idarticle], [data-id-amount], [data-article], [id*='Row'], [name^='idArticle'], a[href*='idArticle=']")) {
      for (const id of idsIn(el)) {
        if (seen.has(id)) continue;
        const row = rowFor(el, id);
        if (!row) continue;
        seen.set(id, { id, seller: sellerFor(row), ...readRow(row), qty: qtyIn(row) });
      }
    }
    const items = [...seen.values()];
    return { items, totals: cartTotals(doc), empty: items.length === 0 && isEmptyCart(doc) };
  }
  function isEmptyCart(doc) {
    return /shopping cart is empty|Warenkorb ist leer|no articles in your shopping cart/i.test(doc.body ? doc.body.textContent : "");
  }
  // the summary at the end: "Amount of articles 63 Articles", "Article Value 147,54 €", "Shipping 21,85 €", "Total 169,59 €"
  function cartTotals(doc) {
    const text = (doc.body ? doc.body.textContent : "").replace(/\s+/g, " ");
    const money = (label) => {
      const m = text.match(new RegExp(`(?:${label})\\s*:?\\s*([\\d.]+,\\d{2})\\s*€`, "i"));
      return m ? parsePrice(m[1]) : null;
    };
    const count = (label) => {
      const m = text.match(new RegExp(`(?:${label})\\s*:?\\s*(\\d+)`, "i"));
      return m ? Number(m[1]) : null;
    };
    return {
      sellers: count("Number of shipments|Anzahl der Sendungen"),
      articles: count("Amount of articles|Anzahl der Artikel|Artikelanzahl"),
      value: money("Article Value|Artikelwert"),
      shipping: money("Shipping|Versandkosten|Versand"),
      total: money("Total|Gesamtsumme|Gesamt"),
    };
  }
  // The "Remove all articles" button on the cart page (no question asked by Cardmarket, so the extension asks).
  // Its label follows the page's language (/de/, /fr/ …), so it is found by any of those words or by what its form
  // does; the per-seller button ("Remove articles from this seller") is never taken.
  const REMOVE_ALL = /remove all|alle artikel|alles entfernen|warenkorb leeren|vider le panier|tous les articles|todos los art[ií]culos|vaciar|tutti gli articoli|svuota|todos os artigos/i;
  const PER_SELLER = /seller|verk[äa]ufer|h[äa]ndler|vendeur|vendedor|venditore/i;
  const REMOVE_ALL_ACTION = /RemoveAll|EmptyCart|ClearCart|DeleteAll|ShoppingCart_Remove(?!.*Article)/i;
  function removeAllButton(doc) {
    const label = (b) => [b.value, b.textContent, b.getAttribute("title"), b.getAttribute("aria-label")].filter(Boolean).join(" ").replace(/\s+/g, " ");
    const buttons = [...doc.querySelectorAll("input[type=submit], button, a[role=button], a.btn")];
    const byText = buttons.find((b) => REMOVE_ALL.test(label(b)) && !PER_SELLER.test(label(b)));
    if (byText) return byText;
    const form = [...doc.forms].find((f) => REMOVE_ALL_ACTION.test(`${f.getAttribute("data-ajax-action") || ""} ${f.getAttribute("action") || ""}`));
    return form ? form.querySelector("button[type=submit], input[type=submit], button:not([type])") : null;
  }
  // The English cart page: the panel's own wording matches it best, and every other language reaches the same cart.
  const onEnglish = (path) => /^\/en\//.test(path || "");

  // ---- snapshots ----
  function summary(items) {
    const sellers = new Set(items.map((i) => i.seller).filter(Boolean));
    const articles = items.reduce((s, i) => s + (i.qty || 1), 0);
    const priced = items.every((i) => i.price != null);
    const value = priced ? Math.round(items.reduce((s, i) => s + i.price * (i.qty || 1), 0) * 100) / 100 : null;
    return { sellers: sellers.size, articles, value };
  }
  function makeSnapshot(cart, { name, now = new Date() } = {}) {
    const items = cart.items.map(({ id, seller, name: n, slug, set, price, cond, lang, qty }) =>
      ({ id, seller, name: n, slug, set, price, cond, lang, qty: qty || 1 }));
    return {
      id: `s${now.getTime().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      name: name || "", created: now.toISOString(), items,
      totals: { ...summary(items), shipping: cart.totals ? cart.totals.shipping : null, total: cart.totals ? cart.totals.total : null },
    };
  }
  // Same articles in the same amounts (used to skip a second identical snapshot before emptying the cart).
  function sameItems(a, b) {
    const key = (items) => items.map((i) => `${i.id}x${i.qty || 1}`).sort().join(",");
    return key(a) === key(b);
  }

  // A snapshot as text to keep or share, and back. Also takes the doc's short form {"Seller": ["2183623163", "2102303005x6"]}.
  function exportSnapshot(s) {
    return JSON.stringify({ conclave: "cardmarket-cart", version: 1, name: s.name, created: s.created, items: s.items }, null, 1);
  }
  function importSnapshot(text, { now = new Date() } = {}) {
    let data;
    try { data = JSON.parse(text); } catch { throw new Error("not-json"); }
    let items;
    if (data && Array.isArray(data.items)) {
      items = data.items.filter((i) => i && /^\d+$/.test(String(i.id))).map((i) => ({
        id: String(i.id), seller: String(i.seller || ""), name: String(i.name || ""), slug: String(i.slug || ""), set: String(i.set || ""),
        price: typeof i.price === "number" ? i.price : parsePrice(i.price), cond: String(i.cond || ""), lang: String(i.lang || ""),
        qty: Math.max(1, Math.min(99, Number(i.qty) || 1)),
      }));
    } else if (data && typeof data === "object" && !Array.isArray(data)) {
      items = [];
      for (const [seller, ids] of Object.entries(data)) {
        if (!Array.isArray(ids)) continue;
        for (const raw of ids) {
          const m = String(raw).match(/^(\d+)(?:x(\d+))?$/);
          if (m) items.push({ id: m[1], seller, name: "", slug: "", set: "", price: null, cond: "", lang: "", qty: Math.min(99, Number(m[2] || 1)) });
        }
      }
    }
    if (!items || !items.length) throw new Error("no-articles");
    const s = makeSnapshot({ items, totals: null }, { name: (data && typeof data.name === "string" && data.name) || "", now });
    if (data && data.created) s.created = String(data.created);
    return s;
  }

  // ---- restoring: the field pairs for the one add-to-cart submit ----
  function restoreFields(items) {
    const fields = [];
    for (const i of items) {
      fields.push([`idArticle[${i.id}]`, i.id], [`amount[${i.id}]`, String(i.qty || 1)]);
    }
    return fields;
  }
  // the seller whose offer page holds the form to send (the one with most articles: likeliest to still have offers)
  function formSeller(items) {
    const n = new Map();
    for (const i of items) if (i.seller) n.set(i.seller, (n.get(i.seller) || 0) + 1);
    return [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "";
  }
  const offersUrl = (seller) => `${BASE}/en/Magic/Users/${encodeURIComponent(seller)}/Offers/Singles`;

  // ---- comparing a cart with a snapshot ----
  function diffCart(snapshot, cart) {
    const inCart = new Map(cart.items.map((i) => [i.id, i]));
    const want = new Map(snapshot.items.map((i) => [i.id, i]));
    const found = [], missing = [], fewer = [], pricier = [], extra = [], foreign = [];
    for (const w of snapshot.items) {
      const c = inCart.get(w.id);
      if (!c) { missing.push(w); continue; }
      found.push(w);
      if ((c.qty || 1) < (w.qty || 1)) fewer.push({ ...w, have: c.qty || 1 });
      if (w.price != null && c.price != null && !sameMoney(w.price, c.price)) pricier.push({ ...w, now: c.price });
      if (c.lang && c.lang !== "English") foreign.push({ ...w, lang: c.lang });
    }
    for (const c of cart.items) if (!want.has(c.id)) extra.push(c);
    const ok = !missing.length && !fewer.length && !pricier.length;
    // foreign: only shown, never "wrong" (a snapshot may hold a German card on purpose)
    return { ok, found, missing, fewer, pricier, extra, foreign };
  }

  // ---- "Copy page info": the shape of the article rows (tags, ids with digits hidden, classes, attribute names),
  // never names, prices or other text, for fixing the reader when Cardmarket's markup changes ----
  function pageInfo(doc) {
    const shape = (n) => {
      const attrs = [...n.attributes].map((a) => a.name).filter((a) => !["class", "id", "style", "href"].includes(a));
      return `${n.tagName.toLowerCase()}${n.id ? "#" + n.id.replace(/\d+/g, "N") : ""}${n.classList.length ? "." + [...n.classList].join(".") : ""}${attrs.length ? `[${attrs.join(",")}]` : ""}`;
    };
    const links = [...doc.querySelectorAll('a[href*="/Products/Singles/"]')].slice(0, 4);
    return JSON.stringify({
      path: doc.location ? doc.location.pathname : "",
      rows: links.map((a) => {
        const chain = [];
        for (let n = a; n && n.tagName !== "BODY" && chain.length < 8; n = n.parentElement) chain.push(shape(n));
        return chain;
      }),
      // the page's own button labels (Cardmarket's UI words, which change with the language), never card names
      buttons: [...doc.querySelectorAll("input[type=submit], button")].filter((b) => !b.closest("[id^='stockRow'], tr, [data-article-id]"))
        .map((b) => (b.value || b.textContent || b.getAttribute("title") || "").replace(/\s+/g, " ").trim().slice(0, 40)).filter(Boolean).slice(0, 20),
      ids: [...new Set([...doc.querySelectorAll("[id]")].map((n) => n.id).filter((id) => /\d{5,}/.test(id)).map((id) => id.replace(/\d+/g, "N")))].slice(0, 20),
      forms: [...doc.forms].slice(0, 16).map((f) => ({
        action: (f.getAttribute("action") || "").split("?")[0], ajax: f.getAttribute("data-ajax-action") || "",
        fields: [...f.elements].map((x) => (x.name || "").replace(/\d+/g, "N")).filter(Boolean).slice(0, 12),
      })),
      idAttrs: ID_ATTRS.filter((a) => doc.querySelector(`[${a}]`)),
    }, null, 1);
  }

  root.ConclaveCart = {
    BASE, CART_PATH, MIN_GAP_MS, isChallenge, parsePrice, slugOf, productOf, sellerOf, parseOffers, addForm, parseCart,
    cartTotals, removeAllButton, onEnglish, summary, makeSnapshot, sameItems, exportSnapshot, importSnapshot, restoreFields, formSeller,
    offersUrl, diffCart, pageInfo,
  };
  if (typeof module === "object" && module.exports) module.exports = root.ConclaveCart;
})(typeof globalThis !== "undefined" ? globalThis : this);
