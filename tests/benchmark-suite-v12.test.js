import assert from "node:assert/strict";
import test from "node:test";

import { moreContextPrompts } from "../benchmarks/own-items-v12.mjs";
import { PROMPTS, SUITE_VERSION, evaluateTextCheck } from "../benchmarks/suite.mjs";
import { taskPrompts } from "../benchmarks/tasks.mjs";

const passesAll = (item, reply) => item.checks.every((check) => evaluateTextCheck(check, reply).passed);

test("suite v12 keeps twelve long-context items in the recall task", () => {
  assert.ok(SUITE_VERSION >= 12);
  assert.ok(PROMPTS.length >= 198);
  assert.equal(new Set(PROMPTS.map((prompt) => prompt.id)).size, PROMPTS.length, "ids stay unique");
  const recallIds = new Set(taskPrompts("recall").map((prompt) => prompt.id));
  assert.ok(moreContextPrompts().every((item) => recallIds.has(item.id)));
  assert.equal(moreContextPrompts().length, 12);
});

/** The answer read back from the document in the prompt, independently of how it was built. */
function contextAnswer(item) {
  const lines = item.prompt.split("\n");
  const question = lines.at(-1);
  if (item.id.includes("manager-room")) {
    const person = question.match(/does (\w+)'s manager/)[1];
    const manager = lines.find((line) => line.startsWith(`${person} works`)).match(/reports to (\w+)/)[1];
    return lines.find((line) => line.startsWith(`${manager} works`)).match(/room (\d+)/)[1];
  }
  if (item.id.includes("order")) {
    const [, left, right] = question.match(/first, (.+?) or (.+?)\?/);
    const day = (what) => Number(lines.find((line) => line.includes(`${what} arrived`)).match(/October (\d+)/)[1]);
    return day(left) < day(right) ? left : right;
  }
  if (item.id.includes("absent")) {
    const parcel = question.match(/parcel (P-\d+)/)[1];
    return lines.some((line) => line.endsWith(` ${parcel}`)) ? "yes" : "no";
  }
  const person = question.match(/does (\w+)'s team/)[1];
  const team = lines.find((line) => line.startsWith(`${person} works`)).match(/team (\w+)/)[1];
  return lines[1].includes(`team ${team}'s budget code is`) ? lines[1].match(/code is ([A-Z]+-\d+)/)[1] : "GEN-00";
}

test("every long-context answer can be read back from its own document", () => {
  for (const item of moreContextPrompts()) {
    assert.equal(contextAnswer(item), String(item.checks[0].value), item.id);
    assert.ok(evaluateTextCheck(item.checks[0], `Answer: ${item.checks[0].value}`).passed, item.id);
    assert.ok(item.prompt.length < 5000, `${item.id} fits a 2048-token context`);
  }
});

test("the new check types count bullets and words and need every listed word", () => {
  assert.equal(evaluateTextCheck({ type: "bulletCount", count: 2 }, "* one\n2. two").passed, true);
  assert.equal(evaluateTextCheck({ type: "bulletCount", count: 2 }, "- one").passed, false);
  assert.equal(evaluateTextCheck({ type: "maxWords", count: 3 }, "one two three").passed, true);
  assert.equal(evaluateTextCheck({ type: "maxWords", count: 3 }, "one two three four").passed, false);
  assert.equal(evaluateTextCheck({ type: "containsAll", values: ["a", "b"] }, "A and B").passed, true);
  assert.equal(evaluateTextCheck({ type: "containsAll", values: ["a", "zz"] }, "A and B").passed, false);
});
