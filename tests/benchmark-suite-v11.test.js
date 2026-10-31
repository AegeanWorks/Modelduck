import assert from "node:assert/strict";
import test from "node:test";

import { moreRepoPrompts } from "../benchmarks/repo-items-v11.mjs";
import { PROMPTS, SUITE_VERSION, runJavaScriptTests } from "../benchmarks/suite.mjs";
import { taskPrompts } from "../benchmarks/tasks.mjs";

/** Reference answers written against each codebase's own helpers. */
const REFERENCE = {
  runTransfers: `function runTransfers(openings, transfers) {
    const book = newBook();
    for (const owner of Object.keys(openings)) openAccount(book, owner, openings[owner]);
    for (const [from, to, amount] of transfers) {
      if (book.accounts[from] && book.accounts[to]) transfer(book, from, to, amount);
    }
    return Object.keys(book.accounts).sort().map((owner) => [owner, balanceOf(book, owner)]);
  }`,
  withinDailyLimit: `function withinDailyLimit(book, owner, amount) {
    const sent = book.history.filter((entry) => entry.from === owner).reduce((sum, entry) => sum + entry.minor, 0);
    return sent + toMinor(amount) <= DAILY_LIMIT;
  }`,
  canWithdraw: `function canWithdraw(account, minor) {
    return !account.frozen && minor > 0 && account.balance >= minor;
  }`,
  quote: `function quote(lines, code) {
    if (!lines.every((line) => inStock(line.sku, line.qty))) return null;
    const shipping = shippingCost(orderWeightKg(lines));
    if (shipping === null) return null;
    const items = itemsTotal(lines);
    const discount = items * discountRate(code);
    return [items, discount, shipping, items - discount + shipping];
  }`,
  heaviestLine: `function heaviestLine(lines) {
    let best = null;
    for (const line of lines) {
      const grams = itemOf(line.sku).grams * line.qty;
      if (!best || grams > best.grams) best = { sku: line.sku, grams };
    }
    return best && best.sku;
  }`,
  shippingCost: `function shippingCost(kg) {
    for (const rate of RATES) if (kg <= rate.upToKg) return rate.cost;
    return null;
  }`,
  tableOfContents: `function tableOfContents(markdown) {
    return markdown.split("\\n").filter((line) => headingLevel(line)).map((line) => {
      const level = headingLevel(line);
      return "  ".repeat(level - 1) + "- " + line.slice(level + 1);
    });
  }`,
  firstParagraph: `function firstParagraph(markdown) {
    const line = markdown.split("\\n").find((text) => text.trim() && !headingLevel(text) && !isListItem(text));
    return line ? renderInline(line) : "";
  }`,
  escapeHtml: `function escapeHtml(text) {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }`,
};

/** Each located bug: the culprit's correct version and a call that shows the bug. */
const LOCATE = {
  "repo-find-history": {
    fixed: "function transfer(book, from, to, amount) { const minor = toMinor(amount); const source = getAccount(book, from); const target = getAccount(book, to); if (!canWithdraw(source, minor)) return false; source.balance -= minor; target.balance += minor; book.history.push({ from: from, to: to, minor: minor }); return true; }",
    probe: "(() => { const book = newBook(); openAccount(book, 'a', 100); openAccount(book, 'b', 0); transfer(book, 'a', 'b', 25.5); return book.history[0].minor; })()",
    expect: 2550,
  },
  "repo-find-units": { fixed: "function gramsToKg(grams) { return grams / 1000; }", probe: "shippingCost(orderWeightKg([{ sku: 'mug', qty: 1 }]))", expect: 4 },
  "repo-find-list-end": {
    fixed: "function render(markdown) { const out = []; let inList = false; for (const line of markdown.split('\\n')) { if (isListItem(line)) { if (!inList) { out.push('<ul>'); inList = true; } out.push('<li>' + renderInline(line.slice(2)) + '</li>'); continue; } if (inList) { out.push('</ul>'); inList = false; } const level = headingLevel(line); if (level) out.push('<h' + level + '>' + renderInline(line.slice(level + 1)) + '</h' + level + '>'); else if (line.trim()) out.push('<p>' + renderInline(line) + '</p>'); } if (inList) out.push('</ul>'); return out.join('\\n'); }",
    probe: "render('- a\\n- b')",
    expect: "<ul>\n<li>a</li>\n<li>b</li>\n</ul>",
  },
};

const run = (setup, answer, entry, args) => {
  try {
    return JSON.stringify(new Function(`${setup}\n;${answer}\n;return ${entry};`)()(...structuredClone(args)));
  } catch (error) {
    return `threw ${error.message}`;
  }
};
const items = moreRepoPrompts();

test("suite v11 adds twelve items on three larger codebases, all in the code task", () => {
  assert.ok(SUITE_VERSION >= 11);
  assert.ok(PROMPTS.length >= 268);
  assert.equal(items.length, 12);
  assert.equal(new Set(PROMPTS.map((prompt) => prompt.id)).size, PROMPTS.length, "ids stay unique");
  const code = new Set(taskPrompts("code").map((prompt) => prompt.id));
  for (const item of items) {
    assert.ok(code.has(item.id), item.id);
    assert.ok(item.prompt.split("// file: ").length - 1 >= 5, `${item.id} shows at least five files`);
  }
});

test("every v11 test case passes with a reference answer on top of its codebase", () => {
  for (const item of items.filter((entry) => entry.checks[0].type === "jsTests")) {
    const check = item.checks[0];
    for (const testCase of check.cases) {
      assert.equal(run(check.setup, REFERENCE[check.entry], check.entry, testCase.args), JSON.stringify(testCase.expect), `${item.id} ${JSON.stringify(testCase.args)}`);
    }
  }
});

test("v11 implement items are new functions and v11 shipped bugs fail their tests", () => {
  for (const item of items.filter((entry) => entry.checks[0].type === "jsTests")) {
    const check = item.checks[0];
    if (item.category === "code-repo") {
      assert.match(run(check.setup, "", check.entry, check.cases[0].args), /^threw/, item.id);
    } else {
      const failing = check.cases.filter((testCase) => run(check.setup, "", check.entry, testCase.args) !== JSON.stringify(testCase.expect));
      assert.ok(failing.length > 0, `${item.id} ships code that already passes`);
    }
  }
});

test("every v11 located bug shows in its probe and goes away when the named function is fixed", () => {
  for (const item of items.filter((entry) => entry.checks[0].type === "oneOf")) {
    const { fixed, probe, expect } = LOCATE[item.id];
    const evaluate = (extra) => new Function(`${item.buggyCode}\n;${extra}\n;return ${probe};`)();
    assert.notDeepEqual(evaluate(""), expect, `${item.id} bug does not show`);
    assert.deepEqual(evaluate(fixed), expect, `${item.id} culprit fix does not cure it`);
    assert.ok(fixed.startsWith(`function ${item.checks[0].values[0]}(`), `${item.id} names the fixed function`);
  }
});

test("a v11 answer runs after its codebase in the sandbox", async () => {
  const item = items.find((entry) => entry.id === "repo-heaviest-line");
  const results = await runJavaScriptTests(`\`\`\`js\n${REFERENCE.heaviestLine}\n\`\`\``, item.checks[0]);
  assert.deepEqual(results.map((result) => result.passed), [true, true, true]);
});
