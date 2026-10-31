// Correct solutions for the suite v9 coding and bug-fix items; every test case must agree with them.

function toRoman(num) {
  const values = [1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1];
  const symbols = ["M", "CM", "D", "CD", "C", "XC", "L", "XL", "X", "IX", "V", "IV", "I"];
  let out = "";
  for (let i = 0; i < values.length; i += 1) {
    while (num >= values[i]) {
      out += symbols[i];
      num -= values[i];
    }
  }
  return out;
}

function fromRoman(s) {
  const value = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
  let total = 0;
  for (let i = 0; i < s.length; i += 1) {
    const current = value[s[i]];
    const next = value[s[i + 1]] ?? 0;
    total += current < next ? -current : current;
  }
  return total;
}

function mergeIntervals(intervals) {
  const sorted = intervals.map((pair) => [...pair]).sort((a, b) => a[0] - b[0]);
  const result = [];
  for (const [start, end] of sorted) {
    const last = result[result.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else result.push([start, end]);
  }
  return result;
}

function binarySearch(arr, target) {
  let low = 0;
  let high = arr.length - 1;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (arr[mid] === target) return mid;
    if (arr[mid] < target) low = mid + 1;
    else high = mid - 1;
  }
  return -1;
}

function parseCsvLine(line) {
  const fields = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted && ch === '"' && line[i + 1] === '"') {
      current += '"';
      i += 1;
    } else if (ch === '"') {
      quoted = !quoted;
    } else if (ch === "," && !quoted) {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

function evaluate(expr) {
  const parts = expr.match(/\d+|[-+*/()]/g) ?? [];
  let index = 0;
  const peek = () => parts[index];
  const take = () => parts[index++];
  const factor = () => {
    if (peek() === "(") {
      take();
      const value = sum();
      take();
      return value;
    }
    return Number(take());
  };
  const product = () => {
    let value = factor();
    while (peek() === "*" || peek() === "/") value = take() === "*" ? value * factor() : value / factor();
    return value;
  };
  const sum = () => {
    let value = product();
    while (peek() === "+" || peek() === "-") value = take() === "+" ? value + product() : value - product();
    return value;
  };
  return sum();
}

function wrapText(text, width) {
  const lines = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (!line) line = word;
    else if (line.length + 1 + word.length <= width) line += ` ${word}`;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function checkout(cart, prices, discounts) {
  let total = 0;
  for (const { item, qty } of cart) {
    if (!(item in prices)) continue;
    const buy = discounts[item];
    const free = buy ? Math.floor(qty / (buy + 1)) : 0;
    total += (qty - free) * prices[item];
  }
  return Math.round(total * 100) / 100;
}

function multiply(a, b) {
  if (!a.length || !b.length || a[0].length !== b.length) return null;
  return a.map((row) => b[0].map((_value, column) => row.reduce((sum, cell, k) => sum + cell * b[k][column], 0)));
}

function parseIni(text) {
  const result = {};
  let section = "";
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith(";") || line.startsWith("#")) continue;
    const header = /^\[(.+)\]$/.exec(line);
    if (header) {
      section = header[1].trim();
      result[section] ??= {};
      continue;
    }
    const equals = line.indexOf("=");
    if (equals < 0) continue;
    result[section] ??= {};
    result[section][line.slice(0, equals).trim()] = line.slice(equals + 1).trim();
  }
  return result;
}

export const REFERENCE_V9 = {
  runLength: (s) => (s.match(/(.)\1*/g) ?? []).map((run) => `${run[0]}${run.length}`).join(""),
  isBalanced: (s) => {
    const pairs = { ")": "(", "]": "[", "}": "{" };
    const stack = [];
    for (const ch of s) {
      if ("([{".includes(ch)) stack.push(ch);
      else if (ch in pairs && stack.pop() !== pairs[ch]) return false;
    }
    return stack.length === 0;
  },
  mergeIntervals,
  binarySearch,
  flattenDeep: (arr) => arr.flat(Infinity),
  flattenOnce: (arr) => arr.flat(1),
  toSnakeCase: (s) => s.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`),
  toRoman,
  fromRoman,
  topWords: (text, k) => {
    const counts = {};
    for (const word of text.toLowerCase().match(/[a-z]+/g) ?? []) counts[word] = (counts[word] ?? 0) + 1;
    return Object.keys(counts).sort((a, b) => counts[b] - counts[a] || a.localeCompare(b)).slice(0, k);
  },
  transpose: (m) => (m.length ? m[0].map((_value, column) => m.map((row) => row[column])) : []),
  areAnagrams: (a, b) => {
    const norm = (s) => [...s.toLowerCase().replace(/\s+/g, "")].sort().join("");
    return norm(a) === norm(b);
  },
  gcd: (a, b) => {
    while (b) [a, b] = [b, a % b];
    return a;
  },
  primeFactors: (n) => {
    const factors = [];
    for (let p = 2; p * p <= n; p += 1) {
      while (n % p === 0) {
        factors.push(p);
        n /= p;
      }
    }
    if (n > 1) factors.push(n);
    return factors;
  },
  groupByLength: (words) => {
    const groups = {};
    for (const word of words) (groups[word.length] ??= []).push(word);
    return groups;
  },
  pascalRow: (n) => {
    let row = [1];
    for (let i = 0; i < n; i += 1) row = [1, ...row.slice(1).map((value, j) => value + row[j]), 1];
    return row;
  },
  formatDuration: (seconds) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  },
  evaluate,
  parseCsvLine,
  wrapText,
  checkout,
  multiply,
  parseIni,
  range: (start, end) => Array.from({ length: Math.max(0, end - start) }, (_value, i) => start + i),
  capitalize: (s) => s[0].toUpperCase() + s.slice(1),
  countOf: (arr, x) => arr.filter((v) => v === x).length,
  indexOfMin: (arr) => arr.reduce((best, value, i) => (value < arr[best] ? i : best), 0),
  sumDigits: (n) => [...String(n)].reduce((sum, digit) => sum + Number(digit), 0),
  isSorted: (arr) => arr.every((value, i) => i === 0 || arr[i - 1] <= value),
  percentOf: (part, total) => (part / total) * 100,
  truncate: (s, max) => (s.length > max ? `${s.slice(0, max - 3)}...` : s),
  median: (arr) => {
    const s = [...arr].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  },
  uniqueWords: (words) => {
    const seen = new Set();
    return words.filter((word) => !seen.has(word.toLowerCase()) && seen.add(word.toLowerCase()));
  },
  totalPrice: (items) => items.reduce((sum, item) => sum + item.price * item.qty, 0),
  padLeft: (s, width, ch) => {
    while (s.length < width) s = ch + s;
    return s;
  },
  endsWith: (s, suffix) => suffix.length <= s.length && s.slice(s.length - suffix.length) === suffix,
  safeDivide: (a, b) => (b === 0 ? null : a / b),
  adults: (people) => people.filter((p) => p.age >= 18).map((p) => p.name),
  wordCounts: (text) => {
    const counts = {};
    for (const word of text.split(/\s+/).filter(Boolean)) {
      const key = word.toLowerCase();
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
  },
  cartTotal: (items, couponPercent) => {
    const total = items.reduce((sum, item) => sum + item.price * item.qty, 0);
    return Math.round(total * (1 - couponPercent / 100) * 100) / 100;
  },
};
