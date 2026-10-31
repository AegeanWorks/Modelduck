import { REPO_TOKENS, shown, source, withFile } from "./repo-items-v10.mjs";
import { LEDGER, MARKDOWN, ORDERS } from "./repo-items-v11.mjs";

/**
 * Suite v13 (ADR-061): codebase work closer to real maintenance. Six fixes
 * start from a failing test and its output, where the failure shows far from
 * its cause; six changes span more than one function or file. The answer may
 * change any functions, so each item is checked through a hidden scenario that
 * runs after it (`harness`). References, the failing outputs and the unchanged
 * codebases' failures are proven in tests/benchmark-suite-v13-repo.test.js.
 */

const PLANNER = [
  ["src/dates.js", String.raw`function parseDay(text) {
  const parts = text.split("-").map(Number);
  return Date.UTC(parts[0], parts[1] - 1, parts[2]) / 86400000;
}

function formatDay(dayNumber) {
  return new Date(dayNumber * 86400000).toISOString().slice(0, 10);
}`],
  ["src/store.js", String.raw`function newStore() {
  return { tasks: [], nextId: 1 };
}

function addTask(store, title, due, estimate) {
  const task = { id: store.nextId, title: title, due: parseDay(due), estimate: estimate, done: false, tags: [] };
  store.nextId += 1;
  store.tasks.push(task);
  return task;
}

function findTask(store, id) {
  const task = store.tasks.find((item) => item.id === id);
  if (!task) throw new Error("no task " + id);
  return task;
}`],
  ["src/tags.js", String.raw`function normalizeTag(tag) {
  return tag.trim().toLowerCase();
}

function tagTask(task, tag) {
  const clean = normalizeTag(tag);
  if (!task.tags.includes(clean)) task.tags.push(clean);
  return task;
}

function withTag(store, tag) {
  const clean = normalizeTag(tag);
  return store.tasks.filter((task) => task.tags.includes(clean));
}`],
  ["src/schedule.js", String.raw`function overdue(store, today) {
  const day = parseDay(today);
  return store.tasks.filter((task) => !task.done && task.due < day);
}

function dueWithin(store, today, days) {
  const day = parseDay(today);
  return store.tasks.filter((task) => !task.done && task.due >= day && task.due - day <= days);
}`],
  ["src/progress.js", String.raw`function complete(store, id) {
  findTask(store, id).done = true;
}

function remainingHours(store) {
  return store.tasks.filter((task) => !task.done).reduce((sum, task) => sum + task.estimate, 0);
}`],
  ["src/summary.js", String.raw`function summaryLine(task) {
  return "#" + task.id + " " + task.title + " (due " + formatDay(task.due) + (task.done ? ", done" : "") + ")";
}

function summary(store) {
  return store.tasks.map(summaryLine).join("\n");
}`],
  ["src/theme.js", String.raw`var COLORS = { done: "green", overdue: "red", open: "grey" };

function colorOf(state) {
  return COLORS[state] || "grey";
}`],
];

const ENTRY = "scenario";

/** A change that may touch several functions: every code block of the reply counts. */
function change(id, label, files, task, harness, cases) {
  return {
    id: `repo-${id}`,
    label,
    category: "code-repo",
    prompt:
      `Here is a JavaScript codebase.\n\n${shown(files)}\n\n${task}\n` +
      "Reply with code only: every function you add or change, in full. The other files are already loaded, so do not repeat them.",
    maxTokens: REPO_TOKENS,
    checks: [{ type: "jsTests", entry: ENTRY, cases, setup: source(files), harness }],
  };
}

/** A fix that starts from a failing test and its output; the cause may be in another file. */
function traceFix(id, label, files, testCode, output, harness, cases) {
  return {
    id: `repo-${id}`,
    label,
    category: "bugfix-repo",
    prompt:
      `Here is a JavaScript codebase.\n\n${shown(files)}\n\nThis test fails:\n\n\`\`\`js\n${testCode}\n\`\`\`\n\nIts output:\n\n\`\`\`\n${output}\n\`\`\`\n\n` +
      "Find the cause in the codebase and fix it. Reply with code only: every function you change, in full. The other files are already loaded, so do not repeat them.",
    buggyCode: source(files),
    maxTokens: REPO_TOKENS,
    checks: [{ type: "jsTests", entry: ENTRY, cases, setup: source(files), harness }],
  };
}

const c = (args, expect) => ({ args, expect });

/** Codebase changes across functions and fixes from test output: six of each. */
export function changeAndTracePrompts() {
  return [
    change("planner-priority", "Add task priorities", PLANNER,
      'Tasks get a priority. addTask takes an optional fifth argument priority, one of "low", "normal" or "high" (default "normal"), and stores it on the task as priority; ' +
      'summaryLine puts "!" right before the title of a high-priority task.',
      `function scenario(adds) {
  var store = newStore();
  for (var i = 0; i < adds.length; i++) addTask.apply(null, [store].concat(adds[i]));
  return [summary(store), store.tasks.map(function (task) { return task.priority; })];
}`, [
        c([[["Write", "2026-03-02", 2, "high"], ["Read", "2026-03-01", 1]]], ["#1 !Write (due 2026-03-02)\n#2 Read (due 2026-03-01)", ["high", "normal"]]),
        c([[["Plan", "2026-01-05", 3, "low"]]], ["#1 Plan (due 2026-01-05)", ["low"]]),
      ]),
    change("planner-done-day", "Record the day a task was done", PLANNER,
      'Record when a task is done: complete(store, id, today) takes the day as a "YYYY-MM-DD" string and stores it on the task as doneOn, a day number like due; ' +
      'summaryLine then shows ", done " and that day (for example "(due 2026-03-05, done 2026-03-04)") instead of just ", done".',
      `function scenario(today) {
  var store = newStore();
  addTask(store, "Ship", "2026-03-05", 4);
  addTask(store, "Test", "2026-03-06", 2);
  complete(store, 1, today);
  return [summary(store), store.tasks[0].doneOn === parseDay(today)];
}`, [
        c(["2026-03-04"], ["#1 Ship (due 2026-03-05, done 2026-03-04)\n#2 Test (due 2026-03-06)", true]),
        c(["2026-02-28"], ["#1 Ship (due 2026-03-05, done 2026-02-28)\n#2 Test (due 2026-03-06)", true]),
      ]),
    change("planner-tag-hours", "Hours per tag", PLANNER,
      'Make tagTask also accept several tags separated by commas, such as "ui, Docs", adding each one. Then add a function hoursByTag(store) to src/progress.js that returns [tag, hours] pairs sorted by tag: ' +
      "for every tag on at least one open task, the sum of the estimates of the open tasks with that tag.",
      `function scenario(tagging, doneIds) {
  var store = newStore();
  addTask(store, "A", "2026-01-01", 3);
  addTask(store, "B", "2026-01-02", 5);
  addTask(store, "C", "2026-01-03", 2);
  for (var i = 0; i < tagging.length; i++) tagTask(findTask(store, tagging[i][0]), tagging[i][1]);
  for (var j = 0; j < doneIds.length; j++) complete(store, doneIds[j]);
  return hoursByTag(store);
}`, [
        c([[[1, "ui, Docs"], [2, "ui"], [3, "docs"]], []], [["docs", 5], ["ui", 8]]),
        c([[[1, "x"], [2, " X ,y"]], [2]], [["x", 3]]),
      ]),
    change("ledger-fee", "Charge a transfer fee", LEDGER,
      "Every transfer now costs the sender a fee of 1% of the amount, rounded to the nearest minor unit, on top of the amount. " +
      "Refuse a transfer the sender cannot cover including the fee, and record the fee in the history entry as fee, in minor units.",
      `function scenario(opening, amounts) {
  var book = newBook();
  openAccount(book, "ann", opening);
  openAccount(book, "bob", 0);
  var results = [];
  for (var i = 0; i < amounts.length; i++) results.push(transfer(book, "ann", "bob", amounts[i]));
  return [results, balanceOf(book, "ann"), balanceOf(book, "bob"), book.history.map(function (entry) { return entry.fee; })];
}`, [
        c([100, [50, 49.5]], [[true, false], 49.5, 50, [50]]),
        c([10, [9.9]], [[true], 0, 9.9, [10]]),
      ]),
    change("order-codes", "Stack discount codes", ORDERS,
      "Discount codes become case-insensitive, so discountRate accepts a code in any case. Then add a function totalDiscountRate(codes) to src/discounts.js that takes an array of codes " +
      "and combines their rates so each applies to the price left by the others (10% and 50% leave 45% of the price, a combined rate of 0.55), " +
      "counting a code given twice once and ignoring unknown codes. Round the combined rate to 4 decimal places.",
      `function scenario(codes) {
  return [totalDiscountRate(codes), discountRate(codes.length ? codes[0] : "")];
}`, [
        c([["welcome10", "HALF"]], [0.55, 0.1]),
        c([["Half", "half"]], [0.5, 0.5]),
        c([[]], [0, 0]),
        c([["NOPE", "WELCOME10"]], [0.1, 0]),
      ]),
    change("markdown-ordered", "Add numbered lists", MARKDOWN,
      'Add numbered lists to render: a line made of digits, a dot and a space (such as "1. text" or "10. text") is a numbered item, rendered as <li> inside <ol>. ' +
      "Moving between - items and numbered items closes one list and opens the other, and any other line closes an open list, as it does for - items.",
      `function scenario(markdown) {
  return render(markdown);
}`, [
        c(["1. a\n2. b"], "<ol>\n<li>a</li>\n<li>b</li>\n</ol>"),
        c(["- x\n1. y\ntext"], "<ul>\n<li>x</li>\n</ul>\n<ol>\n<li>y</li>\n</ol>\n<p>text</p>"),
        c(["# T\n10. ten"], "<h1>T</h1>\n<ol>\n<li>ten</li>\n</ol>"),
        c(["- a\n- b"], "<ul>\n<li>a</li>\n<li>b</li>\n</ul>"),
      ]),

    traceFix("trace-due-month", "Fix the due dates from a test", withFile(PLANNER, "src/dates.js", "parts[1] - 1", "parts[1]"),
      `test("summary shows each task's due date", () => {
  const store = newStore();
  addTask(store, "Ship", "2026-03-05", 1);
  assert.equal(summary(store), "#1 Ship (due 2026-03-05)");
});`,
      `✖ summary shows each task's due date
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  + actual - expected

  + '#1 Ship (due 2026-04-05)'
  - '#1 Ship (due 2026-03-05)'

      at TestContext.<anonymous> (tests/summary.test.js:4:10)`,
      `function scenario(due) {
  var store = newStore();
  addTask(store, "Ship", due, 1);
  return summary(store);
}`, [c(["2026-03-05"], "#1 Ship (due 2026-03-05)"), c(["2026-12-31"], "#1 Ship (due 2026-12-31)"), c(["2026-01-31"], "#1 Ship (due 2026-01-31)")]),
    traceFix("trace-tag-case", "Fix tag lookups from a test", withFile(PLANNER, "src/tags.js", "function tagTask(task, tag) {\n  const clean = normalizeTag(tag);", "function tagTask(task, tag) {\n  const clean = tag.trim();"),
      `test("withTag finds tasks tagged in any case", () => {
  const store = newStore();
  tagTask(addTask(store, "Fix login", "2026-03-01", 2), "UI");
  assert.deepEqual(withTag(store, "ui").map((task) => task.title), ["Fix login"]);
});`,
      `✖ withTag finds tasks tagged in any case
  AssertionError [ERR_ASSERTION]: Expected values to be loosely deep-equal:

  []

  should loosely deep-equal

  [
    'Fix login'
  ]
      at TestContext.<anonymous> (tests/tags.test.js:4:10)`,
      `function scenario(tags, query) {
  var store = newStore();
  var task = addTask(store, "Fix login", "2026-03-01", 2);
  for (var i = 0; i < tags.length; i++) tagTask(task, tags[i]);
  return [withTag(store, query).map(function (item) { return item.title; }), task.tags];
}`, [c([["UI"], "ui"], [["Fix login"], ["ui"]]), c([[" Docs ", "docs"], "DOCS"], [["Fix login"], ["docs"]]), c([["api"], "web"], [[], ["api"]])]),
    traceFix("trace-account-key", "Fix a crash from its stack trace", withFile(LEDGER, "src/accounts.js", "book.accounts[owner] = {", "book.accounts[owner.toLowerCase()] = {"),
      `test("payday moves money between named accounts", () => {
  const book = newBook();
  openAccount(book, "Ann", 100);
  openAccount(book, "Bob", 0);
  assert.equal(transfer(book, "Ann", "Bob", 30), true);
});`,
      `✖ payday moves money between named accounts
  Error: no account for Ann
      at getAccount (src/accounts.js:11:23)
      at transfer (src/transfer.js:3:18)
      at TestContext.<anonymous> (tests/payday.test.js:5:16)`,
      `function scenario(from, to, amount) {
  var book = newBook();
  openAccount(book, from, 100);
  openAccount(book, to, 0);
  var moved = transfer(book, from, to, amount);
  return [moved, balanceOf(book, from), balanceOf(book, to), Object.keys(book.accounts).sort()];
}`, [c(["Ann", "Bob", 30], [true, 70, 30, ["Ann", "Bob"]]), c(["ann", "Zed", 5], [true, 95, 5, ["Zed", "ann"]])]),
    traceFix("trace-order-weight", "Fix shipping from a test", withFile(ORDERS, "src/orders.js", "itemOf(line.sku).grams * line.qty, 0)", "itemOf(line.sku).grams * line.qty)"),
      `test("an order of one mug ships for $4", () => {
  assert.equal(shippingCost(orderWeightKg([{ sku: "mug", qty: 1 }])), 4);
});`,
      `✖ an order of one mug ships for $4
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:

  null !== 4

      at TestContext.<anonymous> (tests/checkout.test.js:2:10)`,
      `function scenario(lines) {
  return shippingCost(orderWeightKg(lines));
}`, [c([[{ sku: "mug", qty: 1 }]], 4), c([[{ sku: "tea", qty: 3 }, { sku: "mug", qty: 2 }]], 4), c([[{ sku: "kettle", qty: 4 }]], 9)]),
    traceFix("trace-hashtag", "Fix headings from a test", withFile(MARKDOWN, "src/blocks.js", "/^(#{1,6}) /", "/^(#{1,6})/"),
      `test("a hashtag at the start of a line is a paragraph", () => {
  assert.equal(render("#hashtag rocks"), "<p>#hashtag rocks</p>");
});`,
      `✖ a hashtag at the start of a line is a paragraph
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  + actual - expected

  + '<h1>ashtag rocks</h1>'
  - '<p>#hashtag rocks</p>'

      at TestContext.<anonymous> (tests/render.test.js:2:10)`,
      `function scenario(markdown) {
  return render(markdown);
}`, [c(["#hashtag rocks"], "<p>#hashtag rocks</p>"), c(["## Title"], "<h2>Title</h2>"), c(["#1 fan"], "<p>#1 fan</p>")]),
    traceFix("trace-cents", "Fix lost cents from a test", withFile(LEDGER, "src/money.js", "Math.round(amount * 100)", "Math.floor(amount * 100)"),
      `test("an opening balance keeps its cents", () => {
  const book = newBook();
  openAccount(book, "a", 0.29);
  assert.equal(balanceOf(book, "a"), 0.29);
});`,
      `✖ an opening balance keeps its cents
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:

  0.28 !== 0.29

      at TestContext.<anonymous> (tests/report.test.js:4:10)`,
      `function scenario(opening) {
  var book = newBook();
  openAccount(book, "a", opening);
  return balanceOf(book, "a");
}`, [c([0.29], 0.29), c([1.15], 1.15), c([10], 10)]),
  ];
}
