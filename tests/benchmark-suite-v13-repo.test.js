import assert from "node:assert/strict";
import test from "node:test";

import { changeAndTracePrompts } from "../benchmarks/repo-items-v13.mjs";
import { PROMPTS, runJavaScriptTests } from "../benchmarks/suite.mjs";
import { taskPrompts } from "../benchmarks/tasks.mjs";

/** Reference replies: every function each item needs added or changed. */
const REFERENCE = {
  "repo-planner-priority": `function addTask(store, title, due, estimate, priority) {
  const task = { id: store.nextId, title: title, due: parseDay(due), estimate: estimate, done: false, tags: [], priority: priority || "normal" };
  store.nextId += 1;
  store.tasks.push(task);
  return task;
}
function summaryLine(task) {
  return "#" + task.id + " " + (task.priority === "high" ? "!" : "") + task.title + " (due " + formatDay(task.due) + (task.done ? ", done" : "") + ")";
}`,
  "repo-planner-done-day": `function complete(store, id, today) {
  const task = findTask(store, id);
  task.done = true;
  task.doneOn = parseDay(today);
}
function summaryLine(task) {
  return "#" + task.id + " " + task.title + " (due " + formatDay(task.due) + (task.done ? ", done " + formatDay(task.doneOn) : "") + ")";
}`,
  "repo-planner-tag-hours": `function tagTask(task, tags) {
  for (const tag of tags.split(",")) {
    const clean = normalizeTag(tag);
    if (clean && !task.tags.includes(clean)) task.tags.push(clean);
  }
  return task;
}
function hoursByTag(store) {
  const hours = {};
  for (const task of store.tasks.filter((item) => !item.done)) for (const tag of task.tags) hours[tag] = (hours[tag] || 0) + task.estimate;
  return Object.keys(hours).sort().map((tag) => [tag, hours[tag]]);
}`,
  "repo-ledger-fee": `function transfer(book, from, to, amount) {
  const minor = toMinor(amount);
  const fee = Math.round(minor * 0.01);
  const source = getAccount(book, from);
  const target = getAccount(book, to);
  if (!canWithdraw(source, minor + fee)) return false;
  source.balance -= minor + fee;
  target.balance += minor;
  book.history.push({ from: from, to: to, minor: minor, fee: fee });
  return true;
}`,
  "repo-order-codes": `function discountRate(code) {
  const upper = String(code).toUpperCase();
  if (upper === "WELCOME10") return 0.1;
  if (upper === "HALF") return 0.5;
  return 0;
}
function totalDiscountRate(codes) {
  const unique = [...new Set(codes.map((code) => code.toUpperCase()))];
  const left = unique.reduce((share, code) => share * (1 - discountRate(code)), 1);
  return Math.round((1 - left) * 10000) / 10000;
}`,
  "repo-markdown-ordered": `function isOrderedItem(line) {
  return /^\\d+\\. /.test(line);
}
function render(markdown) {
  const out = [];
  let open = null;
  for (const line of markdown.split("\\n")) {
    const kind = isListItem(line) ? "ul" : isOrderedItem(line) ? "ol" : null;
    if (open && kind !== open) { out.push("</" + open + ">"); open = null; }
    if (kind) {
      if (!open) { out.push("<" + kind + ">"); open = kind; }
      out.push("<li>" + renderInline(line.slice(line.indexOf(" ") + 1)) + "</li>");
      continue;
    }
    const level = headingLevel(line);
    if (level) out.push("<h" + level + ">" + renderInline(line.slice(level + 1)) + "</h" + level + ">");
    else if (line.trim()) out.push("<p>" + renderInline(line) + "</p>");
  }
  if (open) out.push("</" + open + ">");
  return out.join("\\n");
}`,
  "repo-trace-due-month": `function parseDay(text) {
  const parts = text.split("-").map(Number);
  return Date.UTC(parts[0], parts[1] - 1, parts[2]) / 86400000;
}`,
  "repo-trace-tag-case": `function tagTask(task, tag) {
  const clean = normalizeTag(tag);
  if (!task.tags.includes(clean)) task.tags.push(clean);
  return task;
}`,
  "repo-trace-account-key": `function openAccount(book, owner, opening) {
  book.accounts[owner] = { owner: owner, balance: toMinor(opening || 0), frozen: false };
  return book.accounts[owner];
}`,
  "repo-trace-order-weight": `function orderWeightKg(lines) {
  return gramsToKg(lines.reduce((sum, line) => sum + itemOf(line.sku).grams * line.qty, 0));
}`,
  "repo-trace-hashtag": `function headingLevel(line) {
  const match = /^(#{1,6}) /.exec(line);
  return match ? match[1].length : 0;
}`,
  "repo-trace-cents": `function toMinor(amount) {
  return Math.round(amount * 100);
}`,
};

/** What the shipped codebase really does in each failing test, quoted in its output. */
const OBSERVED = {
  "repo-trace-due-month": ["(() => { const store = newStore(); addTask(store, 'Ship', '2026-03-05', 1); return summary(store); })()", "#1 Ship (due 2026-04-05)"],
  "repo-trace-tag-case": ["(() => { const store = newStore(); tagTask(addTask(store, 'Fix login', '2026-03-01', 2), 'UI'); return JSON.stringify(withTag(store, 'ui')); })()", "[]"],
  "repo-trace-account-key": ["(() => { try { const book = newBook(); openAccount(book, 'Ann', 100); openAccount(book, 'Bob', 0); transfer(book, 'Ann', 'Bob', 30); return 'no error'; } catch (error) { return error.message; } })()", "no account for Ann"],
  "repo-trace-order-weight": ["String(shippingCost(orderWeightKg([{ sku: 'mug', qty: 1 }])))", "null !== 4"],
  "repo-trace-hashtag": ["render('#hashtag rocks')", "<h1>ashtag rocks</h1>"],
  "repo-trace-cents": ["(() => { const book = newBook(); openAccount(book, 'a', 0.29); return String(balanceOf(book, 'a')); })()", "0.28 !== 0.29"],
};

const items = changeAndTracePrompts();

/** One scenario case run in-process: the codebase, then a reply, then the hidden scenario. */
const run = (check, reply, args) => {
  try {
    return JSON.stringify(new Function(`${check.setup}\n;${reply}\n;${check.harness}\n;return ${check.entry};`)()(...structuredClone(args)));
  } catch (error) {
    return `threw ${error.message}`;
  }
};

test("suite v13 adds six multi-function changes and six fixes from test output to the code task", () => {
  assert.equal(items.length, 12);
  assert.equal(items.filter((item) => item.category === "code-repo").length, 6);
  assert.equal(items.filter((item) => item.category === "bugfix-repo").length, 6);
  const code = new Set(taskPrompts("code").map((prompt) => prompt.id));
  const ids = new Set(PROMPTS.map((prompt) => prompt.id));
  for (const item of items) {
    assert.ok(code.has(item.id) && ids.has(item.id), `${item.id} is in the code task`);
    assert.ok(item.checks[0].harness.includes("function scenario("), `${item.id} has a hidden scenario`);
    assert.ok(!item.prompt.includes("scenario"), `${item.id} keeps its scenario hidden`);
  }
});

test("every v13 codebase case passes with the reference reply and fails on the unchanged codebase", () => {
  for (const item of items) {
    const check = item.checks[0];
    for (const testCase of check.cases) {
      assert.equal(run(check, REFERENCE[item.id], testCase.args), JSON.stringify(testCase.expect), `${item.id} ${JSON.stringify(testCase.args)}`);
    }
    const failing = check.cases.filter((testCase) => run(check, "", testCase.args) !== JSON.stringify(testCase.expect));
    assert.ok(failing.length > 0, `${item.id} already passes without a change`);
  }
});

test("every quoted test output is what the shipped codebase really does", () => {
  for (const item of items.filter((entry) => entry.category === "bugfix-repo")) {
    const [probe, shown] = OBSERVED[item.id];
    const actual = new Function(`${item.buggyCode}\n;return ${probe};`)();
    assert.ok(shown.includes(actual), `${item.id}: the codebase gives ${actual}`);
    assert.ok(item.prompt.includes(shown), `${item.id} quotes ${shown}`);
  }
});

test("a change spread over several code blocks is run whole, with the hidden scenario after it", async () => {
  const item = items.find((entry) => entry.id === "repo-planner-priority");
  const [addTask, summaryLine] = REFERENCE[item.id].split("\nfunction summaryLine");
  const reply = `First the store:\n\`\`\`js\n${addTask}\n\`\`\`\nThen the summary:\n\`\`\`js\nfunction summaryLine${summaryLine}\n\`\`\``;
  const results = await runJavaScriptTests(reply, item.checks[0]);
  assert.deepEqual(results.map((result) => result.passed), [true, true]);
  assert.deepEqual(results.map((result) => result.unreadable), [false, false]);
  const prose = await runJavaScriptTests("I would add a priority field.", item.checks[0]);
  assert.deepEqual(prose.map((result) => [result.passed, result.unreadable]), [[false, true], [false, true]], "a reply with no function is unreadable");
});
