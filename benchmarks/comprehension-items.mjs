/**
 * Code comprehension: read a small JavaScript function and report what it returns.
 * The expected value is computed from the exact source shown in the prompt, so a
 * changed snippet and its check cannot drift apart.
 */

const COMPREHENSION_BANK = [
  {
    name: "sumTo",
    code: "function sumTo(n) { let total = 0; for (let i = 1; i <= n; i += 1) total += i; return total; }",
    cases: [[0], [1], [3], [5], [10], [25], [50], [100]],
  },
  {
    name: "clamp",
    code: "function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }",
    cases: [[5, 0, 10], [-1, 0, 10], [12, 0, 10], [3, 3, 3], [0, 1, 2], [2, 1, 2], [-5, -3, -1], [100, 0, 99]],
  },
  {
    name: "reverseText",
    code: 'function reverseText(text) { return [...text].reverse().join(""); }',
    cases: [["duck"], ["abc"], ["hello"], ["racecar"], ["ModelDuck"], ["a"], ["ab"], ["xyz"]],
  },
  {
    name: "countVowels",
    code: 'function countVowels(text) { return [...text.toLowerCase()].filter((letter) => "aeiou".includes(letter)).length; }',
    cases: [["duck"], ["aeiou"], ["rhythm"], ["ModelDuck"], ["banana"], ["queue"], ["xyz"], ["hello"]],
  },
  {
    name: "isEven",
    code: "function isEven(n) { return n % 2 === 0; }",
    cases: [[0], [2], [7], [-4], [-3], [1], [100], [99]],
  },
  {
    name: "maxOfThree",
    code: "function maxOfThree(a, b, c) { return Math.max(a, b, c); }",
    cases: [[1, 2, 3], [-1, -5, -2], [10, 10, 9], [0, 0, 0], [5, 9, 2], [-10, -20, -30], [100, 1, 99], [7, 7, 7]],
  },
  {
    name: "factorial",
    code: "function factorial(n) { if (n <= 1) return 1; let result = 1; for (let i = 2; i <= n; i += 1) result *= i; return result; }",
    cases: [[0], [1], [2], [3], [4], [5], [6], [8]],
  },
  {
    name: "repeatWord",
    code: 'function repeatWord(word, times) { return Array.from({ length: times }, () => word).join("-"); }',
    cases: [["duck", 1], ["quack", 3], ["a", 2], ["go", 4], ["hi", 2], ["z", 5], ["ab", 3], ["m", 1]],
  },
];

for (const entry of COMPREHENSION_BANK) {
  entry.run = new Function(`${entry.code}\nreturn ${entry.name};`)();
}

function formatArgs(values) {
  return values.map((value) => JSON.stringify(value)).join(", ");
}

/** 64 code-reading items: eight functions, eight inputs each. */
export function codeComprehensionPrompts() {
  return COMPREHENSION_BANK.flatMap((entry) =>
    entry.cases.map((values, index) => ({
      id: `read-${entry.name}-${index + 1}`,
      group: entry.name,
      label: `Read ${entry.name} #${index + 1}`,
      category: "code-comprehension",
      prompt:
        "Read this JavaScript function:\n\n" +
        "```js\n" +
        `${entry.code}\n` +
        "```\n\n" +
        `What does ${entry.name}(${formatArgs(values)}) return? Reply with only the value.`,
      maxTokens: 32,
      checks: [{ type: "exact", value: String(entry.run(...values)) }],
    })),
  );
}
