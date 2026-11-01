import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const html = readFileSync(fileURLToPath(new URL("../public/index.html", import.meta.url)), "utf8");
const app = readFileSync(fileURLToPath(new URL("../public/app.js", import.meta.url)), "utf8");
const css = readFileSync(fileURLToPath(new URL("../public/styles.css", import.meta.url)), "utf8");

test("the control panel is wired and the chat shell is gone", () => {
  const htmlIds = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  const appIds = new Set([
    ...[...app.matchAll(/\$\(\s*"([^"]+)"\s*\)/g)].map((match) => match[1]),
    ...[...app.matchAll(/getElementById\(\s*"([^"]+)"\s*\)/g)].map((match) => match[1]),
  ]);
  const duplicates = htmlIds.filter((id, index) => htmlIds.indexOf(id) !== index);

  assert.deepEqual([...new Set(duplicates)], [], "the page has duplicate ids");
  assert.deepEqual(
    [...appIds].filter((id) => !htmlIds.includes(id)),
    [],
    "app.js references an id that index.html does not define",
  );

  for (const id of [
    "open-models",
    "open-benchmarks",
    "open-settings",
    "open-server",
    "status-card",
    "model-pill",
    "models-dialog",
    "benchmark-dialog",
    "settings-dialog",
    "server-dialog",
    "context-note",
  ]) {
    assert.ok(htmlIds.includes(id), `missing control-panel id: ${id}`);
  }
  for (const id of ["chat-title", "messages", "composer", "conversation-list", "prompt"]) {
    assert.ok(!htmlIds.includes(id), `legacy chat id is still in the page: ${id}`);
  }

  assert.doesNotMatch(app, /\/api\/(?:chat|conversations)\b/, "app.js still calls a removed chat route");
  assert.doesNotMatch(app, /renderMarkdown|SUGGESTIONS|renderSidebar/, "app.js still has chat-only code");

  const opener = app.match(/async function openServerSettings\(\) \{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.ok(opener, "openServerSettings is missing");
  assert.ok(
    opener.indexOf("showModal") >= 0 && opener.indexOf("showModal") < opener.indexOf('request("/api/server-settings")'),
    "the Server dialog must open before its fetch so the button always responds",
  );

  const cssRules = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const dead of ["sidebar", "messages", "composer", "welcome", "conversation", "chat-title", "markdown", "code-block", "suggestion", "scrim"]) {
    assert.doesNotMatch(
      cssRules,
      new RegExp(`(^|[,{}]\\s*)\\.${dead}\\b`),
      `legacy chat selector .${dead} is still in styles.css`,
    );
  }
  for (const selector of ["control", "app-bar", "control-card", "status-card", "model-pill"]) {
    assert.match(cssRules, new RegExp(`\\.${selector}\\b`), `missing control-panel selector .${selector}`);
  }
});
