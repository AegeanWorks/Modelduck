import assert from "node:assert/strict";
import test from "node:test";

import { LlamaEngine } from "../src/engine.js";

const ENTRY = { id: "m1", path: "model.gguf", name: "Duck", fileName: "model.gguf", size: 1 };
const registry = { findById: (id) => (id === ENTRY.id ? ENTRY : null) };
const quiet = { warn() {}, info() {}, error() {} };

/** A runtime whose chat sessions wait for `release()`, with a real sequence pool per context. */
function heldRuntime({ asyncReclaim = false } = {}) {
  const started = [];
  const sessions = [];
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  class Session {
    constructor({ contextSequence }) {
      this.sequence = contextSequence;
      this.disposed = false;
      sessions.push(this);
    }

    getChatHistory() {
      return [];
    }

    setChatHistory() {}

    async promptWithMeta(text, { onTextChunk, onToken }) {
      started.push(text);
      await gate;
      if (this.disposed) throw new Error("session was disposed while answering");
      onTextChunk(`answer to ${text}`);
      onToken([1, 2]);
      return { responseText: `answer to ${text}`, stopReason: "eogToken" };
    }

    dispose() {
      if (!this.disposed) this.sequence.dispose();
      this.disposed = true;
    }
  }
  const loadRuntime = async () => ({
    LlamaChatSession: Session,
    LlamaCompletion: class {},
    getModuleVersion: async () => "test",
    getLlama: async () => ({
      gpu: false,
      maxThreads: 4,
      loadModel: async () => ({
        trainContextSize: 4096,
        gpuLayers: 0,
        tokenize: (text) => [...String(text)],
        createContext: async ({ contextSize, sequences = 1 }) => {
          let left = sequences;
          return {
            contextSize,
            get sequencesLeft() {
              return left;
            },
            getSequence() {
              if (left === 0) throw new Error("No sequences left");
              left -= 1;
              // node-llama-cpp gives a disposed sequence back to the pool asynchronously.
              return { dispose: () => (asyncReclaim ? setTimeout(() => { left += 1; }, 5) : (left += 1)) };
            },
            dispose: async () => {},
          };
        },
        dispose: async () => {},
      }),
      dispose: async () => {},
    }),
  });
  return { loadRuntime, started, sessions, release: () => release() };
}

const ask = (engine, conversationId, content) =>
  engine.chat({ conversationId, messages: [{ role: "user", content }], systemPrompt: "Be brief.", settings: { maxTokens: 16 } });

const tick = () => new Promise((resolve) => setImmediate(resolve));

async function loaded(runtime, sequences) {
  const engine = new LlamaEngine({ registry, logger: quiet, availableMemory: () => 64 * 2 ** 30, loadRuntime: runtime.loadRuntime });
  await engine.load({ modelId: "m1", gpuBackend: "cpu", contextSize: 2048, sequences });
  return engine;
}

test("with one sequence the engine still answers one chat at a time", async () => {
  const runtime = heldRuntime();
  const engine = await loaded(runtime, 1);
  const first = ask(engine, "a", "one");
  await tick();
  await assert.rejects(ask(engine, "b", "two"), (error) => error.code === "generation_in_progress");
  runtime.release();
  assert.equal((await first).text, "answer to one");
});

test("with several sequences that many chats run at once, and no more", async () => {
  const runtime = heldRuntime();
  const engine = await loaded(runtime, 2);
  const first = ask(engine, "a", "one");
  const second = ask(engine, "b", "two");
  await tick();
  assert.deepEqual(runtime.started.sort(), ["one", "two"], "both started before either finished");
  assert.equal(engine.busy, true);
  await assert.rejects(ask(engine, "c", "three"), (error) => error.code === "generation_in_progress");
  runtime.release();
  const answers = await Promise.all([first, second]);
  assert.deepEqual(answers.map((answer) => answer.text).sort(), ["answer to one", "answer to two"]);
  assert.equal(engine.busy, false);
});

test("starting a chat never disposes the session of a chat that is still answering", async () => {
  const runtime = heldRuntime();
  const engine = await loaded(runtime, 2);
  const first = ask(engine, "a", "one");
  await tick();
  const second = ask(engine, "b", "two");
  await tick();
  assert.equal(runtime.sessions[0].disposed, false);
  runtime.release();
  await Promise.all([first, second]);
});

test("unloading waits for every running chat", async () => {
  const runtime = heldRuntime();
  const engine = await loaded(runtime, 2);
  const chats = [ask(engine, "a", "one"), ask(engine, "b", "two")].map((chat) => chat.catch(() => null));
  await tick();
  const unloading = engine.unload();
  runtime.release();
  await unloading;
  await Promise.all(chats);
  assert.equal(engine.busy, false);
});

test("a chat that starts right after another finished waits for its sequence to be given back", async () => {
  const runtime = heldRuntime({ asyncReclaim: true });
  runtime.release();
  const engine = await loaded(runtime, 2);
  await Promise.all([ask(engine, "a", "one"), ask(engine, "b", "two")]);
  engine.dropSession("a");
  engine.dropSession("b");
  const answers = await Promise.all([ask(engine, "c", "three"), ask(engine, "d", "four")]);
  assert.deepEqual(answers.map((answer) => answer.text).sort(), ["answer to four", "answer to three"]);
});
