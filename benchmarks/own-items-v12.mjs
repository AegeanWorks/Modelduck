/**
 * Suite v12 (ADR-053): chat questions that test what chat needs (following an
 * instruction, a format, a length, a constraint) and long-context questions of
 * kinds the generated lookups lack (two-step lookups, event order, absence,
 * cross-references). Every item has a reference reply that passes and a wrong
 * one that fails, in tests/benchmark-suite-v12.test.js.
 */

const chat = (id, category, prompt, checks, maxTokens = 128) => ({ id: `chat-${id}`, label: `Chat: ${id.replaceAll("-", " ")}`, category, prompt, maxTokens, checks });
const regex = (pattern, flags = "i") => ({ type: "regex", pattern, flags });

/** Following instructions and formats, the way a chat is used. */
export function moreChatPrompts() {
  return [
    chat("bullets", "format", "List the three primary colours of paint as bullet points, one per line, and nothing else.",
      [{ type: "bulletCount", count: 3 }, { type: "containsAll", values: ["red", "yellow", "blue"] }]),
    chat("opposite", "instruction", "In one word, what is the opposite of 'hot'?", [{ type: "exact", value: "cold" }], 16),
    chat("short-rain", "instruction", "Write one sentence about rain in no more than 8 words.",
      [{ type: "maxWords", count: 8 }, { type: "contains", value: "rain" }], 32),
    chat("shout-ready", "format", "Reply with the word ready in capital letters and nothing else.", [regex(String.raw`^READY[.!]?$`, "")], 16),
    chat("json-person", "format", "Return only a JSON object for a person called Ada who is 36, with the keys name and age. No code fences.",
      [{ type: "json", keys: ["name", "age"] }, { type: "jsonValue", key: "name", value: "Ada" }, { type: "jsonValue", key: "age", value: 36 }], 64),
    chat("translate", "instruction", "Translate 'good morning' into Spanish. Reply with the translation only.",
      [{ type: "oneOf", values: ["buenos días", "buenos dias"] }], 16),
    chat("synonyms", "format", "Give exactly two synonyms for 'happy', separated by a comma, and nothing else.",
      [{ type: "commaCount", count: 2 }, { type: "notContains", value: "happy" }], 32),
    chat("sleep-brief", "instruction", "In at most 25 words, explain why people need sleep.",
      [{ type: "maxWords", count: 25 }, { type: "containsAny", values: ["rest", "energy", "recover", "repair", "memory", "brain", "body"] }], 64),
    chat("digits", "format", "Write the numbers one to five as digits separated by single spaces, and nothing else.", [regex(String.raw`^1 2 3 4 5\.?$`)], 16),
    chat("yes-star", "instruction", "Reply with yes or no only: is the Sun a star?", [{ type: "exact", value: "yes" }], 8),
    chat("backwards", "instruction", "Spell the word duck backwards in lowercase. Reply with that word only.", [{ type: "exact", value: "kcud" }], 8),
    chat("no-e", "instruction", "Write a short phrase about a cat without using the letter e anywhere.",
      [regex(String.raw`^[^e]+$`), { type: "contains", value: "cat" }], 32),
    chat("fruit-label", "format", "Name one yellow fruit. Start your reply with 'Fruit:'.",
      [regex(String.raw`^Fruit:`), { type: "containsAny", values: ["banana", "lemon", "pineapple", "mango", "quince", "grapefruit"] }], 16),
    chat("end-done", "format", "Say hello, and end your reply with the word done.",
      [regex(String.raw`done[.!]?$`), { type: "containsAny", values: ["hello", "hi"] }], 32),
    chat("caps-capital", "format", "Write the capital of France in capital letters and nothing else.", [regex(String.raw`^PARIS[.!]?$`, "")], 8),
    chat("countdown", "format", "Count down from 10 to 7, one number per line, and nothing else.",
      [regex(String.raw`^10\s*\n\s*9\s*\n\s*8\s*\n\s*7\s*$`)], 24),
    chat("past-tense", "instruction", "Rewrite in the past tense, and reply with the sentence only: 'She walks to school.'",
      [{ type: "oneOf", values: ["she walked to school", "she walked to school."] }], 24),
    chat("dog-title", "instruction", "Give a title, under 6 words, for a story about a lost dog. Reply with the title only.",
      [{ type: "maxWords", count: 5 }, { type: "containsAny", values: ["dog", "puppy", "hound", "pup"] }], 24),
    chat("even-array", "format", "Return only a JSON array of the first three positive even numbers. No code fences.",
      [regex(String.raw`^\s*\[\s*2\s*,\s*4\s*,\s*6\s*\]\s*$`)], 24),
    chat("three-words", "instruction", "Write one sentence that uses the words river, bridge and night.",
      [{ type: "containsAll", values: ["river", "bridge", "night"] }], 48),
    chat("no-digits", "instruction", "Do not write any digits. How many legs does a spider have?",
      [regex(String.raw`^\D+$`), { type: "contains", value: "eight" }], 24),
    chat("lowercase-grass", "format", "Reply in lowercase letters only: what colour is grass?",
      [{ type: "noUppercase" }, { type: "contains", value: "green" }], 16),
    chat("winter-words", "format", "Give exactly four words describing winter, separated by commas, and nothing else.", [{ type: "commaCount", count: 4 }], 32),
    chat("summary", "instruction", "In at most 12 words, summarise: 'The meeting moved from Monday to Wednesday because the room was booked.'",
      [{ type: "maxWords", count: 12 }, { type: "contains", value: "wednesday" }], 32),
    chat("iso-date", "format", "Write the date 31 October 2026 in the form YYYY-MM-DD. Reply with the date only.", [{ type: "exact", value: "2026-10-31" }], 16),
    chat("alphabetical", "instruction", "Put these words in alphabetical order, separated by single spaces: banana apple cherry. Reply with the words only.",
      [{ type: "exact", value: "apple banana cherry" }], 16),
    chat("decline", "instruction", "Write one polite sentence declining an invitation to dinner.",
      [{ type: "maxWords", count: 30 }, { type: "containsAny", values: ["sorry", "unfortunately", "regret", "unable", "can't", "cannot", "won't be able"] }], 48),
    chat("letters", "instruction", "How many letters are in the word planet? Reply with the digit only.", [{ type: "exact", value: "6" }], 8),
    chat("yaml-city", "format", "Return only YAML with one key, city, set to Rome. No code fences.", [regex(String.raw`^city:\s*["']?rome["']?\s*$`)], 16),
    chat("table", "format", "Make a Markdown table with the columns Animal and Sound, and one row each for dog and cat.",
      [regex(String.raw`\|\s*animal\s*\|\s*sound\s*\|`), { type: "containsAny", values: ["bark", "woof"] }, { type: "containsAny", values: ["meow", "miaow", "purr"] }], 96),
  ];
}

/** Small deterministic generator (LCG, high bits) so the documents never change between runs. */
function generator(seed) {
  let state = seed >>> 0;
  return (limit) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return (state >>> 16) % limit;
  };
}

const NAMES = ["Ana", "Ben", "Cleo", "Dara", "Eli", "Fay", "Gus", "Hana", "Ivo", "Jun", "Kai", "Lena", "Milo", "Nia", "Omar", "Pia", "Quinn", "Rosa", "Sami", "Tess"];
const TEAMS = ["Atlas", "Beacon", "Comet", "Delta", "Ember", "Falcon"];
const recall = (id, label, prompt, checks) => ({ id: `context-v12-${id}`, label, category: "context", prompt, maxTokens: 24, checks });

/** A staff directory: who reports to whom, and where each person sits. */
function directory(seed) {
  const next = generator(seed);
  const people = NAMES.map((name, index) => ({ name, room: 100 + index * 7 + next(5), team: TEAMS[next(TEAMS.length)] }));
  for (const [index, person] of people.entries()) person.manager = index === 0 ? null : people[next(index)].name;
  const text = people.map((person) => `${person.name} works in team ${person.team}, sits in room ${person.room}${person.manager ? ` and reports to ${person.manager}` : " and leads the department"}.`).join("\n");
  return { people, text };
}

/** Long-context questions that need more than one lookup, an order, an absence or a cross-reference. */
export function moreContextPrompts() {
  const items = [];
  for (const [index, seed] of [11, 23, 37, 41].entries()) {
    const { people, text } = directory(seed);
    const person = people[8 + index * 3];
    const manager = people.find((entry) => entry.name === person.manager);
    items.push(recall(`manager-room-${index}`, "Two-step lookup", `Here is the staff directory.\n${text}\n\nIn which room does ${person.name}'s manager sit? Reply with only the room number.`,
      [{ type: "exact", value: String(manager.room) }]));
  }
  for (const [index, seed] of [5, 9].entries()) {
    const next = generator(seed);
    const events = Array.from({ length: 24 }, (_, step) => ({ day: 1 + step, what: `delivery ${String.fromCharCode(65 + next(26))}${100 + next(900)}` }));
    const [first, second] = [events[3 + index * 5], events[16 + index * 3]];
    // Shuffled with the same seed, so the dates must be read, not the line order.
    const lines = events.map((event) => `October ${event.day}: ${event.what} arrived.`);
    for (let at = lines.length - 1; at > 0; at -= 1) {
      const other = next(at + 1);
      [lines[at], lines[other]] = [lines[other], lines[at]];
    }
    const log = lines.join("\n");
    items.push(recall(`order-${index}`, "Which came first", `Here is the arrival log.\n${log}\n\nWhich arrived first, ${second.what} or ${first.what}? Reply with only its name.`,
      [{ type: "exact", value: first.what }]));
  }
  for (const [index, seed] of [3, 7].entries()) {
    const next = generator(seed);
    const parcels = Array.from({ length: 30 }, () => `P-${100 + next(800)}`);
    // P-999 is outside the generated range, so the first asks about a parcel that is not there.
    const asked = index === 0 ? "P-999" : parcels[17];
    items.push(recall(`absent-${index}`, "Is it there", `Here is the parcel list.\n${parcels.map((parcel, step) => `${step + 1}. ${parcel}`).join("\n")}\n\nIs parcel ${asked} on the list? Reply with yes or no only.`,
      [{ type: "exact", value: index === 0 ? "no" : "yes" }]));
  }
  for (const [index, seed] of [13, 17, 19, 29].entries()) {
    const { people, text } = directory(seed);
    // The code is defined once at the top for the asked person's own team; the person appears far below.
    const member = people[12 + index * 2];
    const code = `${member.team.slice(0, 3).toUpperCase()}-${40 + index * 9}`;
    const body = `Note: team ${member.team}'s budget code is ${code}; other teams use the shared code GEN-00.\n\n${text}`;
    items.push(recall(`cross-ref-${index}`, "Definition at the start, used at the end", `Here are the department notes.\n${body}\n\nWhat budget code does ${member.name}'s team use? Reply with only the code.`,
      [{ type: "exact", value: code }]));
  }
  return items;
}
