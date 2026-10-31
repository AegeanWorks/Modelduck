// Correct solutions for the suite v13 long coding and bug-fix items; every test case must agree with them.

/** Reference answers, as source, for the suite v13 long functions and long bug fixes. */
export const REFERENCE_V13 = {
  lruSimulate: `function lruSimulate(capacity, ops) {
    const cache = new Map();
    const out = [];
    for (const [op, key, value] of ops) {
      if (op === "get") {
        if (!cache.has(key)) { out.push(null); continue; }
        const found = cache.get(key);
        cache.delete(key);
        cache.set(key, found);
        out.push(found);
      } else {
        if (cache.has(key)) cache.delete(key);
        else if (cache.size >= capacity) cache.delete(cache.keys().next().value);
        cache.set(key, value);
      }
    }
    return out;
  }`,
  parseQuery: `function parseQuery(text) {
    const out = {};
    const decode = (part) => decodeURIComponent(part.replace(/\\+/g, " "));
    for (const pair of text.replace(/^\\?/, "").split("&")) {
      if (!pair) continue;
      const at = pair.indexOf("=");
      const key = decode(at < 0 ? pair : pair.slice(0, at));
      const value = at < 0 ? "" : decode(pair.slice(at + 1));
      if (!(key in out)) out[key] = value;
      else if (Array.isArray(out[key])) out[key].push(value);
      else out[key] = [out[key], value];
    }
    return out;
  }`,
  topoSort: `function topoSort(deps) {
    const names = new Set(Object.keys(deps));
    for (const list of Object.values(deps)) for (const name of list) names.add(name);
    const placed = [];
    const done = new Set();
    while (placed.length < names.size) {
      const ready = [...names].filter((name) => !done.has(name) && (deps[name] ?? []).every((dep) => done.has(dep))).sort();
      if (!ready.length) return null;
      placed.push(ready[0]);
      done.add(ready[0]);
    }
    return placed;
  }`,
  formatTable: `function formatTable(rows) {
    const columns = rows[0].length;
    const cells = rows.map((row) => Array.from({ length: columns }, (_, index) => row[index] ?? ""));
    const widths = Array.from({ length: columns }, (_, index) => Math.max(...cells.map((row) => row[index].length)));
    const line = (row) => row.map((cell, index) => cell.padEnd(widths[index])).join(" | ");
    return [line(cells[0]), widths.map((width) => "-".repeat(width)).join("-+-"), ...cells.slice(1).map(line)];
  }`,
  nextDate: `function nextDate(text) {
    let [year, month, day] = text.split("-").map(Number);
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
    day += 1;
    if (day > days) { day = 1; month += 1; }
    if (month > 12) { month = 1; year += 1; }
    return String(year).padStart(4, "0") + "-" + String(month).padStart(2, "0") + "-" + String(day).padStart(2, "0");
  }`,
  isValidSudoku: `function isValidSudoku(grid) {
    const seen = new Set();
    for (let row = 0; row < 9; row++) {
      for (let col = 0; col < 9; col++) {
        const value = grid[row][col];
        if (!value) continue;
        const keys = ["r" + row + value, "c" + col + value, "b" + Math.floor(row / 3) + Math.floor(col / 3) + value];
        if (keys.some((key) => seen.has(key))) return false;
        keys.forEach((key) => seen.add(key));
      }
    }
    return true;
  }`,
  bookTitle: `function bookTitle(text) {
    const small = ["a", "an", "the", "of", "and"];
    const words = text.toLowerCase().split(" ");
    return words.map((word, index) => (index > 0 && index < words.length - 1 && small.includes(word) ? word : word[0].toUpperCase() + word.slice(1))).join(" ");
  }`,
  rotate: `function rotate(list, steps) {
    const n = list.length;
    return list.map((_, index) => list[(((index - steps) % n) + n) % n]);
  }`,
  camelCase: `function camelCase(text) {
    const words = text.toLowerCase().split(/[\\s_-]+/).filter(Boolean);
    return words.map((word, index) => (index === 0 ? word : word[0].toUpperCase() + word.slice(1))).join("");
  }`,
  parseDuration: `function parseDuration(text) {
    const units = { h: 3600, m: 60, s: 1 };
    return text.trim().split(/\\s+/).filter(Boolean).reduce((total, part) => total + parseInt(part, 10) * units[part.at(-1)], 0);
  }`,
  compress: `function compress(text) {
    return (text.match(/(.)\\1*/g) ?? []).map((run) => run[0] + run.length).join("");
  }`,
  paginate: `function paginate(items, page, perPage) {
    const pages = Math.max(1, Math.ceil(items.length / perPage));
    if (page < 1 || page > pages) return { items: [], page, pages };
    const start = (page - 1) * perPage;
    return { items: items.slice(start, start + perPage), page, pages };
  }`,
};

/** A v13 reference as a callable function, or undefined when there is none. */
export function referenceV13(entry) {
  return REFERENCE_V13[entry] ? new Function(`${REFERENCE_V13[entry]}
;return ${entry};`)() : undefined;
}
