import assert from "node:assert/strict";
import test from "node:test";

import { codeComprehensionPrompts } from "../benchmarks/comprehension-items.mjs";
import { moreLongBugPrompts, moreLongCodePrompts } from "../benchmarks/own-items-v13.mjs";
import { PROMPTS, SMOKE_PROMPT_IDS, SUITE_VERSION, evaluateTextCheck } from "../benchmarks/suite.mjs";
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

test("suite v14 is code, code comprehension and long context only", () => {
  assert.equal(SUITE_VERSION, 14);
  assert.equal(PROMPTS.length, 262);
  assert.equal(new Set(PROMPTS.map((prompt) => prompt.id)).size, PROMPTS.length, "ids stay unique");
  assert.equal(count("code"), 30);
  assert.equal(count("code-long"), 12);
  assert.equal(count("bugfix"), 26);
  assert.equal(count("bugfix-long"), 12);
  assert.equal(count("code-repo"), 24);
  assert.equal(count("bugfix-repo"), 12);
  assert.equal(count("public-code"), 20);
  assert.equal(count("code-comprehension"), 64);
  assert.equal(count("context"), 14);
  assert.equal(count("recall"), 48);
  for (const removed of ["instruction", "format", "comprehension", "knowledge", "facts", "reasoning", "public-math", "public-knowledge", "public-truthful"]) {
    assert.equal(count(removed), 0, `${removed} should not be in the coding suite`);
  }
  assert.equal(PROMPTS.some((prompt) => prompt.id === "squad"), false, "the short prose comprehension item is gone");
  for (const id of SMOKE_PROMPT_IDS) assert.ok(PROMPTS.some((prompt) => prompt.id === id), id);
});

test("the three tasks have full rungs and a held-back quarter", () => {
  assert.equal(taskPrompts("code").length, 136);
  assert.equal(taskPrompts("comprehension").length, 64);
  assert.equal(taskPrompts("recall").length, 62);
  assert.deepEqual(taskRungs("code").map((rung) => rung.length), [12, 24, 48]);
  assert.deepEqual(taskRungs("comprehension").map((rung) => rung.length), [12, 24, 48]);
  assert.deepEqual(taskRungs("recall").map((rung) => rung.length), [12, 24, 46]);
  assert.equal(taskHoldout("comprehension").length, 16);
  assert.equal(taskHoldout("recall").length, 16);
  const comprehension = taskPrompts("comprehension");
  const held = new Set(taskHoldout("comprehension"));
  const groups = [...new Set(comprehension.map((item) => item.group))];
  assert.equal(groups.length, 8, "each comprehension function is its own family");
  for (const group of groups) {
    const family = comprehension.filter((item) => item.group === group);
    assert.equal(family.length, 8, `${group} has eight inputs`);
    assert.equal(family.filter((item) => held.has(item.id)).length, 2, `${group} holds back two inputs`);
  }
  assert.equal(new Set(comprehension.filter((item) => held.has(item.id)).map((item) => item.group)).size, 8);
});

test("the 16-item smoke set covers every task and every comprehension family", () => {
  assert.equal(SMOKE_PROMPT_IDS.length, 16);
  const smoke = SMOKE_PROMPT_IDS.map((id) => PROMPTS.find((item) => item.id === id));
  assert.ok(smoke.every(Boolean));
  assert.ok(smoke.some((item) => item.category === "recall"));
  assert.ok(smoke.some((item) => item.category === "context"));
  assert.ok(smoke.some((item) => item.category === "code-repo"));
  const families = new Set(smoke.filter((item) => item.category === "code-comprehension").map((item) => item.group));
  assert.equal(families.size, 5);
});

test("every code-comprehension item asks about the code it shows and has an exact answer", () => {
  const items = codeComprehensionPrompts();
  assert.equal(items.length, 64);
  assert.equal(new Set(items.map((item) => item.id)).size, items.length);
  const task = new Set(taskPrompts("comprehension").map((item) => item.id));
  for (const item of items) {
    assert.ok(task.has(item.id), item.id);
    assert.equal(item.category, "code-comprehension");
    assert.equal(item.maxTokens, 32);
    assert.match(item.prompt, /function\s+\w+/);
    assert.match(item.prompt, new RegExp(`\\b${item.id.split("-")[1]}\\(`));
    assert.equal(item.checks.length, 1);
    assert.equal(item.checks[0].type, "exact");
    assert.equal(evaluateTextCheck(item.checks[0], item.checks[0].value).passed, true, item.id);
  }
  assert.equal(items.find((item) => item.id === "read-sumTo-5").checks[0].value, "55");
  assert.equal(items.find((item) => item.id === "read-factorial-5").checks[0].value, "24");
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
