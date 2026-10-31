import { randomUUID } from "node:crypto";

import { readJsonWithQuarantine, writeJsonAtomic } from "./fs-atomic.js";

const MAX_CONVERSATIONS = 200;
const TITLE_LIMIT = 52;

function now() {
  return new Date().toISOString();
}

function makeTitle(text) {
  const cleaned = String(text ?? "")
    .replace(/```[\s\S]*?```/g, " code ")
    .replace(/[#*_>`~[\]()]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "New chat";
  return cleaned.length > TITLE_LIMIT ? `${cleaned.slice(0, TITLE_LIMIT - 1).trimEnd()}…` : cleaned;
}

function clone(value) {
  return structuredClone(value);
}

function summarize(conversation) {
  const last = conversation.messages.at(-1);
  return {
    id: conversation.id,
    title: conversation.title,
    modelId: conversation.modelId,
    modelName: conversation.modelName,
    messageCount: conversation.messages.length,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    preview: last ? String(last.content).replace(/\s+/g, " ").slice(0, 96) : "",
  };
}

function normalizeConversations(data) {
  const raw = Array.isArray(data?.conversations) ? data.conversations : [];
  return raw
    .filter((item) => item && typeof item.id === "string" && Array.isArray(item.messages))
    .map((item) => ({
      id: item.id,
      title: typeof item.title === "string" && item.title ? item.title : "New chat",
      modelId: typeof item.modelId === "string" ? item.modelId : null,
      modelName: typeof item.modelName === "string" ? item.modelName : null,
      messages: item.messages
        .filter(
          (message) =>
            message &&
            (message.role === "user" || message.role === "assistant") &&
            typeof message.content === "string",
        )
        .map((message) => ({
          id: message.id || randomUUID(),
          role: message.role,
          content: message.content,
          createdAt: message.createdAt || now(),
          ...(message.stats && typeof message.stats === "object" ? { stats: message.stats } : {}),
          ...(message.manifest && typeof message.manifest === "object"
            ? { manifest: message.manifest }
            : {}),
          ...(message.stopped ? { stopped: true } : {}),
        })),
      createdAt: item.createdAt || now(),
      updatedAt: item.updatedAt || item.createdAt || now(),
    }));
}

function newestFirst(left, right) {
  return String(right.updatedAt).localeCompare(String(left.updatedAt));
}

/**
 * Keeps at most MAX_CONVERSATIONS chats in the active file, which is rewritten
 * on every message. Older chats move to an archive file instead of being
 * dropped, and opening one restores it. The archive is written before the
 * active file, so an interrupted save leaves a duplicate (removed on load),
 * never a lost chat.
 */
export class ChatStore {
  #file;
  #archiveFile;
  #logger;
  #conversations = [];
  #archived = [];
  #archiveDirty = false;
  #saveQueue = Promise.resolve();

  constructor({ file, archiveFile = file.replace(/(\.json)?$/i, ".archive.json"), logger = console }) {
    this.#file = file;
    this.#archiveFile = archiveFile;
    this.#logger = logger;
  }

  async load() {
    const data = await readJsonWithQuarantine(this.#file, null, { logger: this.#logger });
    const archive = await readJsonWithQuarantine(this.#archiveFile, null, { logger: this.#logger });
    this.#conversations = normalizeConversations(data);
    const active = new Set(this.#conversations.map((item) => item.id));
    const archived = normalizeConversations(archive);
    this.#archived = archived.filter((item) => !active.has(item.id));
    this.#archiveDirty = this.#archived.length !== archived.length;
    this.#enforceLimit();
    return this.list();
  }

  /** Moves the least recently used chats past the limit into the archive. */
  #enforceLimit(keepId = null) {
    const overflow = this.#conversations.length - MAX_CONVERSATIONS;
    if (overflow <= 0) return;
    const evicted = this.#conversations
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.id !== keepId)
      .sort((left, right) => -newestFirst(left.item, right.item) || right.index - left.index)
      .slice(0, overflow)
      .map(({ item }) => item);
    const ids = new Set(evicted.map((item) => item.id));
    this.#conversations = this.#conversations.filter((item) => !ids.has(item.id));
    this.#archived.unshift(...evicted);
    this.#archiveDirty = true;
    this.#logger.info?.(`[modelduck] Archived ${evicted.length} older chat(s); open one from Archived to restore it.`);
  }

  list() {
    return this.#conversations.map(summarize).sort(newestFirst);
  }

  listArchived() {
    return this.#archived.map(summarize).sort(newestFirst);
  }

  get(id) {
    const conversation = this.#conversations.find((item) => item.id === id);
    return conversation ? clone(conversation) : null;
  }

  /** Moves an archived chat back to the active list; it counts as used now. */
  restore(id) {
    const index = this.#archived.findIndex((item) => item.id === id);
    if (index < 0) return null;
    const [conversation] = this.#archived.splice(index, 1);
    conversation.updatedAt = now();
    this.#conversations.unshift(conversation);
    this.#archiveDirty = true;
    this.#enforceLimit(conversation.id);
    return clone(conversation);
  }

  create({ modelId = null, modelName = null, title = "New chat" } = {}) {
    const timestamp = now();
    const conversation = {
      id: randomUUID(),
      title: title === "New chat" ? title : makeTitle(title),
      modelId,
      modelName,
      messages: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.#conversations.unshift(conversation);
    this.#enforceLimit(conversation.id);
    return clone(conversation);
  }

  appendMessage(id, { role, content, stats, manifest, stopped = false }) {
    const conversation = this.#conversations.find((item) => item.id === id);
    if (!conversation) return null;
    const message = {
      id: randomUUID(),
      role,
      content: String(content ?? ""),
      createdAt: now(),
    };
    if (stats) message.stats = stats;
    if (manifest && typeof manifest === "object") message.manifest = manifest;
    if (stopped) message.stopped = true;
    conversation.messages.push(message);
    conversation.updatedAt = message.createdAt;
    if (role === "user" && conversation.title === "New chat") {
      conversation.title = makeTitle(content);
    }
    return clone(message);
  }

  truncateToLastUser(id) {
    const conversation = this.#conversations.find((item) => item.id === id);
    if (!conversation) return null;
    let index = -1;
    for (let cursor = conversation.messages.length - 1; cursor >= 0; cursor -= 1) {
      if (conversation.messages[cursor].role === "user") {
        index = cursor;
        break;
      }
    }
    if (index < 0) return clone(conversation);
    conversation.messages = conversation.messages.slice(0, index + 1);
    conversation.updatedAt = now();
    return clone(conversation);
  }

  rename(id, title) {
    const conversation = this.#conversations.find((item) => item.id === id);
    if (!conversation) return null;
    const cleaned = String(title ?? "").replace(/\s+/g, " ").trim();
    if (cleaned) {
      conversation.title = cleaned.slice(0, TITLE_LIMIT);
      conversation.updatedAt = now();
    }
    return summarize(conversation);
  }

  setModel(id, { modelId = null, modelName = null } = {}) {
    const conversation = this.#conversations.find((item) => item.id === id);
    if (!conversation) return null;
    conversation.modelId = modelId;
    conversation.modelName = modelName;
    return summarize(conversation);
  }

  delete(id) {
    const index = this.#conversations.findIndex((item) => item.id === id);
    if (index >= 0) {
      this.#conversations.splice(index, 1);
      return true;
    }
    const archivedIndex = this.#archived.findIndex((item) => item.id === id);
    if (archivedIndex < 0) return false;
    this.#archived.splice(archivedIndex, 1);
    this.#archiveDirty = true;
    return true;
  }

  async save() {
    const snapshot = {
      version: 1,
      conversations: this.#conversations,
    };
    const archive = this.#archiveDirty ? { version: 1, conversations: [...this.#archived] } : null;
    this.#archiveDirty = false;
    this.#saveQueue = this.#saveQueue
      .catch(() => {})
      .then(async () => {
        if (archive) await writeJsonAtomic(this.#archiveFile, archive);
        await writeJsonAtomic(this.#file, snapshot);
      });
    return this.#saveQueue;
  }
}
