// Runs on cardmarket.com (after lib/cart.js). It draws the Conclave panel and does what the person clicks:
// save the cart as a snapshot, put a snapshot back into the cart, compare, empty. Rules (docs/how-it-works.md):
// never touches checkout, waits MIN_GAP_MS between its own requests, stops at a Cloudflare check, asks before
// filling or emptying the cart. Steps that need another page (restore needs an offer page, the check needs the
// cart) are kept as a "job" in extension storage and carried on by the next page's content script.
(() => {
  "use strict";
  if (window.top !== window || window.__conclaveCart) return;
  window.__conclaveCart = true;
  const C = globalThis.ConclaveCart;
  const store = chrome.storage.local;
  const JOB_FOR = 3 * 60 * 1000;  // a job older than this was abandoned (tab closed, other page opened by hand)

  const t = (key, ...subs) => chrome.i18n.getMessage(key, subs.map(String)) || key;
  const lang = chrome.i18n.getUILanguage();
  const eur = (v) => v == null ? "–" : new Intl.NumberFormat(lang, { style: "currency", currency: "EUR" }).format(v);
  const date = (iso) => new Intl.DateTimeFormat(lang, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
  const onCart = () => location.pathname.replace(/\/+$/, "").endsWith("/ShoppingCart");
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---- storage ----
  const get = async (key, fallback) => (await store.get(key))[key] ?? fallback;
  const set = (key, value) => store.set({ [key]: value });
  const snapshots = () => get("snapshots", []);
  const saveSnapshots = (list) => set("snapshots", list);
  const targets = () => get("targets", []);  // deck lists pasted from Conclave: {id, name, created, cards: [{name, qty}]}
  const saveTargets = (list) => set("targets", list);
  async function job() {
    const j = await get("job", null);
    return j && Date.now() - j.at < JOB_FOR ? j : null;
  }
  const setJob = (j) => set("job", j ? { ...j, at: Date.now() } : null);

  // ---- being gentle with Cardmarket: one request (fetch or navigation the extension starts) per MIN_GAP_MS ----
  async function gap() {
    const last = await get("lastRequest", 0);
    const wait = last + C.MIN_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    await set("lastRequest", Date.now());
  }
  async function go(url) {
    await gap();
    location.assign(url);
  }
  async function fetchCart() {
    if (onCart()) return document;
    await gap();
    const res = await fetch(C.BASE + C.CART_PATH, { credentials: "include" });
    const html = await res.text();
    if (C.isChallenge(html)) throw new Error("challenge");
    if (!res.ok) throw new Error(`http-${res.status}`);
    return new DOMParser().parseFromString(html, "text/html");
  }

  // ---- the panel (in a shadow root, so Cardmarket's styles and ours never mix) ----
  let host, shadow, panel, open = false, note = null, details = null, confirmBox = null, renaming = null;
  function mount() {
    if (host) return;
    host = document.createElement("conclave-cart");
    shadow = host.attachShadow({ mode: "open" });
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = chrome.runtime.getURL("panel.css");
    panel = el("div", { class: "panel", role: "dialog", "aria-label": t("panelTitle") });
    shadow.append(css, panel);
    document.documentElement.append(host);
  }
  function el(tag, attrs = {}, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? "" : v);
    }
    for (const k of kids.flat()) if (k != null && k !== false) e.append(k);
    return e;
  }
  // the Conclave app icon (extension/icons/icon.svg), drawn inline so it needs no extra file access
  function logo() {
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 512 512");
    svg.setAttribute("class", "logo");
    svg.setAttribute("aria-hidden", "true");
    const rect = document.createElementNS(NS, "rect");
    for (const [k, v] of [["width", 512], ["height", 512], ["rx", 112], ["fill", "#4ae05a"]]) rect.setAttribute(k, v);
    const path = document.createElementNS(NS, "path");
    path.setAttribute("d", "M390 128H249.2a128 128 0 0 0 0 256H390v-76H249.2a52 52 0 0 1 0-104H390z");
    path.setAttribute("fill", "#000");
    svg.append(rect, path);
    return svg;
  }
  const button = (text, run, kind = "", extra = {}) => el("button", { type: "button", class: `btn ${kind}`, onclick: run, ...extra }, text);
  function say(kind, text, more = null) {
    note = { kind, text };
    details = more;
    confirmBox = null;
    show();
  }
  function show() {
    open = true;
    render();
  }
  function hide() {
    open = false;
    render();
  }

  async function render() {
    mount();
    host.hidden = !open;
    if (!open) return;
    const list = await snapshots();
    const decks = await targets();
    const here = onCart() ? C.parseCart(document) : null;
    panel.replaceChildren(...[
      el("header", {},
        logo(),
        el("div", { class: "title" }, el("b", {}, "Conclave"), el("span", {}, t("panelTitle"))),
        button("×", hide, "icon", { "aria-label": t("close"), title: t("close") })),
      cartBox(here),
      note && el("p", { class: `note ${note.kind}`, role: note.kind === "error" ? "alert" : "status" }, note.text),
      details,
      confirmBox,
      el("h2", {}, t("snapshots")),
      list.length ? el("ul", { class: "list" }, list.map((s) => snapshotRow(s, here && here.empty))) : el("p", { class: "muted" }, t("noSnapshots")),
      el("h2", {}, t("targets")),
      decks.length ? el("ul", { class: "list" }, decks.map(targetRow)) : el("p", { class: "muted" }, t("noTargets")),
      el("div", { class: "actions" }, button(t("addTarget"), targetBox, "quiet small")),
      el("footer", {},
        button(t("import"), importBox, "quiet"),
        button(t("emptyCart"), askEmpty, "quiet danger"),
        button(t("copyPageInfo"), copyInfo, "quiet", { title: t("copyPageInfoHint") })),
    ].filter(Boolean));
    const focus = shadow.querySelector("[data-focus]");
    if (focus) focus.focus();
  }
  function cartBox(here) {
    let line;
    if (!here) line = t("cartElsewhere");
    else if (here.empty) line = t("cartEmpty");
    else {
      const s = C.summary(here.items);
      line = t("cartNow", s.articles, s.sellers, eur(here.totals.total ?? s.value));
    }
    // nothing to save in an empty cart; elsewhere the cart is fetched when saving
    const full = !here || !here.empty;
    return el("section", { class: "cart" }, el("p", {}, line), full && button(t("saveCart"), saveCart, "primary"));
  }
  // one main button per view: "Save cart" while there is a cart, "Restore" once it is empty
  function snapshotRow(s, cartEmpty) {
    const facts = t("snapshotFacts", s.totals.articles, s.totals.sellers, eur(s.totals.total ?? s.totals.value));
    const name = renaming === s.id
      ? el("input", { class: "rename", value: s.name, "aria-label": t("rename"), "data-focus": true,
        onkeydown: (e) => { if (e.key === "Enter") rename(s.id, e.target.value); if (e.key === "Escape") { renaming = null; render(); } },
        onblur: (e) => rename(s.id, e.target.value) })
      : el("b", {}, s.name || t("untitled"));
    return el("li", {},
      el("div", { class: "row-head" }, name, el("span", { class: "muted" }, date(s.created))),
      el("p", { class: "muted" }, facts),
      el("div", { class: "actions" },
        button(t("restore"), () => askRestore(s), cartEmpty ? "primary small" : "small"),
        button(t("check"), () => check(s), "small"),
        button(t("rename"), () => { renaming = s.id; render(); }, "quiet small"),
        button(t("copyJson"), () => copy(C.exportSnapshot(s), t("copiedJson")), "quiet small"),
        button(t("delete"), () => remove(s), "quiet small danger")));
  }

  // ---- saving ----
  async function saveCart() {
    say("info", t("reading"));
    let doc;
    try { doc = await fetchCart(); } catch (e) { return fail(e); }
    if (C.isChallenge(doc)) return say("warn", t("challenge"));
    const cart = C.parseCart(doc);
    if (!cart.items.length) return say(cart.empty ? "info" : "error", cart.empty ? t("cartEmpty") : t("cannotRead"));
    const list = await snapshots();
    const s = C.makeSnapshot(cart, { name: t("defaultName", date(new Date().toISOString())) });
    await saveSnapshots([s, ...list]);
    say("ok", t("saved", s.totals.articles, s.totals.sellers));
  }
  function fail(e) {
    if (e && e.message === "challenge") return say("warn", t("challenge"));
    say("error", t("requestFailed", (e && e.message) || "?"));
  }

  // ---- restoring ----
  function askRestore(s) {
    note = null;
    details = null;
    confirmBox = el("section", { class: "confirm" },
      el("p", {}, t("restoreAsk", s.totals.articles, s.totals.sellers)),
      el("p", { class: "muted" }, t("abuseHint")),
      el("div", { class: "actions" },
        button(t("restoreNow"), () => restore(s), "primary", { "data-focus": true }),
        button(t("cancel"), () => { confirmBox = null; render(); })));
    show();
  }
  async function restore(s) {
    await setJob({ type: "restore", id: s.id });
    if (C.addForm(document)) return sendRestore(s);
    const seller = C.formSeller(s.items);
    if (!seller) { await setJob(null); return say("error", t("noSeller")); }
    say("info", t("openingOffers", seller));
    await go(C.offersUrl(seller));
  }
  // The doc's trick: Cardmarket's own add-to-cart form (its script is attached), its article fields swapped for all
  // of the snapshot's, then its own button clicked. One request for every article, from every seller.
  async function sendRestore(s, only = null) {
    const items = only ? s.items.filter((i) => only.includes(i.id)) : s.items;
    const form = C.addForm(document);
    if (!form) { await setJob(null); return say("error", t("noForm")); }
    form.querySelectorAll('input[name^="idArticle"], input[name^="amount"]').forEach((i) => i.remove());
    for (const [name, value] of C.restoreFields(items)) form.append(el("input", { type: "hidden", name, value }));
    const submit = form.querySelector('button[type="submit"], input[type="submit"], button:not([type])');
    if (!submit) { await setJob(null); return say("error", t("noForm")); }
    say("info", t("adding", C.summary(items).articles));
    await gap();
    submit.click();
    await answered();
    await setJob({ type: "check", id: s.id, restored: true });
    await go(C.BASE + C.CART_PATH);
  }
  // Cardmarket answers the add with a message on the page; wait for one (or a few seconds) before opening the cart.
  function answered() {
    return new Promise((resolve) => {
      const started = Date.now();
      const done = () => { obs.disconnect(); clearTimeout(timer); resolve(); };
      const obs = new MutationObserver((records) => {
        if (Date.now() - started < 300) return;
        for (const r of records) for (const n of r.addedNodes) {
          if (n.nodeType === 1 && n !== host && (n.matches(".alert, [role=alert], .toast, .modal") || n.querySelector(".alert, [role=alert], .toast"))) return void setTimeout(done, 600);
        }
      });
      obs.observe(document.body, { childList: true, subtree: true });
      const timer = setTimeout(done, 6000);
    });
  }

  // ---- checking ----
  async function check(s) {
    if (!onCart()) {
      await setJob({ type: "check", id: s.id });
      say("info", t("openingCart"));
      return go(C.BASE + C.CART_PATH);
    }
    showDiff(s, C.parseCart(document), false);
  }
  function showDiff(s, cart, restored) {
    const d = C.diffCart(s, cart);
    const line = (i, extra = "") => el("li", {}, el("b", {}, i.name || `#${i.id}`), el("span", { class: "muted" }, ` · ${i.seller || "?"}${i.price != null ? ` · ${eur(i.price)}` : ""}${extra}`));
    const group = (title, items, fmt = (i) => line(i)) => items.length ? [el("h3", {}, title), el("ul", { class: "small-list" }, items.map(fmt))] : [];
    const more = el("section", { class: "diff" },
      group(t("missingTitle", d.missing.length), d.missing),
      group(t("fewerTitle", d.fewer.length), d.fewer, (i) => line(i, ` · ${t("fewerItem", i.have, i.qty)}`)),
      group(t("pricierTitle", d.pricier.length), d.pricier, (i) => line(i, ` → ${eur(i.now)}`)),
      group(t("foreignTitle", d.foreign.length), d.foreign, (i) => line(i, ` · ${i.lang}`)),
      d.extra.length ? el("p", { class: "muted" }, t("extraLine", d.extra.length)) : null,
      searchable(d.missing).length ? el("div", { class: "actions" },
        button(t("findAgain", searchable(d.missing).length), () => findAgain(s, searchable(d.missing)), "primary small"),
        el("span", { class: "muted" }, t("findAgainHint"))) : null);
    const total = cart.totals.total != null ? ` ${t("cartTotal", eur(cart.totals.total), eur(cart.totals.shipping))}` : "";
    if (d.ok) say("ok", (restored ? t("restoredAll", d.found.length) : t("checkOk", d.found.length)) + total, d.extra.length || d.foreign.length ? more : null);
    else say("warn", t(restored ? "restoredSome" : "checkSome", d.found.length, s.items.length) + " " + t("missingHint") + total, more);
  }

  // ---- finding missing articles again at the same seller (one request each, MIN_GAP_MS apart) ----
  const searchable = (items) => items.filter((i) => i.seller && (i.slug || i.name));
  async function findAgain(s, missing) {
    const found = [], lost = [], taken = new Set();
    for (const [n, item] of missing.entries()) {
      say("info", t("searching", n + 1, missing.length, item.name || item.slug));
      let offer = null;
      for (const url of C.searchUrls(item)) {
        let html;
        try {
          await gap();
          const res = await fetch(url, { credentials: "include" });
          html = await res.text();
          if (!res.ok) throw new Error(`http-${res.status}`);
        } catch (e) { return fail(e); }
        if (C.isChallenge(html)) return say("warn", t("challenge"));
        const offers = C.parseOffers(new DOMParser().parseFromString(html, "text/html"), url).filter((o) => !taken.has(o.id));
        offer = C.pickOffer(item, offers);
        if (offer) break;
      }
      if (offer) { taken.add(offer.id); found.push({ old: item.id, item, offer }); }
      else lost.push(item);
    }
    showFound(s, found, lost);
  }
  function showFound(s, found, lost) {
    const line = (f) => el("li", {}, el("b", {}, f.item.name || f.offer.name),
      el("span", { class: "muted" }, ` · ${f.item.seller} · ${eur(f.item.price)} → `),
      el("span", { class: f.offer.pricier ? "pricier" : "muted" }, eur(f.offer.price)),
      el("span", { class: "muted" }, ` · ${[f.offer.cond, f.offer.lang, f.offer.set.replace(/-/g, " ")].filter(Boolean).join(" · ")}`));
    const more = el("section", { class: "diff" },
      found.length ? [el("h3", {}, t("foundTitle", found.length)), el("ul", { class: "small-list" }, found.map(line))] : null,
      lost.length ? [el("h3", {}, t("lostTitle", lost.length)), el("ul", { class: "small-list" },
        lost.map((i) => el("li", {}, el("b", {}, i.name || `#${i.id}`), el("span", { class: "muted" }, ` · ${i.seller}`))))] : null,
      found.length ? el("div", { class: "actions" },
        button(t("addFound", found.length), () => addFound(s, found), "primary")) : null);
    if (!found.length) return say("warn", t("noneFound"), more);
    say(found.some((f) => f.offer.pricier) ? "warn" : "ok", t(found.some((f) => f.offer.pricier) ? "foundPricier" : "foundAll", found.length), more);
  }
  // the snapshot keeps the new article numbers, so the next restore works without searching
  async function addFound(s, found) {
    const updated = C.replaceItems(s, found);
    const list = await snapshots();
    await saveSnapshots(list.map((x) => (x.id === s.id ? updated : x)));
    const only = found.map((f) => f.offer.id);
    await setJob({ type: "restore", id: s.id, only });
    if (C.addForm(document)) return sendRestore(updated, only);
    say("info", t("openingOffers", found[0].item.seller));
    await go(C.offersUrl(found[0].item.seller));
  }

  // ---- emptying ----
  async function askEmpty() {
    if (!onCart()) {
      await setJob({ type: "empty" });
      say("info", t("openingCart"));
      return go(C.BASE + C.CART_PATH);
    }
    const cart = C.parseCart(document);
    if (cart.empty || (!cart.items.length && !C.removeAllButton(document))) return say("info", t("cartEmpty"));
    note = null;
    details = null;
    confirmBox = el("section", { class: "confirm" },
      el("p", {}, t("emptyAsk")),
      el("div", { class: "actions" },
        button(t("emptyNow"), () => empty(cart), "danger-fill", { "data-focus": true }),
        button(t("cancel"), () => { confirmBox = null; render(); })));
    show();
  }
  async function empty(cart) {
    const b = C.removeAllButton(document);
    if (!b) {
      // another language's button label we don't know yet: the English cart page has the same cart
      if (!C.onEnglish(location.pathname)) {
        await setJob({ type: "empty" });
        say("info", t("openingCart"));
        return go(C.BASE + C.CART_PATH);
      }
      return say("error", t("noEmptyButton"));
    }
    // keep what was there, unless the newest snapshot already is this cart
    let kept = false;
    if (cart.items.length) {
      const list = await snapshots();
      if (!list.length || !C.sameItems(list[0].items, cart.items)) {
        await saveSnapshots([C.makeSnapshot(cart, { name: t("beforeEmptying", date(new Date().toISOString())) }), ...list]);
        kept = true;
      }
    }
    await setJob({ type: "emptied", kept });
    await gap();
    // Cardmarket removes seller by seller while the page reloads (about 6 s): leaving the page then stops it halfway
    say("info", t("emptying"));
    b.click();
  }

  // ---- import, copy, rename, delete ----
  function importBox() {
    note = null;
    details = null;
    const area = el("textarea", { rows: 5, placeholder: t("importPlaceholder"), "aria-label": t("import"), "data-focus": true });
    confirmBox = el("section", { class: "confirm" },
      el("p", {}, t("importHint")), area,
      el("div", { class: "actions" },
        button(t("importNow"), async () => {
          let s;
          try { s = C.importSnapshot(area.value); } catch (e) { return say("error", t(e.message === "not-json" ? "importNotJson" : "importEmpty")); }
          if (!s.name) s.name = t("importedName", date(new Date().toISOString()));
          await saveSnapshots([s, ...(await snapshots())]);
          say("ok", t("imported", s.totals.articles, s.totals.sellers));
        }, "primary"),
        button(t("cancel"), () => { confirmBox = null; render(); })));
    show();
  }
  async function copy(text, done) {
    try { await navigator.clipboard.writeText(text); say("ok", done); } catch { say("error", t("copyFailed")); }
  }
  const copyInfo = () => copy(C.pageInfo(document), t("copiedPageInfo"));
  async function rename(id, name) {
    if (renaming !== id) return;
    renaming = null;
    const list = await snapshots();
    const s = list.find((x) => x.id === id);
    if (s) { s.name = name.trim().slice(0, 80); await saveSnapshots(list); }
    render();
  }
  async function remove(s) {
    const list = await snapshots();
    await saveSnapshots(list.filter((x) => x.id !== s.id));
    say("ok", t("deleted", s.name || t("untitled")));
    details = el("div", { class: "actions" }, button(t("undo"), async () => {
      await saveSnapshots([s, ...(await snapshots())].sort((a, b) => b.created.localeCompare(a.created)));
      say("ok", t("restoredSnapshot"));
    }, "small"));
    render();
  }

  // ---- deck lists: which of a deck's cards are still missing from the cart ----
  function targetRow(d) {
    return el("li", {},
      el("div", { class: "row-head" }, el("b", {}, d.name || t("untitledDeck")), el("span", { class: "muted" }, date(d.created))),
      el("p", { class: "muted" }, t("targetFacts", d.cards.reduce((n, c) => n + c.qty, 0))),
      el("div", { class: "actions" },
        button(t("check"), () => compareTarget(d), "small"),
        button(t("delete"), () => removeTarget(d), "quiet small danger")));
  }
  function targetBox() {
    note = null;
    details = null;
    const name = el("input", { class: "rename", placeholder: t("targetNamePlaceholder"), "aria-label": t("targetName"), "data-focus": true });
    const area = el("textarea", { rows: 6, placeholder: "1 Sol Ring\n1 Arcane Signet\n…", "aria-label": t("addTarget") });
    confirmBox = el("section", { class: "confirm" },
      el("p", {}, t("targetHint")), name, area,
      el("div", { class: "actions" },
        button(t("saveTarget"), async () => {
          const cards = C.parseTargetList(area.value);
          if (!cards.length) return say("error", t("targetEmpty"));
          const d = { id: `d${Date.now().toString(36)}`, name: name.value.trim().slice(0, 80), created: new Date().toISOString(), cards };
          await saveTargets([d, ...(await targets())]);
          say("ok", t("targetSaved", cards.reduce((n, c) => n + c.qty, 0)));
        }, "primary"),
        button(t("cancel"), () => { confirmBox = null; void render(); })));
    show();
  }
  async function compareTarget(d) {
    if (!onCart()) {
      await setJob({ type: "target", list: d.id });
      say("info", t("openingCart"));
      return go(C.BASE + C.CART_PATH);
    }
    showTarget(d, C.parseCart(document));
  }
  function showTarget(d, cart) {
    const m = C.matchTarget(d.cards, cart);
    const name = d.name || t("untitledDeck");
    const more = el("section", { class: "diff" },
      m.missing.length ? [el("h3", {}, t("targetMissingTitle", m.missingCards)),
        el("ul", { class: "small-list" }, m.missing.map((c) => el("li", {}, `${c.need} `, el("b", {}, c.name),
          c.have ? el("span", { class: "muted" }, ` · ${t("targetHave", c.have, c.qty)}`) : null))),
        el("div", { class: "actions" }, button(t("copyMissing"), () => copy(C.wantsText(m.missing), t("copiedMissing")), "small"))] : null,
      m.extra.length ? el("p", { class: "muted" }, t("targetExtra", m.extra.length)) : null);
    if (!m.missing.length) say("ok", t("targetAll", m.cards, name), m.extra.length ? more : null);
    else say("warn", t("targetSome", m.cards - m.missingCards, m.cards, name), more);
  }
  async function removeTarget(d) {
    await saveTargets((await targets()).filter((x) => x.id !== d.id));
    say("ok", t("deleted", d.name || t("untitledDeck")));
    details = el("div", { class: "actions" }, button(t("undo"), async () => {
      await saveTargets([d, ...(await targets())].sort((a, b) => b.created.localeCompare(a.created)));
      say("ok", t("restoredSnapshot"));
    }, "small"));
    void render();
  }

  // ---- carrying on a job after a page load ----
  async function resume() {
    const j = await job();
    if (!j) return;
    if (C.isChallenge(document)) return say("warn", t("challengeJob"));
    const s = j.id ? (await snapshots()).find((x) => x.id === j.id) : null;
    if (j.id && !s) { await setJob(null); return; }
    if (j.type === "restore") {
      if (C.addForm(document)) return sendRestore(s, j.only || null);
      await setJob(null);
      return say("error", t("noForm"));
    }
    if (!onCart()) return;  // the cart page didn't open (yet): leave the job for it
    await setJob(null);
    if (j.type === "check") return showDiff(s, C.parseCart(document), j.restored);
    if (j.type === "target") {
      const d = (await targets()).find((x) => x.id === j.list);
      return d ? showTarget(d, C.parseCart(document)) : undefined;
    }
    if (j.type === "empty") return askEmpty();
    if (j.type === "emptied") {
      const left = C.parseCart(document).items.length;
      if (left) return say("warn", t("emptyPartial", left));
      return say("ok", j.kept ? t("emptiedKept") : t("emptied"));
    }
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === "toggle") { if (open) hide(); else { note = null; details = null; confirmBox = null; show(); } }
  });
  get("openPanel", false).then((o) => { if (o) { set("openPanel", false); show(); } });
  resume();
})();
