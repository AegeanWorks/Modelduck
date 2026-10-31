import assert from "node:assert/strict";
import test from "node:test";

import { moreKnowledgePrompts, moreLongBugPrompts, moreLongCodePrompts, moreMathPromptsV13 } from "../benchmarks/own-items-v13.mjs";
import { PROMPTS, SUITE_VERSION, evaluateTextCheck } from "../benchmarks/suite.mjs";
import { taskHoldout, taskPrompts, taskRungs } from "../benchmarks/tasks.mjs";
import { REFERENCE_V13 as REFERENCE } from "./reference-solutions-v13.js";

const run = (code, entry, args) => {
  try {
    return JSON.stringify(new Function(`${code}\n;return ${entry};`)()(...structuredClone(args)));
  } catch (error) {
    return `threw ${error.message}`;
  }
};

const coding = [...moreLongCodePrompts(), ...moreLongBugPrompts()];
const count = (category) => PROMPTS.filter((prompt) => prompt.category === category).length;

test("suite v13 brings every thin question type to at least twelve items and math to 64", () => {
  assert.equal(SUITE_VERSION, 13);
  assert.equal(PROMPTS.length, 310 + 34);
  assert.equal(new Set(PROMPTS.map((prompt) => prompt.id)).size, PROMPTS.length, "ids stay unique");
  for (const category of ["knowledge", "code-long", "bugfix-long"]) assert.equal(count(category), 12, category);
  assert.equal(taskPrompts("math").length, 64);
  assert.equal(taskRungs("math").at(-1).length, 48, "math tunes on 48 like chat and code");
  assert.equal(taskHoldout("math").length, 16);
});

test("every new long function passes its cases with a reference answer", () => {
  for (const item of coding) {
    const check = item.checks[0];
    assert.ok(REFERENCE[check.entry], `${item.id} has a reference`);
    for (const testCase of check.cases) {
      assert.equal(run(REFERENCE[check.entry], check.entry, testCase.args), JSON.stringify(testCase.expect), `${item.id} ${JSON.stringify(testCase.args)}`);
    }
  }
});

test("every new buggy function is long and fails its own tests", () => {
  for (const item of moreLongBugPrompts()) {
    const check = item.checks[0];
    assert.ok(item.buggyCode.split("\n").length >= 8, `${item.id} is a long function`);
    assert.equal(item.maxTokens, 1024, item.id);
    const failing = check.cases.filter((testCase) => run(item.buggyCode, check.entry, testCase.args) !== JSON.stringify(testCase.expect));
    assert.ok(failing.length >= 2, `${item.id} has more than one failing case`);
  }
});

/** Each math answer worked out again, independently of the number in the item. */
const DERIVED = {
  "math-bus-seats": Math.ceil(175 / 40),
  "math-bike-price": 200 * 0.85 - 20,
  "math-cars-meet": 300 / (70 + 80),
  "math-garden-fence": 4 * Math.sqrt(144),
  "math-coins": [...Array(30).keys()].find((quarters) => 25 * quarters + 10 * (quarters + 5) === 225),
  "math-interest": (1500 * 4 * 3) / 100,
  "math-juice-mix": [...Array(30).keys()].find((added) => (3 + added) * 2 === 10 + added),
  "math-book-pages": (240 - (240 * 3) / 8) * (2 / 3),
  "math-even-numbers": 78 / 3 + 2,
  "math-overtime": 40 * 18 + 6 * 18 * 1.5,
  "math-flour-bag": 2000 - 2 * 750,
  "math-father-daughter": [...Array(52).keys()].find((daughter) => 52 - daughter - 6 === 4 * (daughter - 6)),
  "math-tickets": [...Array(31).keys()].find((adults) => 12 * adults + 7 * (30 - adults) === 285),
};

test("every new math answer matches an independent calculation", () => {
  const items = moreMathPromptsV13();
  assert.equal(items.length, 13);
  for (const item of items) assert.equal(item.checks[0].value, DERIVED[item.id], item.id);
});

test("every knowledge item passes the right answer and fails a wrong one", () => {
  const replies = {
    "knowledge-photosynthesis": ["C", "A"], "knowledge-shakespeare": ["B", "D"], "knowledge-gold-symbol": ["Au", "Ag"],
    "knowledge-largest-ocean": ["D", "A"], "knowledge-hexagon": ["6", "8"], "knowledge-boiling-point": ["B) 100", "C"],
    "knowledge-japan-capital": ["Tokyo", "Kyoto"], "knowledge-heart": ["C", "A"], "knowledge-smallest-prime": ["C", "B"],
  };
  for (const item of moreKnowledgePrompts()) {
    const [good, bad] = replies[item.id];
    assert.equal(evaluateTextCheck(item.checks[0], good).passed, true, `${item.id} rejects ${good}`);
    assert.equal(evaluateTextCheck(item.checks[0], bad).passed, false, `${item.id} accepts ${bad}`);
  }
});
