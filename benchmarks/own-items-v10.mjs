/**
 * Suite v10 (ADR-038): more of ModelDuck's own math and long-context recall
 * questions, so every tune task has enough items for its statistics to
 * separate settings. Math answers are re-derived in tests/benchmark-suite-v10.test.js;
 * recall registers are generated from a fixed seed, so every run asks the same text.
 */

const MATH_SUFFIX = 'Show your reasoning, then end with exactly "Answer: <number>".';

const MATH = [
  ["pens-price", "A shop sells pens at 3 for $2. How many dollars do 27 pens cost?", 18],
  ["train-distance", "A train travels 240 km in 3 hours. At the same speed, how many km does it travel in 5 hours?", 400],
  ["mother-age", "Mia is 4 times as old as her son. In 20 years she will be twice as old as him. How old is Mia now?", 40],
  ["tank-fill", "A tank holds 1200 liters and is 35% full. How many more liters are needed to fill it?", 780],
  ["workers-days", "7 workers build a wall in 12 days. Working at the same rate, how many days would 21 workers take?", 4],
  ["jacket-price", "A jacket costs $80. It is discounted by 25%, then a 10% tax is added to the discounted price. What is the final price in dollars?", 66],
  ["sum-to-fifty", "What is the sum of all whole numbers from 1 to 50?", 1275],
  ["rectangle-area", "A rectangle has a perimeter of 46 cm and a length of 15 cm. What is its area in square cm?", 120],
  ["remainder", "What is the remainder when 1000 is divided by 37?", 1],
  ["cookie-eggs", "A recipe uses 3 eggs for 12 cookies. How many eggs are needed for 60 cookies?", 15],
  ["marbles", "Tom has twice as many marbles as Ann. Together they have 54 marbles. How many marbles does Tom have?", 36],
  ["fuel", "A car uses 6 liters of fuel per 100 km. How many liters does it use for 350 km?", 21],
  ["clock-minutes", "A clock shows 9:45 in the morning. 2 hours and 50 minutes later, how many minutes after midnight is it?", 755],
  ["test-average", "The average of 4 test scores is 85. What score on a fifth test makes the average of all 5 equal to 87?", 95],
  ["ball-percent", "A bag has 5 red, 7 blue and 8 green balls. What percentage of the balls are blue?", 35],
  ["reverse-percent", "A number increased by 20% is 96. What is the number?", 80],
  ["reading-days", "Ben reads 18 pages a day. His book has 400 pages and he has read 130. How many more days does he need to finish?", 15],
  ["notebook-price", "3 notebooks and 2 pens cost $13. 1 notebook and 2 pens cost $7. How many dollars does one notebook cost?", 3],
  ["tile-count", "How many 2 cm by 2 cm squares fit without overlapping in a rectangle 10 cm wide and 14 cm long?", 35],
  ["phone-bill", "A phone plan costs $15 per month plus $0.10 per minute. What is the bill in dollars for a month with 230 minutes?", 38],
  ["population", "A town of 8000 people grows by 10% each year. How many people live there after 2 years?", 9680],
  ["savings", "Sara saves $12 in the first week and $3 more each week than the week before. How many dollars has she saved after 6 weeks?", 117],
  ["common-multiple", "What is the smallest positive number divisible by 4, 6 and 10?", 60],
  ["rope-pieces", "A rope 7.5 m long is cut into pieces of 0.25 m. How many pieces are there?", 30],
  ["work-hours", "Lea works from 08:30 to 17:15 and takes a 45-minute lunch break. How many hours does she work?", 8],
  ["class-ratio", "The ratio of boys to girls in a class is 3:5. There are 40 students. How many are girls?", 25],
  ["triangle-angle", "One angle of a triangle is 60 degrees. Of the other two, one is twice the other. What is the largest angle in degrees?", 80],
  ["apple-price", "12 apples cost $9. How many dollars do 20 apples cost?", 15],
  ["powers", "What is 2 to the power of 10 minus 10 to the power of 2?", 924],
  ["average-speed", "A cyclist rides at 15 km/h for 2 hours, then at 10 km/h for 3 hours. What is the average speed in km/h for the whole ride?", 12],
];

/** Own word problems, scored on the last number like the public math items. */
export function moreMathPrompts() {
  return MATH.map(([id, question, value]) => ({
    id: `math-${id}`,
    label: `Math: ${id.replaceAll("-", " ")}`,
    category: "reasoning",
    prompt: `${question}\n${MATH_SUFFIX}`,
    maxTokens: 512,
    checks: [{ type: "number", value }],
  }));
}

/** Small deterministic generator (LCG) so the registers never change between runs. */
function generator(seed) {
  let state = seed >>> 0;
  return (limit) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    // The low bits of an LCG repeat with a short period; the high ones do not.
    return (state >>> 16) % limit;
  };
}

const SYLLABLES = ["ka", "lo", "mi", "ren", "sa", "to", "vi", "nu", "pe", "dar", "el", "ro", "ta", "ji", "mo", "zan"];
const COLOURS = ["red", "blue", "green", "yellow"];
const STATUSES = ["packed", "shipped", "delayed", "returned", "delivered"];

/** `count` distinct names, PINs and amounts drawn from `seed`. */
function people(seed, count) {
  const next = generator(seed);
  const names = new Set();
  const pins = new Set();
  while (names.size < count) {
    const name = SYLLABLES[next(16)] + SYLLABLES[next(16)];
    names.add(name[0].toUpperCase() + name.slice(1));
  }
  while (pins.size < count) pins.add(String(1000 + next(9000)));
  return [...names].map((name, index) => ({
    badge: 300 + index,
    name,
    pin: [...pins][index],
    room: `${String.fromCharCode(65 + next(6))}${1 + next(40)}`,
    amount: 10 + next(90),
    colour: COLOURS[next(COLOURS.length)],
  }));
}

const register = (rows) => rows.map((row) => `Badge ${row.badge}: holder ${row.name}, room ${row.room}, PIN ${row.pin}, colour ${row.colour}.`).join("\n");

/** Index of a position fraction in a list of `size` rows: 0 first, 1 last. */
const at = (size, fraction) => Math.min(size - 1, Math.round((size - 1) * fraction));

const recall = (id, label, prompt, checks) => ({ id: `recall-v10-${id}`, label, category: "recall", prompt, maxTokens: 16, checks });

function lookups() {
  const items = [];
  for (const size of [20, 50, 80]) {
    for (const fraction of [0, 0.3, 0.6, 1]) {
      const rows = people(size * 10 + fraction * 100, size);
      const target = rows[at(size, fraction)];
      items.push(recall(`pin-${size}-${fraction * 10}`, `PIN of badge ${target.badge} among ${size}`,
        `Here is the badge register.\n${register(rows)}\n\nWhat is the PIN of badge ${target.badge}? Reply with only the PIN.`,
        [{ type: "exact", value: target.pin }]));
    }
  }
  return items;
}

function reverseLookups() {
  const items = [];
  for (const size of [30, 60]) {
    for (const fraction of [0.1, 0.4, 0.7, 0.95]) {
      const rows = people(size * 7 + fraction * 100, size);
      const target = rows[at(size, fraction)];
      items.push(recall(`holder-${size}-${Math.round(fraction * 100)}`, `Holder of PIN ${target.pin} among ${size}`,
        `Here is the badge register.\n${register(rows)}\n\nWho holds the badge with PIN ${target.pin}? Reply with only the name.`,
        [{ type: "exact", value: target.name.toLowerCase() }]));
    }
  }
  return items;
}

function latestStatuses() {
  const items = [];
  for (let variant = 0; variant < 8; variant += 1) {
    const next = generator(900 + variant);
    const parcels = Array.from({ length: 12 }, (_, index) => `P-${410 + index * 7}`);
    const status = new Map();
    const log = [];
    for (let step = 0; step < 30 + variant * 5; step += 1) {
      const parcel = parcels[next(parcels.length)];
      const value = STATUSES[next(STATUSES.length)];
      status.set(parcel, value);
      log.push(`${String(step + 1).padStart(2, "0")}. Parcel ${parcel} is now ${value}.`);
    }
    const asked = [...status.keys()][variant % status.size];
    items.push(recall(`status-${variant}`, `Latest status of ${asked}`,
      `Here is a delivery log, oldest first. A later line replaces an earlier one for the same parcel.\n${log.join("\n")}\n\n` +
        `What is the latest status of parcel ${asked}? Reply with only the status.`,
      [{ type: "exact", value: status.get(asked) }]));
  }
  return items;
}

function sums() {
  const items = [];
  for (const [index, size] of [24, 36, 48, 60, 72, 84].entries()) {
    const rows = people(5000 + size, size);
    const first = rows[at(size, 0.15 + index * 0.05)];
    const second = rows[at(size, 0.85 - index * 0.05)];
    const text = rows.map((row) => `Account of ${row.name}: balance ${row.amount} coins.`).join("\n");
    items.push(recall(`sum-${size}`, `Two balances among ${size}`,
      `Here is the account list.\n${text}\n\nWhat is the balance of ${first.name} plus the balance of ${second.name}? Reply with only the number.`,
      [{ type: "number", value: first.amount + second.amount }]));
  }
  return items;
}

function counts() {
  const items = [];
  for (const [index, size] of [12, 16, 20, 24, 28, 32].entries()) {
    const rows = people(7000 + size, size);
    const colour = COLOURS[index % COLOURS.length];
    items.push(recall(`count-${size}`, `Count ${colour} among ${size}`,
      `Here is the badge register.\n${register(rows)}\n\nHow many badges have the colour ${colour}? Reply with only the number.`,
      [{ type: "number", value: rows.filter((row) => row.colour === colour).length }]));
  }
  return items;
}

/** Generated recall items: lookups at several depths and lengths, reverse lookups, latest values, sums and counts. */
export function moreRecallPrompts() {
  return [...lookups(), ...reverseLookups(), ...latestStatuses(), ...sums(), ...counts()];
}
