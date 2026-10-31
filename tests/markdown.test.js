import assert from "node:assert/strict";
import test from "node:test";

import { renderMarkdown } from "../public/markdown.js";

test("raw HTML is escaped before anything else", () => {
  const html = renderMarkdown('<script>alert("x")</script><img src=x onerror=alert(1)>');
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;script&gt;/);
});

test("bold, inline code and safe links render", () => {
  // hygiene: allow inert public example link used as a renderer fixture
  const html = renderMarkdown("A **bold** `code` [site](https://example.com).");
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<code>code<\/code>/);
  assert.match(html, /href="https:\/\/example\.com"/);
});

test("javascript links are left as plain text", () => {
  const html = renderMarkdown("[click](javascript:alert(1))");
  assert.doesNotMatch(html, /href="javascript:/);
});

test("fenced code blocks get a copy button and escaped content", () => {
  const html = renderMarkdown("```js\nconst x = '<tag>';\n```");
  assert.match(html, /class="code-copy"/);
  assert.match(html, /data-copy="/);
  assert.match(html, /&lt;tag&gt;/);
  assert.doesNotMatch(html, /<tag>/);
});

test("an unclosed fence still renders as code while streaming", () => {
  const html = renderMarkdown("```python\nprint('hi')");
  assert.match(html, /class="code-block"/);
  assert.match(html, /print\(&#39;hi&#39;\)/);
});

test("lists, headings and blockquotes become semantic tags", () => {
  const html = renderMarkdown("# Title\n\n- one\n- two\n\n> quoted");
  assert.match(html, /<h1>Title<\/h1>/);
  assert.match(html, /<ul><li>one<\/li><li>two<\/li><\/ul>/);
  assert.match(html, /<blockquote>quoted<\/blockquote>/);
});
