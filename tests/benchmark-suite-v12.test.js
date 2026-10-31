import assert from "node:assert/strict";
import test from "node:test";

import { moreChatPrompts, moreContextPrompts } from "../benchmarks/own-items-v12.mjs";
import { PROMPTS, SUITE_VERSION, evaluateTextCheck } from "../benchmarks/suite.mjs";
import { taskPrompts } from "../benchmarks/tasks.mjs";

/** For every chat item: a reply that does what was asked, and a plausible one that does not. */
const REPLIES = {
  "chat-bullets": ["- red\n- yellow\n- blue", "red, yellow, blue"],
  "chat-opposite": ["Cold.", "warm"],
  "chat-short-rain": ["Rain fell softly on the roof.", "The rain kept falling on the old tin roof all through the long night."],
  "chat-shout-ready": ["READY", "ready"],
  "chat-json-person": ['{"name": "Ada", "age": 36}', '{"name": "Ada", "age": "36"}'],
  "chat-translate": ["Buenos días", "Bonjour"],
  "chat-synonyms": ["joyful, cheerful", "joyful, cheerful, glad"],
  "chat-sleep-brief": ["Sleep lets the body and brain rest and recover.", "Because it is night and most people go to bed when it gets dark outside, so they close their eyes and stay in bed until the morning comes again."],
  "chat-digits": ["1 2 3 4 5", "1, 2, 3, 4, 5"],
  "chat-yes-star": ["Yes.", "No."],
  "chat-backwards": ["kcud", "kucd"],
  "chat-no-e": ["a cat on a mat", "the cat sat"],
  "chat-fruit-label": ["Fruit: banana", "Banana"],
  "chat-end-done": ["Hello! I am done.", "Done. Hello!"],
  "chat-caps-capital": ["PARIS", "Paris"],
  "chat-countdown": ["10\n9\n8\n7", "10, 9, 8, 7"],
  "chat-past-tense": ["She walked to school.", "She is walking to school."],
  "chat-dog-title": ["The Lost Dog", "A Long Story About A Very Lost Little Dog"],
  "chat-even-array": ["[2, 4, 6]", "[0, 2, 4]"],
  "chat-three-words": ["At night the river ran under the old bridge.", "The river ran under the old bridge."],
  "chat-no-digits": ["A spider has eight legs.", "A spider has 8 legs."],
  "chat-lowercase-grass": ["grass is green.", "Grass is green."],
  "chat-winter-words": ["cold, snowy, dark, quiet", "cold, snowy, dark"],
  "chat-summary": ["Meeting moved to Wednesday because the room was booked.", "The Monday meeting was cancelled."],
  "chat-iso-date": ["2026-10-31", "31-10-2026"],
  "chat-alphabetical": ["apple banana cherry", "banana apple cherry"],
  "chat-decline": ["Thank you for the invitation, but unfortunately I cannot come to dinner.", "Yes, I would love to come to dinner!"],
  "chat-letters": ["6", "7"],
  "chat-yaml-city": ["city: Rome", '{"city": "Rome"}'],
  "chat-table": ["| Animal | Sound |\n|---|---|\n| dog | woof |\n| cat | meow |", "dog: woof, cat: meow"],
};

const passesAll = (item, reply) => item.checks.every((check) => evaluateTextCheck(check, reply).passed);

test("suite v12 adds 30 chat items and 12 long-context items, all in their tasks", () => {
  assert.ok(SUITE_VERSION >= 12);
  assert.ok(PROMPTS.length >= 268 + 42, "the exact total is pinned by the latest suite test");
  assert.equal(new Set(PROMPTS.map((prompt) => prompt.id)).size, PROMPTS.length, "ids stay unique");
  const chatIds = new Set(taskPrompts("chat").map((prompt) => prompt.id));
  const recallIds = new Set(taskPrompts("recall").map((prompt) => prompt.id));
  assert.ok(moreChatPrompts().every((item) => chatIds.has(item.id)));
  assert.ok(moreContextPrompts().every((item) => recallIds.has(item.id)));
  assert.equal(moreChatPrompts().length, 30);
  assert.equal(moreContextPrompts().length, 12);
});

test("every chat item passes a reply that does what was asked and fails one that does not", () => {
  for (const item of moreChatPrompts()) {
    const [good, bad] = REPLIES[item.id] ?? [];
    assert.ok(good !== undefined, `${item.id} has reference replies`);
    assert.ok(passesAll(item, good), `${item.id} rejects a good reply: ${good}`);
    assert.equal(passesAll(item, bad), false, `${item.id} accepts a bad reply: ${bad}`);
  }
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
