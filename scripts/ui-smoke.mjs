import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitFor(check, timeout = 15_000, interval = 100) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try {
      if (await check()) return true;
    } catch {
      // Keep waiting while the server or browser starts.
    }
    await delay(interval);
  }
  return false;
}

function browserCandidates() {
  if (process.platform === "win32") {
    return [
      process.env["ProgramFiles(x86)"] &&
        path.join(process.env["ProgramFiles(x86)"], "Microsoft", "Edge", "Application", "msedge.exe"),
      process.env.ProgramFiles &&
        path.join(process.env.ProgramFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
      process.env.ProgramFiles &&
        path.join(process.env.ProgramFiles, "Google", "Chrome", "Application", "chrome.exe"),
      process.env.LOCALAPPDATA &&
        path.join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe"),
    ].filter(Boolean);
  }
  if (process.platform === "darwin") {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    ];
  }
  return ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
}

async function main() {
  if (typeof WebSocket !== "function") {
    console.log("[ui-smoke] skipped: Node 22+ is needed for the built-in WebSocket; npm test still checks static wiring");
    return;
  }

  const { existsSync } = await import("node:fs");
  const browserPath = browserCandidates().find((candidate) => existsSync(candidate));
  if (!browserPath) {
    console.log("[ui-smoke] skipped: no Edge or Chrome found; npm test still checks static wiring");
    return;
  }

  const home = await mkdtemp(path.join(os.tmpdir(), "modelduck-ui-"));
  const port = await freePort();
  const cdpPort = await freePort();
  const profile = path.join(home, "browser-profile");
  await mkdir(profile, { recursive: true });
  let server = null;
  let browser = null;
  let ws = null;

  try {
    const logs = [];
    server = spawn(
      process.execPath,
      ["src/main.js", "--port", String(port), "--home", home, "--no-open"],
      { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] },
    );
    server.stdout.on("data", (chunk) => logs.push(String(chunk)));
    server.stderr.on("data", (chunk) => logs.push(String(chunk)));

    const healthy = await waitFor(async () => {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      return response.ok;
    });
    if (!healthy) throw new Error(`ModelDuck did not start:\n${logs.join("")}`);

    browser = spawn(
      browserPath,
      [
        "--headless=new",
        "--disable-gpu",
        "--no-first-run",
        `--user-data-dir=${profile}`,
        `--remote-debugging-port=${cdpPort}`,
        "--window-size=1440,900",
        "about:blank",
      ],
      { stdio: "ignore" },
    );

    const pages = await (async () => {
      let found = null;
      await waitFor(async () => {
        found = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json();
        return Boolean(found?.length);
      });
      return found;
    })();
    if (!pages?.length) throw new Error("The headless browser did not expose a page");

    ws = new WebSocket(pages.find((item) => item.type === "page")?.webSocketDebuggerUrl ?? pages[0].webSocketDebuggerUrl);
    const pending = new Map();
    const exceptions = [];
    let id = 0;
    const send = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const messageId = ++id;
        pending.set(messageId, { resolve, reject });
        ws.send(JSON.stringify({ id: messageId, method, params }));
      });
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id && pending.has(message.id)) {
        const { resolve, reject } = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result);
        return;
      }
      if (message.method === "Runtime.exceptionThrown") {
        exceptions.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
      }
    };
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });

    const evaluate = async (expression) => {
      const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      return result.result.value;
    };

    await send("Runtime.enable");
    await send("Page.enable");
    await send("Page.addScriptToEvaluateOnNewDocument", {
      source: `window.__uiSmokeErrors = [];
        window.addEventListener("unhandledrejection", (event) => window.__uiSmokeErrors.push(String(event.reason?.stack || event.reason)));
        window.addEventListener("error", (event) => window.__uiSmokeErrors.push(event.message));`,
    });
    await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await send("Page.navigate", { url: `http://127.0.0.1:${port}/` });

    assert.ok(await waitFor(() => evaluate('Boolean(document.querySelector(".dashboard"))')), "the dashboard did not render");
    assert.equal(await evaluate('document.getElementById("messages") === null'), true, "the chat shell is still present");
    assert.equal(await evaluate('document.getElementById("dashboard-models") !== null'), true, "the model dashboard is missing");

    const dialogs = [
      ["open-models", "models-dialog"],
      ["open-benchmarks", "benchmark-dialog"],
      ["open-settings", "settings-dialog"],
      ["open-server", "server-dialog"],
    ];
    for (const [button, dialog] of dialogs) {
      await evaluate(`document.getElementById("${button}").click(), true`);
      const opened = await waitFor(() => evaluate(`document.getElementById("${dialog}").open`), 5_000);
      assert.ok(opened, `${dialog} did not open`);
      const state = await evaluate(`(() => {
        const node = document.getElementById("${dialog}");
        const rect = node.getBoundingClientRect();
        return { display: getComputedStyle(node).display, width: Math.round(rect.width) };
      })()`);
      assert.equal(state.display, "flex", `${dialog} is not displayed`);
      assert.ok(state.width >= 300, `${dialog} is too narrow (${state.width}px)`);
      await evaluate(`document.getElementById("${dialog}").close(), true`);
    }

    await evaluate('document.getElementById("open-settings").click(), true');
    await delay(120);
    await evaluate('document.getElementById("settings-dialog").close(), true');
    await evaluate('document.getElementById("open-server").click(), true');
    assert.ok(
      await waitFor(() => evaluate('document.getElementById("server-dialog").open'), 2_000),
      "the Server dialog must open immediately after Settings",
    );
    await evaluate('document.getElementById("server-dialog").close(), true');

    await evaluate('document.getElementById("open-benchmarks").click(), true');
    assert.ok(
      await waitFor(() => evaluate('document.getElementById("benchmark-dialog").open'), 3_000),
      "the Bench dialog did not open",
    );
    assert.equal(
      await evaluate('document.querySelectorAll("[data-bench-tab]").length'),
      6,
      "the Bench rail must list all six sections",
    );
    assert.equal(
      await evaluate('document.querySelector(".bench-nav").getAttribute("aria-orientation")'),
      "vertical",
      "the wide Bench rail must announce a vertical tablist",
    );
    for (const tab of ["tune", "models", "runs", "settings", "suite", "gate"]) {
      await evaluate(`document.querySelector('[data-bench-tab="${tab}"]').click(), true`);
      const state = await evaluate(`(() => {
        const button = document.querySelector('[data-bench-tab="${tab}"]');
        const panel = document.querySelector('[data-bench-panel="${tab}"]');
        const controlled = document.getElementById(button.getAttribute("aria-controls"));
        const otherDisplay = [...document.querySelectorAll("[data-bench-panel]")]
          .filter((node) => node.dataset.benchPanel !== "${tab}")
          .map((node) => getComputedStyle(node).display);
        return { selected: button.getAttribute("aria-selected"), hidden: panel.hidden, display: getComputedStyle(panel).display, controlled: controlled === panel, otherDisplayed: otherDisplay.filter((value) => value !== "none").length };
      })()`);
      assert.equal(state.selected, "true", `the ${tab} Bench tab did not become selected`);
      assert.equal(state.hidden, false, `the ${tab} Bench panel stayed hidden`);
      assert.notEqual(state.display, "none", `the ${tab} Bench panel is not displayed`);
      assert.equal(state.controlled, true, `the ${tab} Bench tab's aria-controls does not point at its panel`);
      assert.equal(state.otherDisplayed, 0, `the ${tab} Bench tab left another panel visible`);
    }
    await evaluate('document.querySelector(\'[data-bench-tab="tune"]\').click(), true');
    assert.equal(
      await evaluate('Boolean(document.getElementById("tune-help"))'),
      true,
      "the Tune tab is missing the tuning help section",
    );
    await evaluate('document.querySelector("#tune-help summary").click(), true');
    assert.equal(
      await evaluate('document.getElementById("tune-help").open'),
      true,
      "the tuning help section did not open",
    );
    assert.match(
      await evaluate('document.getElementById("tune-help").textContent'),
      /Increasing rungs/,
      "the tuning help does not explain the rungs",
    );
    await evaluate('document.getElementById("benchmark-dialog").close(), true');

    await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await delay(400);
    assert.equal(
      await evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth"),
      true,
      "the dashboard overflows horizontally at 390px",
    );
    await evaluate('document.getElementById("open-models").click(), true');
    assert.ok(
      await waitFor(() => evaluate('document.getElementById("models-dialog").open'), 3_000),
      "the Models dialog did not open at 390px",
    );
    assert.ok(
      (await evaluate('document.getElementById("models-dialog").getBoundingClientRect().width')) <= 390,
      "the Models dialog is wider than a 390px viewport",
    );
    await evaluate('document.getElementById("models-dialog").close(), true');
    await evaluate('document.getElementById("open-benchmarks").click(), true');
    assert.ok(
      await waitFor(() => evaluate('document.getElementById("benchmark-dialog").open'), 3_000),
      "the Bench dialog did not open at 390px",
    );
    assert.ok(
      (await evaluate('document.getElementById("benchmark-dialog").getBoundingClientRect().width')) >= 389,
      "the Bench dialog must fill a 390px viewport",
    );
    assert.equal(
      await evaluate('document.querySelector(".bench-nav").getAttribute("aria-orientation")'),
      "horizontal",
      "the narrow Bench rail must announce a horizontal tablist",
    );
    await evaluate('document.getElementById("benchmark-dialog").close(), true');

    const pageErrors = await evaluate("window.__uiSmokeErrors ?? []");
    assert.deepEqual([...exceptions, ...pageErrors], [], "the control panel raised a console exception");
    console.log("[ui-smoke] control panel, four dialogs and six Bench sections are OK, including 390px reflow");
  } finally {
    ws?.close();
    browser?.kill();
    server?.kill();
    await delay(400);
    await rm(home, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }).catch(() => {});
  }
}

main().catch((error) => {
  console.error(`[ui-smoke] ${error.stack || error}`);
  process.exitCode = 1;
});
