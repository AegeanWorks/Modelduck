/**
 * Suite v13 (ADR-060): the thin question types brought to at least twelve
 * items each (knowledge, long functions, long bug fixes) and math to 64, so
 * it tunes on 48 like chat and code. References, failing buggy versions and
 * independently derived math answers live in tests/benchmark-suite-v13.test.js.
 */

const LONG_TOKENS = 1024;
const MATH_SUFFIX = 'Show your reasoning, then end with exactly "Answer: <number>".';

const c = (args, expect) => ({ args, expect });

const choice = (id, label, question, options, letter) => ({
  id: `knowledge-${id}`,
  label,
  category: "knowledge",
  prompt: `${question}\n${options.map((option, index) => `${"ABCD"[index]}) ${option}`).join("\n")}\nAnswer with only the letter.`,
  maxTokens: 16,
  checks: [{ type: "choice", value: letter }],
});

const exact = (id, label, prompt, value) => ({ id: `knowledge-${id}`, label, category: "knowledge", prompt, maxTokens: 16, checks: [{ type: "exact", value }] });

/** General knowledge, mostly multiple choice. */
export function moreKnowledgePrompts() {
  return [
    choice("photosynthesis", "Gas plants take in", "Which gas do plants take in from the air for photosynthesis?", ["Oxygen", "Nitrogen", "Carbon dioxide", "Helium"], "c"),
    choice("shakespeare", "Author of Romeo and Juliet", "Who wrote Romeo and Juliet?", ["Charles Dickens", "William Shakespeare", "Jane Austen", "Mark Twain"], "b"),
    exact("gold-symbol", "Symbol for gold", "What is the chemical symbol for gold? Reply with only the symbol.", "au"),
    choice("largest-ocean", "Largest ocean", "What is the largest ocean on Earth?", ["Atlantic", "Indian", "Arctic", "Pacific"], "d"),
    exact("hexagon", "Sides of a hexagon", "How many sides does a hexagon have? Reply with only the number.", "6"),
    choice("boiling-point", "Boiling point of water", "At sea level, at what temperature in degrees Celsius does water boil?", ["90", "100", "110", "120"], "b"),
    exact("japan-capital", "Capital of Japan", "What is the capital of Japan? Reply with only the city name.", "tokyo"),
    choice("heart", "Organ that pumps blood", "Which organ pumps blood through the human body?", ["Lungs", "Liver", "Heart", "Kidneys"], "c"),
    choice("smallest-prime", "Smallest prime", "Which is the smallest prime number?", ["0", "1", "2", "3"], "c"),
  ];
}

function longCode(id, label, spec, entry, cases) {
  return {
    id: `code-long-${id}`,
    label,
    category: "code-long",
    prompt: `Write a JavaScript function named ${entry} that ${spec} Reply with code only.`,
    maxTokens: LONG_TOKENS,
    checks: [{ type: "jsTests", entry, cases }],
  };
}

function longBug(id, label, buggyCode, should, entry, cases) {
  return {
    id: `bug-long-${id}`,
    label,
    category: "bugfix-long",
    prompt: `This JavaScript function has bugs:\n${buggyCode}\nIt should ${should} Fix every bug. Reply with code only, keeping the function name ${entry}.`,
    buggyCode,
    maxTokens: LONG_TOKENS,
    checks: [{ type: "jsTests", entry, cases }],
  };
}

const emptyGrid = () => Array.from({ length: 9 }, () => Array(9).fill(0));
const solvedGrid = () => Array.from({ length: 9 }, (_, row) => Array.from({ length: 9 }, (_, col) => ((row * 3 + Math.floor(row / 3) + col) % 9) + 1));
const gridWith = (cells) => {
  const grid = emptyGrid();
  for (const [row, col, value] of cells) grid[row][col] = value;
  return grid;
};

/** Long functions to write: each needs several rules kept at once. */
export function moreLongCodePrompts() {
  return [
    longCode("lru", "Least-recently-used cache",
      'simulates a least-recently-used cache of the given capacity. Its arguments are capacity and ops, an array of operations: ["put", key, value] stores value under key, and ["get", key] reads it. ' +
      "A get that finds its key and every put count as using that key. When a put adds a new key to a full cache, first remove the least recently used key. " +
      "Return an array with the result of every get, in order: the value, or null when the key is not in the cache.",
      "lruSimulate", [
        c([2, [["put", "a", 1], ["put", "b", 2], ["get", "a"], ["put", "c", 3], ["get", "b"], ["get", "a"], ["get", "c"]]], [1, null, 1, 3]),
        c([1, [["put", "x", 1], ["put", "x", 2], ["get", "x"]]], [2]),
        c([2, [["get", "z"]]], [null]),
        c([2, [["put", "a", 1], ["put", "b", 2], ["put", "a", 5], ["put", "c", 3], ["get", "b"], ["get", "a"]]], [null, 5]),
      ]),
    longCode("query", "Parse a query string",
      'parses a URL query string such as "?a=1&b=x+y" into an object. A leading "?" is optional. Pairs are separated by "&", and a key is separated from its value by the first "="; ' +
      'a pair without "=" has the value "" (an empty string). In keys and values, decode "+" as a space and percent escapes such as %20. ' +
      "A key that appears more than once maps to an array of its values in order. Skip empty pairs. An empty string gives an empty object.",
      "parseQuery", [
        c(["?a=1&b=x+y"], { a: "1", b: "x y" }),
        c(["tag=red&tag=blue&tag=green"], { tag: ["red", "blue", "green"] }),
        c(["q=caf%C3%A9&flag&&x=1%3D2"], { q: "café", flag: "", x: "1=2" }),
        c([""], {}),
        c(["a=b=c"], { a: "b=c" }),
      ]),
    longCode("topo-sort", "Order tasks by their dependencies",
      "takes deps, an object mapping each task name to an array of the task names it depends on, and returns every task name in an order where each task comes after everything it depends on. " +
      "A name that appears only as a dependency is a task too. At each step, take the alphabetically first task whose dependencies are all already placed. " +
      "Return null when the dependencies form a cycle.",
      "topoSort", [
        c([{ b: ["a"], c: ["a", "b"], a: [] }], ["a", "b", "c"]),
        c([{ deploy: ["build", "test"], test: ["build"], build: [], docs: [] }], ["build", "docs", "test", "deploy"]),
        c([{ x: ["y"], y: ["x"] }], null),
        c([{ app: ["lib"] }], ["lib", "app"]),
      ]),
    longCode("text-table", "Format a text table",
      "takes rows, an array of arrays of strings whose first row is the header, and returns the table as an array of lines. " +
      'Pad every cell with spaces on the right to the width of the widest cell in its column, and join the cells of a row with " | ". ' +
      'After the header line add a separator line: for each column, "-" repeated to its width, joined with "-+-". Trailing spaces stay. ' +
      "A row with fewer cells than the header is filled with empty cells.",
      "formatTable", [
        c([[["name", "qty"], ["apple", "3"], ["fig", "12"]]], ["name  | qty", "------+----", "apple | 3  ", "fig   | 12 "]),
        c([[["a"], ["bb"]]], ["a ", "--", "bb"]),
        c([[["k", "v"], ["x"]]], ["k | v", "--+--", "x |  "]),
      ]),
    longCode("next-date", "The next calendar day",
      'takes a date string "YYYY-MM-DD" and returns the next day as a string in the same format. Use the Gregorian leap-year rule: a year divisible by 4 is a leap year, ' +
      "except a year divisible by 100 that is not divisible by 400. Do not use the Date object.",
      "nextDate", [
        c(["2024-02-28"], "2024-02-29"),
        c(["2023-02-28"], "2023-03-01"),
        c(["1900-02-28"], "1900-03-01"),
        c(["2000-02-28"], "2000-02-29"),
        c(["2023-12-31"], "2024-01-01"),
        c(["2023-04-30"], "2023-05-01"),
      ]),
    longCode("sudoku", "Check a Sudoku grid",
      "takes grid, 9 rows of 9 numbers where 0 is an empty cell and 1 to 9 are filled cells, and returns true when no number from 1 to 9 appears twice in any row, any column or any of the nine 3 by 3 boxes, otherwise false.",
      "isValidSudoku", [
        c([emptyGrid()], true),
        c([solvedGrid()], true),
        c([gridWith([[0, 0, 5], [0, 8, 5]])], false),
        c([gridWith([[1, 4, 7], [8, 4, 7]])], false),
        c([gridWith([[3, 3, 2], [5, 5, 2]])], false),
      ]),
  ];
}

/** Long functions with more than one bug each. */
export function moreLongBugPrompts() {
  return [
    longBug("title-case", "Title case with small words",
      `function bookTitle(text) {
  const small = ["a", "an", "the", "of", "and"];
  const words = text.split(" ");
  return words.map(function (word, index) {
    if (index > 0 && small.includes(word)) {
      return word;
    }
    return word[0].toUpperCase() + word.slice(1);
  }).join(" ");
}`,
      "capitalise the first letter of every word and lower-case the rest, except that a, an, the, of and and stay all lowercase unless they are the first or the last word. Words are separated by single spaces.",
      "bookTitle", [
        c(["the lord of the rings"], "The Lord of the Rings"),
        c(["A TALE OF TWO CITIES"], "A Tale of Two Cities"),
        c(["what dreams are made of"], "What Dreams Are Made Of"),
      ]),
    longBug("rotate", "Rotate a list",
      `function rotate(list, steps) {
  const result = [];
  const n = list.length;
  for (let i = 0; i < n; i++) {
    const from = (i + steps) % n;
    result.push(list[from]);
  }
  return result;
}`,
      "rotate list to the right by steps places (a negative steps rotates to the left, and steps larger than the length wrap around), returning a new array; an empty list gives an empty array.",
      "rotate", [c([[1, 2, 3, 4], 1], [4, 1, 2, 3]), c([[1, 2, 3, 4], -1], [2, 3, 4, 1]), c([[1, 2, 3], 5], [2, 3, 1]), c([[], 3], [])]),
    longBug("camel-case", "camelCase from words",
      `function camelCase(text) {
  const words = text.split(" ");
  let result = "";
  for (let i = 0; i < words.length; i++) {
    const word = words[i].toLowerCase();
    if (i === 0) {
      result += word;
    } else {
      result += word[0].toUpperCase() + word.slice(0);
    }
  }
  return result;
}`,
      "turn text into camelCase: words are separated by any run of spaces, underscores or hyphens (ignore separators at either end), the first word is all lowercase and every later word is lowercase with its first letter capitalised. Text with no words gives an empty string.",
      "camelCase", [c(["hello world"], "helloWorld"), c(["  Make_it-WORK now "], "makeItWorkNow"), c([""], ""), c(["single"], "single")]),
    longBug("duration", "Parse a duration",
      `function parseDuration(text) {
  const units = { h: 360, m: 60, s: 1 };
  let total = 0;
  const parts = text.split(" ");
  for (const part of parts) {
    const unit = part[part.length - 1];
    const amount = parseInt(part);
    total += amount * units[unit];
  }
  return total;
}`,
      'return the number of seconds in a duration such as "1h 30m 15s": each part is a whole number followed by h, m or s, parts are separated by any number of spaces and may come in any order, and an empty or blank string is 0 seconds.',
      "parseDuration", [c(["1h 30m 15s"], 5415), c(["45s  2m"], 165), c([""], 0), c(["2h"], 7200)]),
    longBug("run-length", "Run-length encoding",
      `function compress(text) {
  let result = "";
  let count = 1;
  for (let i = 1; i < text.length; i++) {
    if (text[i] === text[i - 1]) {
      count++;
    } else {
      result += text[i] + count;
      count = 1;
    }
  }
  return result;
}`,
      'run-length encode text: each run of the same character becomes the character followed by the length of the run, so "aaab" becomes "a3b1"; empty text gives an empty string.',
      "compress", [c(["aaab"], "a3b1"), c(["abc"], "a1b1c1"), c([""], ""), c(["zzzzzzzzzzzz"], "z12")]),
    longBug("paginate", "One page of results",
      `function paginate(items, page, perPage) {
  const pages = Math.floor(items.length / perPage);
  if (page < 1 || page > pages) {
    return { items: [], page: page, pages: pages };
  }
  const start = page * perPage;
  return {
    items: items.slice(start, start + perPage),
    page: page,
    pages: pages,
  };
}`,
      "return one page of items for a page number counted from 1, as { items, page, pages }: pages is the number of pages needed for all the items (at least 1, even with no items), and items is empty for a page outside 1 to pages.",
      "paginate", [
        c([[1, 2, 3, 4, 5], 1, 2], { items: [1, 2], page: 1, pages: 3 }),
        c([[1, 2, 3, 4, 5], 3, 2], { items: [5], page: 3, pages: 3 }),
        c([[], 1, 10], { items: [], page: 1, pages: 1 }),
        c([[1, 2], 4, 2], { items: [], page: 4, pages: 1 }),
      ]),
  ];
}

const MATH = [
  ["bus-seats", "A school trip has 175 students. Each bus holds 40 students. How many buses are needed?", 5],
  ["bike-price", "A $200 bike is reduced by 15%, and the new price is then reduced by another $20. What is the final price in dollars?", 150],
  ["cars-meet", "Two cars start 300 km apart and drive toward each other at 70 km/h and 80 km/h. After how many hours do they meet?", 2],
  ["garden-fence", "A square garden has an area of 144 square meters. How many meters of fence go around it?", 48],
  ["coins", "Jo has 5 more dimes than quarters, and the coins are worth $2.25 in total. How many quarters does Jo have?", 5],
  ["interest", "$1500 is invested at 4% simple interest per year. How many dollars of interest are earned in 3 years?", 180],
  ["juice-mix", "A 10-liter jug of juice is 30% orange juice. How many liters of pure orange juice must be added to make it 50% orange juice?", 4],
  ["book-pages", "Kim read 3/8 of a 240-page book on Monday and 1/3 of the remaining pages on Tuesday. How many pages are left to read?", 100],
  ["even-numbers", "The sum of three consecutive even numbers is 78. What is the largest of them?", 28],
  ["overtime", "Raj earns $18 an hour for the first 40 hours of a week and 1.5 times that rate for every hour after that. How many dollars does he earn in a 46-hour week?", 882],
  ["flour-bag", "A recipe needs 750 grams of flour. Flour comes in 2 kg bags. How many grams are left in one bag after making the recipe twice?", 500],
  ["father-daughter", "The ages of a father and his daughter add up to 52. Six years ago the father was 4 times as old as the daughter. How old is the daughter now?", 14],
  ["tickets", "Adult tickets cost $12 and child tickets cost $7. 30 tickets were sold for $285 in total. How many adult tickets were sold?", 15],
];

/** Own word problems, scored on the last number like the other math items. */
export function moreMathPromptsV13() {
  return MATH.map(([id, question, value]) => ({
    id: `math-${id}`,
    label: `Math: ${id.replaceAll("-", " ")}`,
    category: "reasoning",
    prompt: `${question}\n${MATH_SUFFIX}`,
    maxTokens: 512,
    checks: [{ type: "number", value }],
  }));
}
