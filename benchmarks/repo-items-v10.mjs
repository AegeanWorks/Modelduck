/**
 * Suite v10 (ADR-038): codebase questions. Each item shows a small multi-file
 * JavaScript codebase, distractor files included, and asks the model to work
 * inside it: write a function on top of the existing helpers, fix a bug a user
 * reported, or name the function that holds a reported bug. The other files are
 * loaded before the answer (`setup`), so the answer has to fit the codebase.
 * References and bug reproductions live in tests/benchmark-suite-v10.test.js.
 */

const SHOP = [
  ["src/money.js", String.raw`function toCents(amount) {
  return Math.round(amount * 100);
}

function formatCents(cents) {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return sign + "$" + Math.floor(abs / 100) + "." + String(abs % 100).padStart(2, "0");
}`],
  ["src/catalog.js", String.raw`var CATALOG = {
  apple: { name: "Apple", price: 0.5, taxable: false },
  soap: { name: "Soap", price: 2.25, taxable: true },
  lamp: { name: "Lamp", price: 19.99, taxable: true },
};

function findProduct(sku) {
  const product = CATALOG[sku];
  if (!product) throw new Error("unknown sku " + sku);
  return product;
}`],
  ["src/tax.js", String.raw`var TAX_RATE = 0.08;

function taxCents(cents, taxable) {
  return taxable ? Math.round(cents * TAX_RATE) : 0;
}`],
  ["src/cart.js", String.raw`function lineCents(line) {
  return toCents(findProduct(line.sku).price) * line.qty;
}

function cartSubtotalCents(lines) {
  return lines.reduce((sum, line) => sum + lineCents(line), 0);
}`],
  ["src/log.js", String.raw`var LOG_LEVELS = ["debug", "info", "warn", "error"];

function shouldLog(level, minimum) {
  return LOG_LEVELS.indexOf(level) >= LOG_LEVELS.indexOf(minimum);
}`],
];

const SEARCH = [
  ["src/text.js", String.raw`function normalize(text) {
  return text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function tokenize(text) {
  return normalize(text).split(/[^a-z0-9]+/).filter(Boolean);
}`],
  ["src/stopwords.js", String.raw`var STOPWORDS = new Set(["a", "an", "the", "of", "and", "to", "in"]);

function isStopword(word) {
  return STOPWORDS.has(word);
}`],
  ["src/index.js", String.raw`function buildIndex(docs) {
  const index = new Map();
  for (const doc of docs) {
    for (const word of new Set(tokenize(doc.text))) {
      if (isStopword(word)) continue;
      if (!index.has(word)) index.set(word, []);
      index.get(word).push(doc.id);
    }
  }
  return index;
}`],
  ["src/config.js", String.raw`var DEFAULTS = { pageSize: 20, highlight: true };

function withDefaults(options) {
  return Object.assign({}, DEFAULTS, options);
}`],
];

const CALENDAR = [
  ["src/time.js", String.raw`function parseTime(text) {
  const [hours, minutes] = text.split(":").map(Number);
  return hours * 60 + minutes;
}

function formatTime(minutes) {
  const hours = Math.floor(minutes / 60) % 24;
  return String(hours).padStart(2, "0") + ":" + String(minutes % 60).padStart(2, "0");
}`],
  ["src/slots.js", String.raw`function overlaps(a, b) {
  return a.start < b.end && b.start < a.end;
}

function toSlot(meeting) {
  const start = parseTime(meeting.at);
  return { start, end: start + meeting.minutes };
}`],
  ["src/calendar.js", String.raw`function conflicts(meetings) {
  const slots = meetings.map(toSlot);
  const found = [];
  for (let i = 0; i < slots.length; i += 1) {
    for (let j = i + 1; j < slots.length; j += 1) {
      if (overlaps(slots[i], slots[j])) found.push([meetings[i].title, meetings[j].title]);
    }
  }
  return found;
}`],
  ["src/colors.js", String.raw`var PALETTE = ["#1f77b4", "#ff7f0e", "#2ca02c"];

function colorFor(index) {
  return PALETTE[index % PALETTE.length];
}`],
];

/** `files` with one file's text swapped, as the buggy version of a codebase. */
const withFile = (files, path, from, to) =>
  files.map(([name, code]) => {
    if (name !== path) return [name, code];
    if (!code.includes(from)) throw new Error(`repo item: ${path} lacks ${from}`);
    return [name, code.replace(from, to)];
  });

const shown = (files) => files.map(([name, code]) => `// file: ${name}\n${code}`).join("\n\n");
const source = (files) => files.map(([, code]) => code).join("\n\n");

const REPO_TOKENS = 1024;

function implement(id, label, files, task, entry, cases) {
  return {
    id: `repo-${id}`,
    label,
    category: "code-repo",
    prompt:
      `Here is a JavaScript codebase.\n\n${shown(files)}\n\n${task}\n` +
      `Reply with code only: the function ${entry}, using the existing helpers. The other files are already loaded, so do not repeat them.`,
    maxTokens: REPO_TOKENS,
    checks: [{ type: "jsTests", entry, cases, setup: source(files) }],
  };
}

function fix(id, label, files, report, entry, cases) {
  return {
    id: `repo-${id}`,
    label,
    category: "bugfix-repo",
    prompt:
      `Here is a JavaScript codebase.\n\n${shown(files)}\n\nA user reports: ${report}\n` +
      `Find the cause and fix it. Reply with code only: the corrected function ${entry}. The other files are already loaded, so do not repeat them.`,
    buggyCode: source(files),
    maxTokens: REPO_TOKENS,
    checks: [{ type: "jsTests", entry, cases, setup: source(files) }],
  };
}

function locate(id, label, files, report, culprit) {
  return {
    id: `repo-${id}`,
    label,
    category: "code-repo",
    prompt:
      `Here is a JavaScript codebase.\n\n${shown(files)}\n\nA user reports: ${report}\n` +
      "Which function contains the bug? Reply with only the function name.",
    buggyCode: source(files),
    maxTokens: 64,
    checks: [{ type: "oneOf", values: [culprit, `${culprit}()`] }],
  };
}

const MEETINGS = [
  { title: "standup", at: "09:00", minutes: 30 },
  { title: "review", at: "10:00", minutes: 60 },
];

/** Codebase items: six to implement, three to fix, three to locate. */
export function repoPrompts() {
  return [
    implement("cart-total", "Cart total with tax", SHOP,
      "Add a function cartTotalCents(lines) to src/cart.js that returns the subtotal in cents plus the tax of every line, each line taxed on its own with taxCents and its product's taxable flag.",
      "cartTotalCents", [
        { args: [[{ sku: "apple", qty: 4 }, { sku: "soap", qty: 2 }]], expect: 686 },
        { args: [[{ sku: "lamp", qty: 1 }]], expect: 2159 },
        { args: [[]], expect: 0 },
      ]),
    implement("receipt", "Receipt lines", SHOP,
      'Add a function receipt(lines) to src/cart.js that returns an array of strings: one "<qty> x <product name>: <line total>" per line, then "Subtotal: <subtotal>", with every amount formatted by formatCents.',
      "receipt", [
        { args: [[{ sku: "apple", qty: 3 }, { sku: "lamp", qty: 2 }]], expect: ["3 x Apple: $1.50", "2 x Lamp: $39.98", "Subtotal: $41.48"] },
        { args: [[]], expect: ["Subtotal: $0.00"] },
      ]),
    fix("format-cents", "Fix cents formatting", withFile(SHOP, "src/money.js", 'String(abs % 100).padStart(2, "0")', "abs % 100"),
      'a receipt line for 105 cents shows "$1.5" instead of "$1.05".',
      "formatCents", [
        { args: [105], expect: "$1.05" },
        { args: [2000], expect: "$20.00" },
        { args: [-250], expect: "-$2.50" },
        { args: [7], expect: "$0.07" },
      ]),
    locate("find-tax", "Locate the tax bug", withFile(SHOP, "src/tax.js", "Math.round(cents * TAX_RATE)", "Math.floor(cents * TAX_RATE)"),
      "the total for one lamp is $21.58, but it should be $21.59.", "taxCents"),
    implement("search", "Search on the index", SEARCH,
      "Add a function searchDocs(docs, query) that builds the index with buildIndex and returns the ids of the documents containing every query word that is not a stopword, sorted ascending. A query with no such words returns an empty array.",
      "searchDocs", [
        { args: [[{ id: 2, text: "The red fox" }, { id: 1, text: "A red barn and a fox" }, { id: 3, text: "Blue barn" }], "red fox"], expect: [1, 2] },
        { args: [[{ id: 1, text: "Café de Paris" }, { id: 2, text: "Paris metro" }], "CAFE paris"], expect: [1] },
        { args: [[{ id: 1, text: "the end" }], "the of"], expect: [] },
      ]),
    implement("slugify", "Slug from title", SEARCH,
      'Add a function slugify(title) that joins the title\'s tokens with "-", leaving out stopwords; when every token is a stopword, keep them all.',
      "slugify", [
        { args: ["The Art of War"], expect: "art-war" },
        { args: ["Crème Brûlée Recipe"], expect: "creme-brulee-recipe" },
        { args: ["The A"], expect: "the-a" },
        { args: ["  Hello,   World! "], expect: "hello-world" },
      ]),
    fix("tokenize-digits", "Fix tokenizing numbers", withFile(SEARCH, "src/text.js", "split(/[^a-z0-9]+/)", "split(/[^a-z]+/)"),
      'searching for "66" never finds the document "Route 66 Diner".',
      "tokenize", [
        { args: ["Route 66 Diner"], expect: ["route", "66", "diner"] },
        { args: ["Café Olé"], expect: ["cafe", "ole"] },
        { args: [""], expect: [] },
      ]),
    locate("find-accents", "Locate the accent bug", withFile(SEARCH, "src/text.js", '.normalize("NFD").replace(/[\\u0300-\\u036f]/g, "")', ""),
      'searching for "cafe" does not find the document "Café Paris".', "normalize"),
    implement("free-slot", "First free slot", CALENDAR,
      'Add a function firstFreeSlot(meetings, minutes, dayStart, dayEnd) that returns the start, as "HH:MM", of the earliest gap of at least `minutes` between dayStart and dayEnd (both "HH:MM") that no meeting overlaps, or null when there is none. Meetings may be in any order.',
      "firstFreeSlot", [
        { args: [MEETINGS, 30, "09:00", "17:00"], expect: "09:30" },
        { args: [MEETINGS, 45, "09:00", "17:00"], expect: "11:00" },
        { args: [[...MEETINGS].reverse(), 30, "09:00", "17:00"], expect: "09:30" },
        { args: [[{ title: "all day", at: "09:00", minutes: 480 }], 15, "09:00", "17:00"], expect: null },
      ]),
    implement("end-times", "Meeting end times", CALENDAR,
      'Add a function endTimes(meetings) that returns, for each meeting in order, [title, end] where end is the meeting\'s end time as "HH:MM".',
      "endTimes", [
        { args: [MEETINGS], expect: [["standup", "09:30"], ["review", "11:00"]] },
        { args: [[{ title: "late", at: "23:30", minutes: 90 }]], expect: [["late", "01:00"]] },
      ]),
    fix("back-to-back", "Fix back-to-back conflicts", withFile(CALENDAR, "src/slots.js", "a.start < b.end && b.start < a.end", "a.start <= b.end && b.start <= a.end"),
      "a meeting that ends at 10:00 and one that starts at 10:00 are reported as a conflict.",
      "overlaps", [
        { args: [{ start: 0, end: 60 }, { start: 60, end: 90 }], expect: false },
        { args: [{ start: 0, end: 60 }, { start: 30, end: 90 }], expect: true },
        { args: [{ start: 0, end: 100 }, { start: 20, end: 30 }], expect: true },
        { args: [{ start: 50, end: 60 }, { start: 0, end: 50 }], expect: false },
      ]),
    locate("find-midnight", "Locate the midnight bug", withFile(CALENDAR, "src/time.js", "Math.floor(minutes / 60) % 24", "Math.floor(minutes / 60)"),
      'a meeting at 23:30 lasting 90 minutes is shown as ending at "25:00".', "formatTime"),
  ];
}
