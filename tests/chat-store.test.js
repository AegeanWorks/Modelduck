import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { ChatStore } from "../src/chat-store.js";

const logger = { warn() {} };

async function tempFile(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "modelduck-chats-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return path.join(directory, "chats.json");
}

test("a conversation gets a title from its first user message and survives reload", async (t) => {
  const file = await tempFile(t);
  const store = new ChatStore({ file, logger });
  await store.load();

  const conversation = store.create({ modelId: "m1", modelName: "Duck 1B" });
  store.appendMessage(conversation.id, {
    role: "user",
    content: "Explain **local** models in one paragraph, please.",
  });
  store.appendMessage(conversation.id, {
    role: "assistant",
    content: "They run on your computer.",
    stats: { outputTokens: 6 },
  });
  await store.save();

  const reloaded = new ChatStore({ file, logger });
  await reloaded.load();
  const saved = reloaded.get(conversation.id);
  assert.equal(saved.title, "Explain local models in one paragraph, please.");
  assert.equal(saved.messages.length, 2);
  assert.equal(saved.messages[1].stats.outputTokens, 6);
  assert.equal(reloaded.list()[0].preview, "They run on your computer.");
});

test("truncateToLastUser removes a failed or partial assistant reply", async (t) => {
  const file = await tempFile(t);
  const store = new ChatStore({ file, logger });
  await store.load();
  const conversation = store.create();
  store.appendMessage(conversation.id, { role: "user", content: "one" });
  store.appendMessage(conversation.id, { role: "assistant", content: "first answer" });
  store.appendMessage(conversation.id, { role: "user", content: "two" });
  store.appendMessage(conversation.id, { role: "assistant", content: "partial" });

  const truncated = store.truncateToLastUser(conversation.id);
  assert.equal(truncated.messages.length, 3);
  assert.equal(truncated.messages.at(-1).content, "two");
});

test("delete and rename are durable", async (t) => {
  const file = await tempFile(t);
  const store = new ChatStore({ file, logger });
  await store.load();
  const first = store.create();
  const second = store.create();
  store.rename(first.id, "  a better title  ");
  assert.equal(store.list().find((item) => item.id === first.id).title, "a better title");
  assert.equal(store.delete(second.id), true);
  assert.equal(store.delete("missing"), false);
  await store.save();

  const text = await readFile(file, "utf8");
  assert.doesNotMatch(text, new RegExp(second.id));
});

test("a corrupt chat file becomes an empty, quarantined store", async (t) => {
  const file = await tempFile(t);
  await writeFile(file, "not json at all", "utf8");
  const store = new ChatStore({ file, logger });
  const list = await store.load();
  assert.deepEqual(list, []);
  assert.deepEqual(store.list(), []);
});

function fixture(count, { recentlyUsed = null } = {}) {
  return Array.from({ length: count }, (_, index) => ({
    id: `c${index}`,
    title: `Chat ${index}`,
    messages: [{ id: `m${index}`, role: "user", content: `hello ${index}`, createdAt: "2026-01-01T00:00:00.000Z" }],
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
    updatedAt: index === recentlyUsed
      ? "2026-10-30T00:00:00.000Z"
      : new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
  }));
}

test("past 200 chats the least recently used one is archived, never dropped", async (t) => {
  const file = await tempFile(t);
  await writeFile(file, JSON.stringify({ version: 1, conversations: fixture(200, { recentlyUsed: 0 }) }));
  const store = new ChatStore({ file, logger });
  await store.load();

  const created = store.create({ title: "Chat 201" });
  assert.equal(store.list().length, 200);
  assert.ok(store.get(created.id));
  assert.ok(store.get("c0"), "the oldest-created chat was used today, so it stays");
  assert.equal(store.get("c1"), null);
  assert.deepEqual(store.listArchived().map((item) => item.id), ["c1"]);
  await store.save();

  const reloaded = new ChatStore({ file, logger });
  await reloaded.load();
  assert.equal(reloaded.list().length, 200);
  assert.deepEqual(reloaded.listArchived().map((item) => item.id), ["c1"]);
  assert.equal(JSON.parse(await readFile(file, "utf8")).conversations.length, 200);
});

test("loading more than 200 chats keeps every one, archiving the least recently used", async (t) => {
  const file = await tempFile(t);
  await writeFile(file, JSON.stringify({ version: 1, conversations: fixture(250, { recentlyUsed: 0 }) }));
  const store = new ChatStore({ file, logger });
  await store.load();
  assert.equal(store.list().length, 200);
  assert.equal(store.listArchived().length, 50);
  assert.ok(store.get("c0"));
  assert.ok(store.get("c249"));
  assert.equal(store.get("c1"), null);
});

test("restoring an archived chat brings it back and archives the next least recent", async (t) => {
  const file = await tempFile(t);
  await writeFile(file, JSON.stringify({ version: 1, conversations: fixture(201) }));
  const store = new ChatStore({ file, logger });
  await store.load();
  assert.deepEqual(store.listArchived().map((item) => item.id), ["c0"]);

  const restored = store.restore("c0");
  assert.equal(restored.messages[0].content, "hello 0");
  assert.ok(store.get("c0"));
  assert.deepEqual(store.listArchived().map((item) => item.id), ["c1"]);
  assert.equal(store.restore("missing"), null);

  assert.equal(store.delete("c1"), true, "delete reaches archived chats too");
  assert.equal(store.listArchived().length, 0);
  await store.save();
  const reloaded = new ChatStore({ file, logger });
  await reloaded.load();
  assert.equal(reloaded.listArchived().length, 0);
  assert.equal(reloaded.list().length, 200);
});

test("a chat left in both files by an interrupted save is kept once", async (t) => {
  const file = await tempFile(t);
  const conversations = fixture(3);
  await writeFile(file, JSON.stringify({ version: 1, conversations }));
  await writeFile(file.replace(/\.json$/, ".archive.json"), JSON.stringify({ version: 1, conversations: [conversations[0]] }));
  const store = new ChatStore({ file, logger });
  await store.load();
  assert.equal(store.list().length, 3);
  assert.equal(store.listArchived().length, 0);
});
