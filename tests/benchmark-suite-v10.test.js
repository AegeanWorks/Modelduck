import assert from "node:assert/strict";
import test from "node:test";

import { moreMathPrompts, moreRecallPrompts } from "../benchmarks/own-items-v10.mjs";
import { PROMPTS, SUITE_VERSION, evaluateTextCheck, runJavaScriptTests } from "../benchmarks/suite.mjs";
import { taskPrompts } from "../benchmarks/tasks.mjs";

/** Each answer worked out again, independently of the item text. */
const MATH_REFERENCE = {
  "math-pens-price": (27 / 3) * 2,
  "math-train-distance": (240 / 3) * 5,
  "math-mother-age": (() => { for (let son = 1; son < 100; son += 1) if (4 * son + 20 === 2 * (son + 20)) return 4 * son; return null; })(),
  "math-tank-fill": 1200 - 1200 * 0.35,
  "math-workers-days": (7 * 12) / 21,
  "math-jacket-price": 80 * 0.75 * 1.1,
  "math-sum-to-fifty": Array.from({ length: 50 }, (_, index) => index + 1).reduce((a, b) => a + b, 0),
  "math-rectangle-area": 15 * (46 / 2 - 15),
  "math-remainder": 1000 % 37,
  "math-cookie-eggs": (60 / 12) * 3,
  "math-marbles": (54 / 3) * 2,
  "math-fuel": (350 / 100) * 6,
  "math-clock-minutes": 9 * 60 + 45 + 2 * 60 + 50,
  "math-test-average": 87 * 5 - 85 * 4,
  "math-ball-percent": (7 / (5 + 7 + 8)) * 100,
  "math-reverse-percent": 96 / 1.2,
  "math-reading-days": Math.ceil((400 - 130) / 18),
  "math-notebook-price": (13 - 7) / 2,
  "math-tile-count": (10 / 2) * (14 / 2),
  "math-phone-bill": 15 + 230 * 0.1,
  "math-population": 8000 * 1.1 * 1.1,
  "math-savings": Array.from({ length: 6 }, (_, week) => 12 + 3 * week).reduce((a, b) => a + b, 0),
  "math-common-multiple": (() => { for (let n = 1; ; n += 1) if (n % 4 === 0 && n % 6 === 0 && n % 10 === 0) return n; })(),
  "math-rope-pieces": 7.5 / 0.25,
  "math-work-hours": (17 * 60 + 15 - (8 * 60 + 30) - 45) / 60,
  "math-class-ratio": (40 / 8) * 5,
  "math-triangle-angle": Math.max(60, ((180 - 60) / 3) * 2),
  "math-apple-price": (9 / 12) * 20,
  "math-powers": 2 ** 10 - 10 ** 2,
  "math-average-speed": (15 * 2 + 10 * 3) / 5,
};

const lines = (prompt) => prompt.split("\n");

/** The answer read back from the item's own text, the way a careful reader would. */
function recallAnswer(item) {
  const question = lines(item.prompt).at(-1);
  if (item.id.includes("-pin-")) {
    const badge = question.match(/badge (\d+)/)[1];
    return lines(item.prompt).find((line) => line.startsWith(`Badge ${badge}:`)).match(/PIN (\d+)/)[1];
  }
  if (item.id.includes("-holder-")) {
    const pin = question.match(/PIN (\d+)/)[1];
    return lines(item.prompt).find((line) => line.includes(`PIN ${pin},`)).match(/holder (\w+)/)[1].toLowerCase();
  }
  if (item.id.includes("-status-")) {
    const parcel = question.match(/parcel (P-\d+)/)[1];
    return lines(item.prompt).filter((line) => line.includes(`Parcel ${parcel} `)).at(-1).match(/now (\w+)\./)[1];
  }
  if (item.id.includes("-sum-")) {
    const [first, second] = [...question.matchAll(/balance of (\w+)/g)].map((match) => match[1]);
    const balance = (name) => Number(lines(item.prompt).find((line) => line.startsWith(`Account of ${name}:`)).match(/balance (\d+)/)[1]);
    return balance(first) + balance(second);
  }
  const colour = question.match(/colour (\w+)\?/)[1];
  return lines(item.prompt).filter((line) => line.endsWith(`colour ${colour}.`)).length;
}

test("suite v10 gives math and recall at least 51 items each", () => {
  assert.equal(SUITE_VERSION, 10);
  assert.equal(PROMPTS.length, 256);
  assert.equal(new Set(PROMPTS.map((prompt) => prompt.id)).size, PROMPTS.length, "ids stay unique");
  assert.equal(taskPrompts("math").length, 51);
  assert.equal(taskPrompts("recall").length, 51);
});

test("every new math answer matches an independent calculation", () => {
  const items = moreMathPrompts();
  assert.equal(items.length, 30);
  for (const item of items) {
    assert.equal(item.checks[0].value, MATH_REFERENCE[item.id], item.id);
    assert.ok(Number.isInteger(item.checks[0].value), `${item.id} has a whole-number answer`);
    assert.equal(evaluateTextCheck(item.checks[0], `So the result is: Answer: ${item.checks[0].value}`).passed, true, item.id);
  }
});

test("every generated recall answer can be read back from its own text, and only once", () => {
  const items = moreRecallPrompts();
  assert.equal(items.length, 40);
  for (const item of items) {
    assert.equal(String(recallAnswer(item)), String(item.checks[0].value), item.id);
    assert.ok(item.prompt.length < 5000, `${item.id} fits a 2048-token context`);
  }
  for (const item of items.filter((entry) => /-(pin|holder)-/.test(entry.id))) {
    const [, field, value] = lines(item.prompt).at(-1).match(/(badge|PIN) (\d+)/);
    const marker = field === "badge" ? `Badge ${value}:` : `PIN ${value},`;
    assert.equal(lines(item.prompt).filter((line) => line.includes(marker)).length, 1, `${item.id} names its key once`);
  }
});

test("the generated registers are the same on every run", () => {
  assert.deepEqual(moreRecallPrompts(), moreRecallPrompts());
  assert.notEqual(moreRecallPrompts()[0].prompt, moreRecallPrompts()[1].prompt);
});

/** Reference answers for the codebase items, written against each codebase's own helpers. */
const REPO_REFERENCE = {
  cartTotalCents: `function cartTotalCents(lines) {
    return lines.reduce((sum, line) => sum + lineCents(line) + taxCents(lineCents(line), findProduct(line.sku).taxable), 0);
  }`,
  receipt: `function receipt(lines) {
    return [...lines.map((line) => line.qty + " x " + findProduct(line.sku).name + ": " + formatCents(lineCents(line))), "Subtotal: " + formatCents(cartSubtotalCents(lines))];
  }`,
  formatCents: `function formatCents(cents) {
    const sign = cents < 0 ? "-" : "";
    const abs = Math.abs(cents);
    return sign + "$" + Math.floor(abs / 100) + "." + String(abs % 100).padStart(2, "0");
  }`,
  searchDocs: `function searchDocs(docs, query) {
    const index = buildIndex(docs);
    const words = tokenize(query).filter((word) => !isStopword(word));
    if (!words.length) return [];
    return words.map((word) => index.get(word) ?? []).reduce((left, right) => left.filter((id) => right.includes(id))).sort((a, b) => a - b);
  }`,
  slugify: `function slugify(title) {
    const words = tokenize(title);
    const kept = words.filter((word) => !isStopword(word));
    return (kept.length ? kept : words).join("-");
  }`,
  tokenize: `function tokenize(text) {
    return normalize(text).split(/[^a-z0-9]+/).filter(Boolean);
  }`,
  firstFreeSlot: `function firstFreeSlot(meetings, minutes, dayStart, dayEnd) {
    const slots = meetings.map(toSlot).sort((a, b) => a.start - b.start);
    for (let start = parseTime(dayStart); start + minutes <= parseTime(dayEnd); start += 1) {
      if (!slots.some((slot) => overlaps(slot, { start, end: start + minutes }))) return formatTime(start);
    }
    return null;
  }`,
  endTimes: `function endTimes(meetings) {
    return meetings.map((meeting) => [meeting.title, formatTime(toSlot(meeting).end)]);
  }`,
  overlaps: `function overlaps(a, b) {
    return a.start < b.end && b.start < a.end;
  }`,
};

/** What each locate item's culprit should be, and a call that shows the bug. */
const LOCATE_REFERENCE = {
  "repo-find-tax": { fixed: "function taxCents(cents, taxable) { return taxable ? Math.round(cents * TAX_RATE) : 0; }", probe: "cartSubtotalCents([{ sku: 'lamp', qty: 1 }]) + taxCents(1999, true)", expect: 2159 },
  "repo-find-accents": { fixed: 'function normalize(text) { return text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""); }', probe: "buildIndex([{ id: 1, text: 'Café Paris' }]).has('cafe')", expect: true },
  "repo-find-midnight": { fixed: "function formatTime(minutes) { return String(Math.floor(minutes / 60) % 24).padStart(2, '0') + ':' + String(minutes % 60).padStart(2, '0'); }", probe: "formatTime(toSlot({ at: '23:30', minutes: 90 }).end)", expect: "01:00" },
};

const run = (setup, answer, entry, args) => {
  try {
    return JSON.stringify(new Function(`${setup}\n;${answer}\n;return ${entry};`)()(...structuredClone(args)));
  } catch (error) {
    return `threw ${error.message}`;
  }
};
const repoItems = PROMPTS.filter((prompt) => prompt.category.endsWith("-repo"));

test("codebase items: six to implement, three to fix, three to locate, all in the code task", () => {
  assert.equal(repoItems.length, 12);
  assert.equal(repoItems.filter((item) => item.category === "bugfix-repo").length, 3);
  assert.equal(repoItems.filter((item) => item.checks[0].type === "oneOf").length, 3);
  const code = new Set(taskPrompts("code").map((item) => item.id));
  for (const item of repoItems) {
    assert.ok(code.has(item.id), item.id);
    assert.ok(item.prompt.split("// file: ").length - 1 >= 4, `${item.id} shows a multi-file codebase`);
  }
});

test("every codebase test case passes with a reference answer on top of the codebase", () => {
  for (const item of repoItems.filter((entry) => entry.checks[0].type === "jsTests")) {
    const check = item.checks[0];
    for (const testCase of check.cases) {
      assert.equal(run(check.setup, REPO_REFERENCE[check.entry], check.entry, testCase.args), JSON.stringify(testCase.expect), `${item.id} ${JSON.stringify(testCase.args)}`);
    }
  }
});

test("every implement item asks for a function the codebase does not have yet", () => {
  for (const item of repoItems.filter((entry) => entry.category === "code-repo" && entry.checks[0].type === "jsTests")) {
    const check = item.checks[0];
    assert.match(run(check.setup, "", check.entry, check.cases[0].args), /^threw/, item.id);
  }
});

test("every shipped codebase bug fails its own tests", () => {
  for (const item of repoItems.filter((entry) => entry.category === "bugfix-repo")) {
    const check = item.checks[0];
    const failing = check.cases.filter((testCase) => run(check.setup, "", check.entry, testCase.args) !== JSON.stringify(testCase.expect));
    assert.ok(failing.length > 0, `${item.id} ships code that already passes`);
  }
});

test("every located bug shows in its probe and goes away when the named function is fixed", () => {
  for (const item of repoItems.filter((entry) => entry.checks[0].type === "oneOf")) {
    const { fixed, probe, expect } = LOCATE_REFERENCE[item.id];
    const evaluate = (extra) => new Function(`${item.buggyCode}\n;${extra}\n;return ${probe};`)();
    assert.notDeepEqual(evaluate(""), expect, `${item.id} bug does not show`);
    assert.deepEqual(evaluate(fixed), expect, `${item.id} culprit fix does not cure it`);
    assert.ok(fixed.startsWith(`function ${item.checks[0].values[0]}(`), `${item.id} names the fixed function`);
  }
});

test("a codebase answer runs after the codebase in the sandbox", async () => {
  const item = repoItems.find((entry) => entry.id === "repo-end-times");
  const results = await runJavaScriptTests(`\`\`\`js\n${REPO_REFERENCE.endTimes}\n\`\`\``, item.checks[0]);
  assert.deepEqual(results.map((result) => result.passed), [true, true]);
});
