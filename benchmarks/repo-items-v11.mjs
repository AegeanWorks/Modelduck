import { fix, implement, locate, withFile } from "./repo-items-v10.mjs";

/**
 * Suite v11 (ADR-039): three larger codebases, six or seven files each with a
 * distractor, asked the same three ways as v10. References and bug
 * reproductions live in tests/benchmark-suite-v11.test.js.
 */

export const LEDGER = [
  ["src/money.js", String.raw`function toMinor(amount) {
  return Math.round(amount * 100);
}

function fromMinor(minor) {
  return minor / 100;
}`],
  ["src/ids.js", String.raw`var nextId = 1;

function newId(prefix) {
  const id = prefix + "-" + nextId;
  nextId += 1;
  return id;
}`],
  ["src/accounts.js", String.raw`function newBook() {
  return { accounts: {}, history: [] };
}

function openAccount(book, owner, opening) {
  book.accounts[owner] = { owner: owner, balance: toMinor(opening || 0), frozen: false };
  return book.accounts[owner];
}

function getAccount(book, owner) {
  const account = book.accounts[owner];
  if (!account) throw new Error("no account for " + owner);
  return account;
}`],
  ["src/rules.js", String.raw`var DAILY_LIMIT = toMinor(1000);

function canWithdraw(account, minor) {
  return !account.frozen && minor > 0 && account.balance >= minor;
}`],
  ["src/transfer.js", String.raw`function transfer(book, from, to, amount) {
  const minor = toMinor(amount);
  const source = getAccount(book, from);
  const target = getAccount(book, to);
  if (!canWithdraw(source, minor)) return false;
  source.balance -= minor;
  target.balance += minor;
  book.history.push({ from: from, to: to, minor: minor });
  return true;
}`],
  ["src/report.js", String.raw`function balanceOf(book, owner) {
  return fromMinor(getAccount(book, owner).balance);
}`],
];

export const ORDERS = [
  ["src/units.js", String.raw`function gramsToKg(grams) {
  return grams / 1000;
}`],
  ["src/stock.js", String.raw`var STOCK = {
  mug: { grams: 350, price: 8, count: 12 },
  kettle: { grams: 1200, price: 35, count: 3 },
  tea: { grams: 100, price: 5, count: 40 },
};

function itemOf(sku) {
  const item = STOCK[sku];
  if (!item) throw new Error("unknown item " + sku);
  return item;
}

function inStock(sku, qty) {
  const item = STOCK[sku];
  return Boolean(item) && item.count >= qty;
}`],
  ["src/shipping.js", String.raw`var RATES = [
  { upToKg: 1, cost: 4 },
  { upToKg: 5, cost: 9 },
  { upToKg: 20, cost: 19 },
];

function shippingCost(kg) {
  for (const rate of RATES) {
    if (kg <= rate.upToKg) return rate.cost;
  }
  return null;
}`],
  ["src/discounts.js", String.raw`function discountRate(code) {
  if (code === "WELCOME10") return 0.1;
  if (code === "HALF") return 0.5;
  return 0;
}`],
  ["src/orders.js", String.raw`function orderWeightKg(lines) {
  return gramsToKg(lines.reduce((sum, line) => sum + itemOf(line.sku).grams * line.qty, 0));
}

function itemsTotal(lines) {
  return lines.reduce((sum, line) => sum + itemOf(line.sku).price * line.qty, 0);
}`],
  ["src/dates.js", String.raw`function addDays(iso, days) {
  const date = new Date(iso + "T00:00:00Z");
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}`],
];

export const MARKDOWN = [
  ["src/escape.js", String.raw`function escapeHtml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}`],
  ["src/inline.js", String.raw`function renderInline(text) {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/_(.+?)_/g, "<em>$1</em>");
}`],
  ["src/blocks.js", String.raw`function headingLevel(line) {
  const match = /^(#{1,6}) /.exec(line);
  return match ? match[1].length : 0;
}

function isListItem(line) {
  return line.startsWith("- ");
}`],
  ["src/render.js", String.raw`function render(markdown) {
  const out = [];
  let inList = false;
  for (const line of markdown.split("\n")) {
    if (isListItem(line)) {
      if (!inList) {
        out.push("<ul>");
        inList = true;
      }
      out.push("<li>" + renderInline(line.slice(2)) + "</li>");
      continue;
    }
    if (inList) {
      out.push("</ul>");
      inList = false;
    }
    const level = headingLevel(line);
    if (level) out.push("<h" + level + ">" + renderInline(line.slice(level + 1)) + "</h" + level + ">");
    else if (line.trim()) out.push("<p>" + renderInline(line) + "</p>");
  }
  if (inList) out.push("</ul>");
  return out.join("\n");
}`],
  ["src/theme.js", String.raw`var THEME = { font: "serif", width: 720 };

function cssVars(theme) {
  return Object.keys(theme).map((key) => "--" + key + ": " + theme[key] + ";").join(" ");
}`],
];

/** Larger codebase items: six to implement, three to fix, three to locate. */
export function moreRepoPrompts() {
  return [
    implement("run-transfers", "Replay transfers", LEDGER,
      "Add a function runTransfers(openings, transfers) to src/transfer.js. `openings` maps each owner to an opening amount; open every account in a new book, then apply each [from, to, amount] in `transfers` with transfer, skipping any that names an account that was never opened. Return the final balances as [owner, balance] pairs sorted by owner, with balances in currency units.",
      "runTransfers", [
        { args: [{ bob: 20, ann: 100 }, [["ann", "bob", 30], ["bob", "ann", 80], ["bob", "cy", 5]]], expect: [["ann", 70], ["bob", 50]] },
        { args: [{ a: 0.1, b: 0.2 }, [["a", "b", 0.1]]], expect: [["a", 0], ["b", 0.3]] },
        { args: [{ solo: 5 }, []], expect: [["solo", 5]] },
      ]),
    implement("daily-limit", "Daily limit check", LEDGER,
      "Add a function withinDailyLimit(book, owner, amount) to src/rules.js that returns true when everything `owner` has already sent in book.history plus `amount` stays within DAILY_LIMIT, comparing in minor units.",
      "withinDailyLimit", [
        { args: [{ accounts: {}, history: [{ from: "a", to: "b", minor: 90000 }] }, "a", 100], expect: true },
        { args: [{ accounts: {}, history: [{ from: "a", to: "b", minor: 90000 }] }, "a", 100.01], expect: false },
        { args: [{ accounts: {}, history: [{ from: "a", to: "b", minor: 90000 }] }, "b", 1000], expect: true },
      ]),
    fix("whole-balance", "Fix sending the whole balance", withFile(LEDGER, "src/rules.js", "account.balance >= minor", "account.balance > minor"),
      "transferring an account's entire balance is refused.",
      "canWithdraw", [
        { args: [{ balance: 500, frozen: false }, 500], expect: true },
        { args: [{ balance: 500, frozen: false }, 501], expect: false },
        { args: [{ balance: 500, frozen: true }, 100], expect: false },
        { args: [{ balance: 500, frozen: false }, 0], expect: false },
      ]),
    locate("find-history", "Locate the history bug", withFile(LEDGER, "src/transfer.js", "minor: minor });", "minor: amount });"),
      "after a transfer of 25.5 the history says 25.5 minor units moved instead of 2550.", "transfer"),
    implement("quote", "Order quote", ORDERS,
      "Add a function quote(lines, code) to src/orders.js that returns [items, discount, shipping, total]: items is the items total, discount is items times the discount rate of `code`, shipping is the shipping cost for the order's weight (no discount on shipping), and total is items minus discount plus shipping. Return null when a line is not in stock or no shipping rate covers the weight.",
      "quote", [
        { args: [[{ sku: "mug", qty: 2 }, { sku: "tea", qty: 3 }], "HALF"], expect: [31, 15.5, 4, 19.5] },
        { args: [[{ sku: "kettle", qty: 4 }], ""], expect: null },
        { args: [[{ sku: "kettle", qty: 3 }, { sku: "tea", qty: 2 }], "NOPE"], expect: [115, 0, 9, 124] },
      ]),
    implement("heaviest-line", "Heaviest order line", ORDERS,
      "Add a function heaviestLine(lines) to src/orders.js that returns the sku of the line with the largest total weight (item grams times quantity); on a tie, the earlier line wins.",
      "heaviestLine", [
        { args: [[{ sku: "tea", qty: 3 }, { sku: "mug", qty: 1 }]], expect: "mug" },
        { args: [[{ sku: "mug", qty: 4 }, { sku: "kettle", qty: 1 }, { sku: "tea", qty: 14 }]], expect: "mug" },
        { args: [[{ sku: "tea", qty: 12 }, { sku: "kettle", qty: 1 }]], expect: "tea" },
      ]),
    fix("exact-kilo", "Fix the 1 kg shipping rate", withFile(ORDERS, "src/shipping.js", "kg <= rate.upToKg", "kg < rate.upToKg"),
      "an order weighing exactly 1 kg is charged $9 shipping instead of $4.",
      "shippingCost", [
        { args: [1], expect: 4 },
        { args: [0.5], expect: 4 },
        { args: [5], expect: 9 },
        { args: [5.2], expect: 19 },
        { args: [25], expect: null },
      ]),
    locate("find-units", "Locate the weight bug", withFile(ORDERS, "src/units.js", "grams / 1000", "grams / 100"),
      "a single 350 g mug is charged $9 shipping instead of $4.", "gramsToKg"),
    implement("toc", "Table of contents", MARKDOWN,
      'Add a function tableOfContents(markdown) to src/render.js that returns one string per heading, in order: two spaces per level below 1, then "- ", then the heading text without its "#" marks.',
      "tableOfContents", [
        { args: ["# A\ntext\n## B\n### C\n## D"], expect: ["- A", "  - B", "    - C", "  - D"] },
        { args: ["no headings\n- item"], expect: [] },
        { args: ["#not a heading\n## Real"], expect: ["  - Real"] },
      ]),
    implement("first-paragraph", "First paragraph", MARKDOWN,
      'Add a function firstParagraph(markdown) to src/render.js that returns the HTML-rendered inline text (no <p> tags) of the first line that is not blank, not a heading and not a list item, or "" when there is none.',
      "firstParagraph", [
        { args: ["# T\n\n- a\nHello **world**\nmore"], expect: "Hello <strong>world</strong>" },
        { args: ["# Only\n- list"], expect: "" },
        { args: ["Fish & _chips_"], expect: "Fish &amp; <em>chips</em>" },
      ]),
    fix("escape-order", "Fix double escaping", withFile(MARKDOWN, "src/escape.js",
      'text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")',
      'text.replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/&/g, "&amp;")'),
      'the text "a < b" is shown as "a &amp;lt; b".',
      "escapeHtml", [
        { args: ["a < b"], expect: "a &lt; b" },
        { args: ["Tom & Jerry"], expect: "Tom &amp; Jerry" },
        { args: ["<b>"], expect: "&lt;b&gt;" },
      ]),
    locate("find-list-end", "Locate the unclosed list", withFile(MARKDOWN, "src/render.js", '  if (inList) out.push("</ul>");\n  return', "  return"),
      "a document that ends with a list leaves its <ul> unclosed.", "render"),
  ];
}
