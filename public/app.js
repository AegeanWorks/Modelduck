import { escapeHtml, renderMarkdown } from "./markdown.js";

const $ = (id) => document.getElementById(id);

const els = {
  sidebar: $("sidebar"),
  scrim: $("scrim"),
  conversationList: $("conversation-list"),
  search: $("conversation-search"),
  chatTitle: $("chat-title"),
  messages: $("messages"),
  chatScroll: $("chat-scroll"),
  prompt: $("prompt"),
  composer: $("composer"),
  sendBtn: $("send-btn"),
  stopBtn: $("stop-btn"),
  composerHint: $("composer-hint"),
  contextNote: $("context-note"),
  modelPill: $("model-pill"),
  modelPillName: $("model-pill-name"),
  modelPillDot: $("model-pill-dot"),
  statusCard: $("status-card"),
  statusDot: $("status-dot"),
  statusModel: $("status-model"),
  statusDetail: $("status-detail"),
  themeIcon: $("theme-icon"),
  modelsDialog: $("models-dialog"),
  catalogGrid: $("catalog-grid"),
  installedList: $("installed-list"),
  installedCount: $("installed-count"),
  modelsTotal: $("models-total"),
  modelsDir: $("models-dir"),
  importPath: $("import-path"),
  importBtn: $("import-btn"),
  settingsDialog: $("settings-dialog"),
  settingsForm: $("settings-form"),
  taskPicker: $("task-picker"),
  settingTuned: $("setting-tuned"),
  settingSpeedPreset: $("setting-speed-preset"),
  settingSystem: $("setting-system"),
  settingTemp: $("setting-temp"),
  settingTopp: $("setting-topp"),
  settingTopk: $("setting-topk"),
  settingMinp: $("setting-minp"),
  settingRepeat: $("setting-repeat"),
  settingReasoning: $("setting-reasoning"),
  settingOverflow: $("setting-overflow"),
  settingStructured: $("setting-structured"),
  settingSchema: $("setting-schema"),
  settingMax: $("setting-max"),
  settingRepeatPrompt: $("setting-repeat-prompt"),
  settingContext: $("setting-context"),
  settingThreads: $("setting-threads"),
  settingMaxThreads: $("setting-max-threads"),
  settingBatch: $("setting-batch"),
  settingSequences: $("setting-sequences"),
  settingGpuLayers: $("setting-gpu-layers"),
  settingGpuBackend: $("setting-gpu-backend"),
  gpuStatus: $("gpu-status"),
  settingFlash: $("setting-flash"),
  settingMmap: $("setting-mmap"),
  settingCheckpoints: $("setting-checkpoints"),
  settingCheckpointInterval: $("setting-checkpoint-interval"),
  settingCheckpointMax: $("setting-checkpoint-max"),
  settingKv: $("setting-kv"),
  presetBar: $("preset-bar"),
  serverDialog: $("server-dialog"),
  serverForm: $("server-form"),
  serverPort: $("server-port"),
  serverTtl: $("server-ttl"),
  serverAuth: $("server-auth"),
  serverLan: $("server-lan"),
  serverCors: $("server-cors"),
  serverJit: $("server-jit"),
  serverJitAuto: $("server-jit-auto"),
  serverJitLast: $("server-jit-last"),
  serverMcpRequest: $("server-mcp-request"),
  serverMcpJson: $("server-mcp-json"),
  serverKeyCount: $("server-key-count"),
  serverKeyList: $("server-key-list"),
  serverKeyLabel: $("server-key-label"),
  serverKeyCreate: $("server-key-create"),
  serverKeyOutput: $("server-key-output"),
  serverKeyValue: $("server-key-value"),
  benchmarkDialog: $("benchmark-dialog"),
  benchmarkPhases: $("benchmark-phases"),
  benchmarkRecommendations: $("benchmark-recommendations"),
  benchmarkRunState: $("benchmark-run-state"),
  benchmarkPhase: $("benchmark-phase"),
  benchmarkBaseline: $("benchmark-baseline"),
  benchmarkDownload: $("benchmark-download"),
  benchmarkFull: $("benchmark-full"),
  benchmarkModel: $("benchmark-model"),
  benchmarkStart: $("benchmark-start"),
  benchmarkCancel: $("benchmark-cancel"),
  benchmarkProgress: $("benchmark-progress"),
  benchmarkChatBase: $("benchmark-chat-base"),
  tuneRunState: $("tune-run-state"),
  tuneStages: $("tune-stages"),
  tuneForce: $("tune-force"),
  tuneAll: $("tune-all"),
  tuneCancel: $("tune-cancel"),
  tuneProgress: $("tune-progress"),
  tuneModels: $("tune-models"),
  tuneOnly: $("tune-only"),
  tuneSettings: $("tune-settings"),
  tuneSettingsForm: $("tune-settings-form"),
  tuneSettingsSave: $("tune-settings-save"),
  tuneSettingsReset: $("tune-settings-reset"),
  tuneSettingsNote: $("tune-settings-note"),
  tempOut: $("temp-out"),
  toppOut: $("topp-out"),
  settingsNote: $("settings-note"),
  confirmDialog: $("confirm-dialog"),
  confirmTitle: $("confirm-title"),
  confirmMessage: $("confirm-message"),
  confirmOk: $("confirm-ok"),
  confirmCancel: $("confirm-cancel"),
  toastRoot: $("toast-root"),
};

const state = {
  app: null,
  settings: null,
  modelsDir: null,
  models: [],
  catalog: [],
  downloads: [],
  conversations: [],
  archivedConversations: [],
  presets: [],
  serverSettings: null,
  loaded: { status: "idle", model: null },
  activeId: null,
  conversation: null,
  streaming: false,
  stopRequested: false,
  streamText: "",
  streamMessageId: null,
  fetchAbort: null,
  search: "",
  theme: localStorage.getItem("modelduck.theme") || "dark",
  pollTimer: null,
  polling: false,
  benchmarkJob: null,
  benchmarkTimer: null,
  tuneOverview: null,
  tuneJob: null,
  tuneTimer: null,
  tuneDefaults: null,
  chatBase: null,
  completedDownloads: new Set(),
};

const SUGGESTIONS = [
  "Explain how a CPU runs a language model, simply.",
  "Write a haiku about a duck who loves local AI.",
  "Help me plan a small weekend project.",
];

/* API ---------------------------------------------------------------------- */

const API_KEY_STORAGE = "modelduck-api-key";

function savedApiKey() {
  try {
    return sessionStorage.getItem(API_KEY_STORAGE) || "";
  } catch {
    return "";
  }
}

async function apiFetch(path, options = {}, retried = false) {
  const headers = new Headers(options.headers || {});
  const key = savedApiKey();
  if (key) headers.set("x-api-key", key);
  const response = await fetch(path, { ...options, headers });
  if (response.status === 401 && !retried && path.startsWith("/api/")) {
    const entered = window.prompt(
      "This ModelDuck server requires an API key. Paste the key created in Server settings.",
    );
    if (entered && entered.trim()) {
      try {
        sessionStorage.setItem(API_KEY_STORAGE, entered.trim());
      } catch {}
      return apiFetch(path, options, true);
    }
  }
  return response;
}

async function request(path, { method = "GET", body } = {}) {
  const response = await apiFetch(path, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  if (!response.ok) {
    const info = data?.error ?? {};
    const error = new Error(info.message || `Request failed (${response.status})`);
    error.info = info;
    error.status = response.status;
    throw error;
  }
  return data ?? {};
}

async function responseError(response) {
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  const info = data?.error ?? {};
  const error = new Error(info.message || `Request failed (${response.status})`);
  error.info = info;
  error.status = response.status;
  return error;
}

async function readSse(response, handlers) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      let event = "message";
      let payload = "";
      for (const line of frame.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) payload += line.slice(5).trimStart();
      }
      if (payload) {
        let data;
        try {
          data = JSON.parse(payload);
        } catch {
          data = payload;
        }
        await handlers[event]?.(data);
      }
      boundary = buffer.indexOf("\n\n");
    }
  }
}

/* Formatting --------------------------------------------------------------- */

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let size = value;
  let unit = "B";
  for (const next of units) {
    if (size < 1024) break;
    size /= 1024;
    unit = next;
  }
  return `${size.toFixed(size >= 100 ? 0 : size >= 10 ? 1 : 2)} ${unit}`;
}

function formatRelative(iso) {
  const timestamp = new Date(iso).getTime();
  if (!Number.isFinite(timestamp)) return "";
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 50) return "just now";
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.round(seconds / 86400)}d ago`;
  return new Date(timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function escapeAttribute(value) {
  return escapeHtml(value);
}

function statsText(stats) {
  if (!stats) return "";
  const pieces = [];
  if (stats.outputTokens) pieces.push(`${stats.outputTokens} tokens`);
  if (stats.tokensPerSecond) pieces.push(`${stats.tokensPerSecond} tok/s`);
  if (stats.ms) pieces.push(`${(stats.ms / 1000).toFixed(1)}s`);
  return pieces.join(" · ");
}

/* Toasts ------------------------------------------------------------------- */

function showToast(title, { message = "", fix = "", kind = "info", timeout = 5200 } = {}) {
  const toast = document.createElement("div");
  toast.className = `toast ${kind === "error" ? "error" : ""}`;
  const copy = document.createElement("div");
  copy.className = "toast-copy";
  const strong = document.createElement("strong");
  strong.textContent = title;
  copy.appendChild(strong);
  if (message) {
    const body = document.createElement("p");
    body.textContent = message;
    copy.appendChild(body);
  }
  if (fix) {
    const hint = document.createElement("p");
    hint.className = "toast-fix";
    hint.textContent = `Fix: ${fix}`;
    copy.appendChild(hint);
  }
  const close = document.createElement("button");
  close.type = "button";
  close.className = "toast-close";
  close.setAttribute("aria-label", "Dismiss");
  close.textContent = "×";
  close.addEventListener("click", () => toast.remove());
  toast.append(copy, close);
  els.toastRoot.prepend(toast);
  while (els.toastRoot.children.length > 4) els.toastRoot.lastElementChild.remove();
  setTimeout(() => toast.remove(), timeout);
}

function showError(error) {
  const info = error?.info ?? {};
  showToast(info.message || error?.message || "Something went wrong", {
    message: info.why || "",
    fix: info.fix || "",
    kind: "error",
    timeout: 9000,
  });
}

/* Theme -------------------------------------------------------------------- */

function applyTheme() {
  document.documentElement.dataset.theme = state.theme;
  els.themeIcon.textContent = state.theme === "dark" ? "☾" : "☀";
  localStorage.setItem("modelduck.theme", state.theme);
}

/* Sidebar ------------------------------------------------------------------ */

function groupLabel(iso) {
  const date = new Date(iso);
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const time = date.getTime();
  if (time >= startToday) return "Today";
  if (time >= startToday - 86400000) return "Yesterday";
  if (time >= startToday - 7 * 86400000) return "Previous 7 days";
  return "Older";
}

function renderSidebar() {
  const query = state.search.trim().toLowerCase();
  const matches = (conversation) =>
    !query ||
    conversation.title.toLowerCase().includes(query) ||
    conversation.preview?.toLowerCase().includes(query);
  // Chats past the active limit are archived, never dropped; opening one restores it.
  const conversations = [
    ...state.conversations.filter(matches),
    ...state.archivedConversations.filter(matches).map((conversation) => ({ ...conversation, archived: true })),
  ];

  els.conversationList.replaceChildren();
  if (!conversations.length) {
    const empty = document.createElement("p");
    empty.className = "conversation-empty";
    empty.textContent = query
      ? "No chats match that search."
      : "No chats yet. Your first question starts a conversation.";
    els.conversationList.appendChild(empty);
    return;
  }

  let currentGroup = "";
  for (const conversation of conversations) {
    const group = conversation.archived ? "Archived" : groupLabel(conversation.updatedAt);
    if (group !== currentGroup) {
      currentGroup = group;
      const heading = document.createElement("div");
      heading.className = "conversation-group";
      heading.textContent = group;
      els.conversationList.appendChild(heading);
    }

    const row = document.createElement("div");
    row.className = `conversation ${conversation.id === state.activeId ? "active" : ""}`;
    row.dataset.id = conversation.id;

    const main = document.createElement("button");
    main.type = "button";
    main.className = "conversation-main";
    main.dataset.openConversation = conversation.id;
    const title = document.createElement("span");
    title.className = "conversation-title";
    title.textContent = conversation.title;
    const meta = document.createElement("span");
    meta.className = "conversation-meta";
    meta.textContent = `${conversation.modelName || "No model"} · ${formatRelative(conversation.updatedAt)}`;
    main.append(title, meta);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "conversation-delete";
    remove.dataset.deleteConversation = conversation.id;
    remove.title = "Delete chat";
    remove.setAttribute("aria-label", `Delete ${conversation.title}`);
    remove.textContent = "×";

    row.append(main, remove);
    els.conversationList.appendChild(row);
  }
}

/* Header and status -------------------------------------------------------- */

function renderHeader() {
  const title = state.conversation?.title || "New chat";
  els.chatTitle.textContent = title;
  document.title = state.conversation ? `${title} — ModelDuck` : "ModelDuck — local models, zero drama";

  const loaded = state.loaded;
  els.modelPillName.textContent = loaded.model?.name || "No model";
  els.modelPillDot.className = `dot ${loaded.status === "ready" ? "ready" : loaded.status === "loading" ? "loading" : ""}`;
}

function renderStatus() {
  const loaded = state.loaded;
  els.statusDot.className = `status-dot ${loaded.status === "ready" ? "ready" : loaded.status === "loading" ? "loading" : loaded.status === "error" ? "error" : ""}`;

  if (loaded.status === "ready" && loaded.model) {
    els.statusModel.textContent = loaded.model.name;
    const details = [];
    if (loaded.model.params) details.push(loaded.model.params);
    if (loaded.contextSize) details.push(`${loaded.contextSize} ctx`);
    if (loaded.threads) details.push(`${loaded.threads} threads`);
    if (loaded.kvCache && loaded.kvCache !== "f16") details.push(`KV ${loaded.kvCache}`);
    if (loaded.gpuBackend && loaded.gpuBackend !== "cpu") details.push(`GPU ${loaded.gpuBackend}`);
    els.statusDetail.textContent = details.join(" · ") || "Ready";
    els.contextNote.textContent = `${loaded.model.name} · ${loaded.contextSize || "?"} context`;
  } else if (loaded.status === "loading") {
    els.statusModel.textContent = loaded.model?.name || "Loading model…";
    els.statusDetail.textContent = "Warming up the duck…";
    els.contextNote.textContent = "Loading a model…";
  } else if (loaded.status === "error") {
    els.statusModel.textContent = "Model failed";
    els.statusDetail.textContent = "Open Models to try again";
    els.contextNote.textContent = "No model loaded.";
  } else {
    els.statusModel.textContent = "No model loaded";
    els.statusDetail.textContent = "Open Models to begin";
    els.contextNote.textContent = "No model loaded.";
  }
}

function renderComposer() {
  const ready = state.loaded.status === "ready";
  const canSend = ready && !state.streaming && els.prompt.value.trim().length > 0;
  els.sendBtn.disabled = !canSend;
  els.stopBtn.hidden = !state.streaming;
  els.sendBtn.hidden = state.streaming;
  els.prompt.placeholder = ready
    ? "Ask your local model anything…"
    : "Load a model to start chatting…";
  els.composerHint.textContent = state.streaming
    ? state.stopRequested
      ? "Stopping after the current token…"
      : "Generating locally · Stop to keep a partial reply"
    : "Enter to send · Shift+Enter for a new line";
}

/* Welcome ------------------------------------------------------------------ */

function welcomeFeatures() {
  return `
    <div class="welcome-features">
      <div class="feature"><strong>Private by default</strong><span>Prompts and replies never leave this computer.</span></div>
      <div class="feature"><strong>CPU friendly</strong><span>Small GGUF models run without a GPU.</span></div>
      <div class="feature"><strong>OpenAI compatible</strong><span>Point local tools at /v1/chat/completions.</span></div>
    </div>`;
}

function renderWelcome() {
  const models = state.models;
  const loaded = state.loaded;
  let headline = "A local brain, no cloud required.";
  let lede = "Download a small GGUF model and talk to it right here. ModelDuck keeps every token on this machine.";
  let actions = `
    <button class="primary-btn" type="button" data-open-models="discover">Get a starter model</button>
    <button class="small-btn" type="button" data-open-models="installed">I already have a GGUF</button>`;
  let note = "";

  if (models.length > 0 && loaded.status !== "ready") {
    headline = "Load a model to wake the duck.";
    lede = `You have ${models.length} model${models.length === 1 ? "" : "s"} ready. Pick one and ModelDuck will load it into memory.`;
    actions = `<button class="primary-btn" type="button" data-open-models="installed">Choose a model</button>`;
    note = `<span class="welcome-model-note"><span class="status-dot"></span>${escapeHtml(models[0].name)} is installed</span>`;
  }

  if (loaded.status === "ready" && loaded.model) {
    headline = "What should we ask your local model?";
    lede = `Talking to ${escapeHtml(loaded.model.name)}. Everything stays on this machine.`;
    actions = "";
    const details = [loaded.model.params, loaded.model.quant, `${loaded.contextSize || "?"} context`]
      .filter(Boolean)
      .join(" · ");
    note = `<span class="welcome-model-note"><span class="status-dot ready"></span>${escapeHtml(
      loaded.model.name,
    )}${details ? ` · ${escapeHtml(details)}` : ""}</span>`;
  }

  const suggestions = loaded.status === "ready"
    ? `<div class="welcome-suggestions">${SUGGESTIONS.map(
        (suggestion) =>
          `<button class="suggestion" type="button" data-suggestion="${escapeAttribute(suggestion)}">${escapeHtml(suggestion)}</button>`,
      ).join("")}</div>`
    : "";

  els.messages.innerHTML = `
    <div class="welcome">
      <img class="welcome-duck" src="/brand/duck.svg" alt="ModelDuck mascot" />
      <p class="eyebrow">ModelDuck · local AI</p>
      <h2>${headline}</h2>
      <p class="lede">${lede}</p>
      ${actions ? `<div class="welcome-actions">${actions}</div>` : ""}
      ${note}
      ${suggestions}
      ${welcomeFeatures()}
    </div>`;
  els.messages.querySelectorAll("[data-suggestion]").forEach((button) => {
    button.addEventListener("click", () => {
      els.prompt.value = button.dataset.suggestion || "";
      resizePrompt();
      renderComposer();
      els.prompt.focus();
    });
  });
  els.messages.querySelectorAll("[data-open-models]").forEach((button) => {
    button.addEventListener("click", () => openModels(button.dataset.openModels || "discover"));
  });
}

/* Chat rendering ----------------------------------------------------------- */

function appendMessage(message, index, total) {
  const isUser = message.role === "user";
  const row = document.createElement("article");
  row.className = `msg ${isUser ? "user" : "assistant"}`;
  row.dataset.messageId = message.id;
  if (message.pending) row.classList.add("streaming");
  if (message.stopped) row.classList.add("stopped");

  if (!isUser) {
    const avatar = document.createElement("img");
    avatar.className = "msg-avatar";
    avatar.src = "/brand/duck.svg";
    avatar.alt = "";
    row.appendChild(avatar);
  }

  const body = document.createElement("div");
  body.className = "msg-body";

  if (isUser) {
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.textContent = message.content;
    body.appendChild(bubble);
  } else {
    const name = document.createElement("div");
    name.className = "msg-name";
    name.textContent = "ModelDuck";
    const markdown = document.createElement("div");
    markdown.className = "markdown";
    markdown.innerHTML = message.content ? renderMarkdown(message.content) : "";
    body.append(name, markdown);
  }

  const foot = document.createElement("div");
  foot.className = "msg-foot";
  const label = document.createElement("span");
  const fingerprint =
    !isUser && message.manifest?.shortDigest ? ` · fp ${message.manifest.shortDigest}` : "";
  label.textContent =
    (isUser
      ? formatTime(message.createdAt)
      : message.stopped
        ? `Stopped · ${statsText(message.stats)}`
        : statsText(message.stats) || "local reply") + fingerprint;
  if (!isUser && message.manifest?.digest) label.title = `Generation fingerprint ${message.manifest.digest}`;
  if (!isUser && message.tuned) {
    const tuned = message.tuned;
    label.textContent += ` · tuned: ${tuned.task ?? "load only"} · ${tuned.speedPreset}${tuned.warnings?.length ? " ⚠" : ""}`;
    label.title = [label.title, `Profile ${tuned.catalogId}`, tuned.systemPrompt ? `System prompt: ${tuned.systemPrompt}` : "", ...(tuned.warnings ?? [])].filter(Boolean).join("\n");
  }
  foot.appendChild(label);

  const actions = document.createElement("div");
  actions.className = "msg-actions";
  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "msg-action";
  copy.dataset.copyMessage = message.id;
  copy.textContent = "Copy";
  actions.appendChild(copy);

  if (!isUser && message.role === "assistant" && index === total - 1 && !message.pending) {
    const regenerate = document.createElement("button");
    regenerate.type = "button";
    regenerate.className = "msg-action";
    regenerate.dataset.regenerate = "true";
    regenerate.textContent = "Regenerate";
    actions.appendChild(regenerate);
  }
  foot.appendChild(actions);
  body.appendChild(foot);
  row.appendChild(body);
  els.messages.appendChild(row);
}

function renderChat(forceScroll = false) {
  const messages = state.conversation?.messages ?? [];
  if (!messages.length) {
    renderWelcome();
    return;
  }
  els.messages.replaceChildren();
  messages.forEach((message, index) => appendMessage(message, index, messages.length));
  scrollToBottom(forceScroll);
}

function updateStreamingMessage() {
  if (!state.streamMessageId) return;
  const node = els.messages.querySelector(
    `[data-message-id="${state.streamMessageId}"] .markdown`,
  );
  if (!node) return;
  node.innerHTML = renderMarkdown(state.streamText);
  scrollToBottom(false);
}

let streamFrame = null;
function scheduleStreamingUpdate() {
  if (streamFrame) return;
  streamFrame = requestAnimationFrame(() => {
    streamFrame = null;
    updateStreamingMessage();
  });
}

function scrollToBottom(force) {
  const element = els.chatScroll;
  const nearBottom =
    element.scrollHeight - element.scrollTop - element.clientHeight < 140;
  if (!force && !nearBottom) return;
  requestAnimationFrame(() => {
    element.scrollTop = element.scrollHeight;
  });
}

/* Conversations ------------------------------------------------------------ */

async function refreshConversations() {
  try {
    const data = await request("/api/conversations");
    state.conversations = data.conversations;
    state.archivedConversations = data.archived ?? [];
    renderSidebar();
  } catch {
    // A stale sidebar is less important than the reply in progress.
  }
}

async function ensureConversation(title) {
  if (state.conversation?.id) return;
  const data = await request("/api/conversations", {
    method: "POST",
    body: { title },
  });
  state.conversation = data.conversation;
  state.activeId = data.conversation.id;
  renderHeader();
  await refreshConversations();
}

async function openConversation(id) {
  if (state.streaming) {
    showToast("Finish the current reply first", {
      message: "Stop the reply or wait for it to finish before switching chats.",
    });
    return;
  }
  try {
    const data = await request(`/api/conversations/${encodeURIComponent(id)}`);
    state.conversation = data.conversation;
    state.activeId = data.conversation.id;
    renderHeader();
    renderChat(true);
    if (state.archivedConversations.some((item) => item.id === id)) await refreshConversations();
    closeSidebar();
    els.prompt.focus();
  } catch (error) {
    showError(error);
    await refreshConversations();
  }
}

function newChat() {
  if (state.streaming) {
    showToast("Finish the current reply first", {
      message: "Stop the reply or wait for it to finish before starting a new chat.",
    });
    return;
  }
  state.activeId = null;
  state.conversation = null;
  renderHeader();
  renderChat();
  closeSidebar();
  els.prompt.focus();
}

async function deleteConversation(id) {
  if (id === state.activeId && state.streaming) {
    showToast("Stop the reply first", { message: "A running reply cannot be deleted." });
    return;
  }
  const conversation = state.conversations.find((item) => item.id === id);
  const confirmed = await askConfirm(
    "Delete this chat?",
    conversation ? `"${conversation.title}" and its messages will be removed from this computer.` : "This chat will be removed.",
    "Delete chat",
  );
  if (!confirmed) return;
  try {
    await request(`/api/conversations/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (id === state.activeId) newChat();
    await refreshConversations();
    showToast("Chat deleted");
  } catch (error) {
    showError(error);
  }
}

/* Chat streaming ----------------------------------------------------------- */

async function sendMessage(rawText, { regenerate = false } = {}) {
  const text = String(rawText ?? "").trim();
  if (!text || state.streaming) return;
  if (state.loaded.status !== "ready") {
    openModels("installed");
    showToast("Load a model first", {
      message: "Choose an installed model, then send your message again.",
      fix: "Open Models → Installed → Load.",
    });
    return;
  }

  try {
    await ensureConversation(text);
  } catch (error) {
    showError(error);
    return;
  }

  if (regenerate) {
    if (!state.conversation) return;
    while (state.conversation.messages.at(-1)?.role === "assistant") {
      state.conversation.messages.pop();
    }
    if (!state.conversation.messages.length) return;
  } else {
    state.conversation.messages.push({
      id: `local-user-${Date.now()}`,
      role: "user",
      content: text,
      createdAt: new Date().toISOString(),
    });
  }

  const assistantId = `local-assistant-${Date.now()}`;
  state.conversation.messages.push({
    id: assistantId,
    role: "assistant",
    content: "",
    createdAt: new Date().toISOString(),
    pending: true,
  });
  state.streamText = "";
  state.streamMessageId = assistantId;
  state.streaming = true;
  state.stopRequested = false;
  renderChat(true);
  renderComposer();
  els.prompt.value = "";
  resizePrompt();

  const controller = new AbortController();
  state.fetchAbort = controller;
  let streamedError = null;
  let doneMessage = null;

  try {
    const response = await apiFetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        conversationId: state.activeId,
        message: text,
        regenerate,
        task: els.taskPicker.value,
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw await responseError(response);

    await readSse(response, {
      meta: async (data) => {
        state.activeId = data.conversationId;
        if (state.conversation) {
          state.conversation.id = data.conversationId;
          state.conversation.title = data.title;
        }
        renderHeader();
        await refreshConversations();
      },
      token: (data) => {
        state.streamText += data.text ?? "";
        const message = state.conversation?.messages.find((item) => item.id === assistantId);
        if (message) message.content = state.streamText;
        scheduleStreamingUpdate();
      },
      done: (data) => {
        doneMessage = data;
        if (data.message) {
          const message = state.conversation?.messages.find((item) => item.id === assistantId);
          if (message) {
            Object.assign(message, data.message, { tuned: data.tuned ?? null });
            delete message.pending;
          }
        }
        if (data.title && state.conversation) state.conversation.title = data.title;
      },
      error: (data) => {
        streamedError = new Error(data.message || "Generation failed");
        streamedError.info = data;
      },
    });
  } catch (error) {
    if (error.name !== "AbortError") streamedError = streamedError || error;
  } finally {
    state.streaming = false;
    state.stopRequested = false;
    state.fetchAbort = null;
    state.streamMessageId = null;

    if (streamedError) {
      const message = state.conversation?.messages.find((item) => item.id === assistantId);
      if (message && !message.content) {
        state.conversation.messages = state.conversation.messages.filter(
          (item) => item.id !== assistantId,
        );
      }
      showError(streamedError);
    }

    const pending = state.conversation?.messages.find((item) => item.id === assistantId);
    if (pending) {
      if (!pending.content && !doneMessage?.message) {
        state.conversation.messages = state.conversation.messages.filter(
          (item) => item.id !== assistantId,
        );
      } else {
        delete pending.pending;
      }
    }

    if (state.activeId && !doneMessage) {
      try {
        const data = await request(`/api/conversations/${encodeURIComponent(state.activeId)}`);
        state.conversation = data.conversation;
      } catch {
        // Keep the local copy when the server is unreachable.
      }
    }

    renderHeader();
    renderChat(true);
    renderComposer();
    renderStatus();
    await refreshConversations();
    els.prompt.focus();
  }
}

async function stopGeneration() {
  if (!state.streaming) return;
  state.stopRequested = true;
  renderComposer();
  if (!state.activeId) {
    state.fetchAbort?.abort();
    return;
  }
  const currentAbort = state.fetchAbort;
  setTimeout(() => {
    if (state.streaming && state.stopRequested && state.fetchAbort === currentAbort) {
      state.fetchAbort?.abort();
    }
  }, 10_000);
  try {
    await request("/api/chat/abort", {
      method: "POST",
      body: { conversationId: state.activeId },
    });
  } catch (error) {
    showError(error);
  }
}

async function regenerateLast() {
  if (state.streaming || !state.conversation) return;
  const lastUser = [...state.conversation.messages].reverse().find((message) => message.role === "user");
  if (!lastUser) return;
  await sendMessage(lastUser.content, { regenerate: true });
}

/* Models ------------------------------------------------------------------- */

function hasActiveDownloads() {
  return state.downloads.some((job) => job.status === "queued" || job.status === "downloading");
}

function stopDownloadPolling() {
  if (state.pollTimer) clearInterval(state.pollTimer);
  state.pollTimer = null;
}

function startDownloadPolling() {
  if (state.pollTimer) return;
  state.pollTimer = setInterval(pollDownloads, 1000);
}

async function pollDownloads() {
  if (state.polling) return;
  state.polling = true;
  try {
    const data = await request("/api/downloads");
    const wasActive = hasActiveDownloads();
    state.downloads = data.downloads;
    if (els.modelsDialog.open) renderCatalog();
    const active = hasActiveDownloads();
    for (const job of state.downloads) {
      if (job.status === "complete" && !state.completedDownloads.has(job.id)) {
        state.completedDownloads.add(job.id);
        showToast("Download complete", { message: `${job.name} is ready to load.` });
        await refreshModels();
      }
      if (job.status === "error" && !state.completedDownloads.has(job.id)) {
        state.completedDownloads.add(job.id);
        showToast("Download failed", {
          message: job.error?.why || "The model could not be downloaded.",
          fix: job.error?.fix || "Try again.",
          kind: "error",
        });
      }
    }
    if (wasActive && !active) await refreshModels();
    if (!active) stopDownloadPolling();
  } catch {
    // Keep the last progress view; the next tick may recover.
  } finally {
    state.polling = false;
  }
}

async function refreshModels() {
  try {
    const data = await request("/api/models");
    state.models = data.models;
    state.modelsDir = data.modelsDir ?? state.modelsDir;
    if (els.modelsDialog.open) {
      renderInstalled();
      renderCatalog();
    }
    renderStatus();
    renderWelcomeIfEmpty();
  } catch (error) {
    showError(error);
  }
}

function renderWelcomeIfEmpty() {
  if (!state.conversation || !state.conversation.messages.length) renderChat();
}

function latestDownload(catalogId) {
  return state.downloads
    .filter((job) => job.catalogId === catalogId)
    .sort((left, right) => String(right.startedAt).localeCompare(String(left.startedAt)))[0];
}

function renderCatalog() {
  if (!els.catalogGrid) return;
  els.catalogGrid.replaceChildren();
  for (const model of state.catalog) {
    const installed = state.models.find((item) => item.fileName === model.file);
    const job = latestDownload(model.id);
    const downloading = job && (job.status === "queued" || job.status === "downloading");
    const card = document.createElement("article");
    card.className = `model-card ${model.recommended ? "recommended" : ""}`;
    card.dataset.catalogId = model.id;

    const badges = [];
    if (model.recommended) badges.push('<span class="badge accent">Recommended</span>');
    if (model.tags?.includes("heavy")) badges.push('<span class="badge">Heavy</span>');
    if (model.tags?.includes("test")) badges.push('<span class="badge">Tiny</span>');
    if (installed) badges.push('<span class="badge green">Installed</span>');

    let foot = "";
    if (installed) {
      foot = `<button class="small-btn" type="button" data-load="${escapeAttribute(installed.id)}">Load</button>`;
    } else if (downloading) {
      foot = `
        <div class="download-state">
          <div class="download-row"><span>${job.percent}% · ${formatBytes(job.received)} / ${formatBytes(job.size)}</span><button class="msg-action" type="button" data-cancel-download="${escapeAttribute(job.id)}">Cancel</button></div>
          <div class="progress"><span style="width:${job.percent}%"></span></div>
        </div>`;
    } else if (job?.status === "error") {
      foot = `<button class="small-btn" type="button" data-download="${escapeAttribute(model.id)}">Retry download</button>`;
    } else if (job?.status === "complete") {
      foot = `<button class="small-btn" type="button" data-refresh-models="true">Refresh library</button>`;
    } else {
      foot = `<button class="primary-btn" type="button" data-download="${escapeAttribute(model.id)}">Download</button>`;
    }

    card.innerHTML = `
      <div class="model-card-head">
        <h4>${escapeHtml(model.name)}</h4>
        <div class="model-badges">${badges.join("")}</div>
      </div>
      <p class="model-tagline">${escapeHtml(model.tagline)}</p>
      <div class="model-specs">
        <span><strong>${escapeHtml(model.params)}</strong> params</span>
        <span><strong>${escapeHtml(model.quant)}</strong></span>
        <span><strong>${Number(model.context).toLocaleString()}</strong> ctx</span>
        <span>${escapeHtml(model.license)}</span>
      </div>
      <div class="model-card-foot">
        ${foot}
        <span class="model-size">${formatBytes(model.size)}</span>
      </div>`;
    els.catalogGrid.appendChild(card);
  }
}

function renderInstalled() {
  els.installedCount.textContent = String(state.models.length);
  els.modelsTotal.textContent = String(state.models.length);
  if (state.modelsDir) els.modelsDir.textContent = state.modelsDir;
  els.installedList.replaceChildren();

  if (!state.models.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.innerHTML = `
      <strong>No models in the library yet</strong>
      <p>Download a starter model from Discover, or import a GGUF file you already have.</p>
      <div class="welcome-actions"><button class="primary-btn" type="button" data-open-discover="true">Browse models</button></div>`;
    els.installedList.appendChild(empty);
    return;
  }

  for (const model of state.models) {
    const row = document.createElement("div");
    row.className = "installed-card";
    const loaded = state.loaded.model?.id === model.id;
    const loading = loaded && state.loaded.status === "loading";
    const actions = loaded
      ? `<button class="small-btn" type="button" data-unload="true">Unload</button>`
      : `<button class="small-btn" type="button" data-load="${escapeAttribute(model.id)}" ${loading ? "disabled" : ""}>${loading ? "Loading…" : "Load"}</button>`;
    row.innerHTML = `
      <div class="installed-icon"><img src="/brand/duck.svg" alt="" /></div>
      <div class="installed-main">
        <strong>${escapeHtml(model.name)}</strong>
        <span>${escapeHtml(model.fileName)} · ${escapeHtml(model.params)} · ${escapeHtml(model.quant)}${model.contextLength ? ` · ${Number(model.contextLength).toLocaleString()} ctx` : ""} · ${escapeHtml(model.sizeLabel)}</span>
      </div>
      <div class="installed-actions">
        ${model.blocked
          ? `<span class="badge" title="${escapeAttribute(model.blockedReason || "")}">Blocked</span>`
          : model.unreadable ? '<span class="badge">Unreadable</span>' : ""}
        ${model.blocked ? "" : actions}
        <button class="small-btn" type="button" data-delete-model="${escapeAttribute(model.id)}" ${loaded ? "disabled" : ""}>Delete</button>
      </div>`;
    els.installedList.appendChild(row);
  }
}

function openModels(tab = "discover") {
  if (state.streaming) {
    showToast("Finish the current reply first", {
      message: "Loading or switching models would stop the current generation.",
    });
    return;
  }
  switchTab(tab);
  if (!els.modelsDialog.open) els.modelsDialog.showModal();
  refreshCatalog();
  if (hasActiveDownloads()) startDownloadPolling();
}

function switchTab(tab) {
  document.querySelectorAll(".tab").forEach((button) => {
    const active = button.dataset.tab === tab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  $("tab-discover").hidden = tab !== "discover";
  $("tab-installed").hidden = tab !== "installed";
  if (tab === "installed") renderInstalled();
}

async function refreshCatalog() {
  try {
    const data = await request("/api/catalog");
    state.catalog = data.catalog;
    state.models = data.models;
    state.modelsDir = data.modelsDir ?? state.modelsDir;
    state.downloads = data.downloads;
    renderCatalog();
    renderInstalled();
    if (hasActiveDownloads()) startDownloadPolling();
  } catch (error) {
    showError(error);
  }
}

async function loadModel(id, { force = false } = {}) {
  const model = state.models.find((item) => item.id === id);
  if (!model) return;
  state.loaded = { status: "loading", model };
  renderStatus();
  renderHeader();
  if (els.modelsDialog.open) renderInstalled();
  try {
    const data = await request(`/api/models/${encodeURIComponent(id)}/load`, {
      method: "POST",
      body: {
        contextSize: state.settings?.contextSize,
        threads: state.settings?.threads,
        maxThreads: state.settings?.maxThreads,
        batchSize: state.settings?.batchSize,
        sequences: state.settings?.sequences,
        flashAttention: state.settings?.flashAttention,
        useMmap: state.settings?.useMmap,
        gpuLayers: state.settings?.gpuLayers,
        gpuBackend: state.settings?.gpuBackend,
        checkpoints: state.settings?.checkpoints,
        checkpointInterval: state.settings?.checkpointInterval,
        checkpointMax: state.settings?.checkpointMax,
        kvCache: state.settings?.kvCache,
        force,
      },
    });
    state.loaded = data.loaded;
    renderHeader();
    renderStatus();
    renderChat();
    if (els.modelsDialog.open) els.modelsDialog.close();
    showToast("Model loaded", {
      message: `${model.name} is ready on ${data.loaded.threads} CPU thread${data.loaded.threads === 1 ? "" : "s"}.`,
    });
    const fallback = data.loaded.contextFallback;
    if (fallback) {
      showToast("Context was reduced", {
        message: `You asked for ${fallback.requested} tokens; only ${fallback.actual} could be allocated.`,
        fix: "Lower Context size, use the q8_0 KV cache, or close other programs, then reload.",
      });
    } else if (data.loaded.fit?.verdict === "tight") {
      showToast("Memory is tight", {
        message: "This model and context use most of the free memory; other programs may slow it down.",
      });
    }
    els.prompt.focus();
  } catch (error) {
    state.loaded = { status: "error", model, error: error.message };
    renderStatus();
    renderHeader();
    if (els.modelsDialog.open) renderInstalled();
    if (error.info?.code === "model_will_not_fit" && !force) {
      const confirmed = await askConfirm(
        "This model may not fit in memory",
        `${error.info.why || error.message} ${error.info.fix || ""}`.trim(),
        "Load anyway",
      );
      if (confirmed) await loadModel(id, { force: true });
      return;
    }
    showError(error);
  }
}

async function unloadModel() {
  try {
    const data = await request("/api/models/unload", { method: "POST" });
    state.loaded = data.loaded;
    renderHeader();
    renderStatus();
    renderChat();
    if (els.modelsDialog.open) renderInstalled();
    showToast("Model unloaded", { message: "Memory is free again." });
  } catch (error) {
    showError(error);
  }
}

async function deleteModel(id) {
  const model = state.models.find((item) => item.id === id);
  if (!model) return;
  const confirmed = await askConfirm(
    "Delete this model file?",
    `${model.name}\n\n${model.fileName} will be removed from your model folder. You can download it again later.`,
    "Delete model",
  );
  if (!confirmed) return;
  try {
    const data = await request(`/api/models/${encodeURIComponent(id)}`, { method: "DELETE" });
    state.models = data.models;
    renderInstalled();
    renderCatalog();
    renderStatus();
    showToast("Model deleted");
  } catch (error) {
    showError(error);
  }
}

async function startDownload(catalogId, button) {
  if (button) button.disabled = true;
  try {
    const data = await request("/api/downloads", {
      method: "POST",
      body: { catalogId },
    });
    state.downloads = [data.download, ...state.downloads.filter((item) => item.id !== data.download.id)];
    renderCatalog();
    startDownloadPolling();
    showToast("Download started", { message: `${data.download.name} will appear in Installed when it finishes.` });
  } catch (error) {
    if (button) button.disabled = false;
    showError(error);
  }
}

async function cancelDownload(id) {
  try {
    const data = await request(`/api/downloads/${encodeURIComponent(id)}`, { method: "DELETE" });
    state.downloads = state.downloads.map((job) => (job.id === data.download.id ? data.download : job));
    renderCatalog();
  } catch (error) {
    showError(error);
  }
}

async function importModel() {
  const path = els.importPath.value.trim();
  if (!path) {
    showToast("Paste a file path first", {
      message: "Use the full path to a .gguf file on this computer.",
    });
    return;
  }
  els.importBtn.disabled = true;
  els.importBtn.textContent = "Importing…";
  try {
    const data = await request("/api/models/import", { method: "POST", body: { path } });
    state.models = data.models;
    els.importPath.value = "";
    renderInstalled();
    renderCatalog();
    showToast("Model imported", { message: `${data.model.name} is ready to load.` });
  } catch (error) {
    showError(error);
  } finally {
    els.importBtn.disabled = false;
    els.importBtn.textContent = "Import";
  }
}

async function openModelsFolder() {
  try {
    await request("/api/models/open-folder", { method: "POST" });
  } catch (error) {
    showError(error);
  }
}

/* Settings ----------------------------------------------------------------- */

const GPU_LABELS = {
  cuda: "CUDA",
  vulkan: "Vulkan",
  metal: "Metal",
  cpu: "CPU",
};

async function loadGpuStatus() {
  if (!els.gpuStatus) return;
  els.gpuStatus.textContent = "Checking the installed runtime…";
  try {
    const data = await request("/api/gpu");
    const names = (data.backends ?? [])
      .map((backend) => (backend === false ? "cpu" : String(backend)))
      .map((backend) => GPU_LABELS[backend] ?? backend);
    const detected = [...new Set(names)];
    els.gpuStatus.textContent = detected.length
      ? `Detected: ${detected.join(", ")}. ${data.note ?? ""}`.trim()
      : "No GPU backend detected; CPU inference remains available.";
  } catch {
    els.gpuStatus.textContent = "Could not detect GPU backends; CPU inference remains available.";
  }
}

function openSettings() {
  const settings = state.settings;
  if (!settings) return;
  els.settingSystem.value = settings.systemPrompt;
  els.settingTuned.checked = settings.useTunedProfile !== false;
  els.settingSpeedPreset.value = settings.speedPreset === "light" ? "light" : "fastest";
  els.settingTemp.value = settings.temperature;
  els.settingTopp.value = settings.topP;
  els.settingTopk.value = settings.topK;
  els.settingMinp.value = settings.minP;
  els.settingRepeat.value = settings.repeatPenalty;
  els.settingReasoning.value = settings.reasoning;
  els.settingOverflow.value = settings.contextOverflow;
  els.settingStructured.value = settings.structuredOutput;
  els.settingSchema.value = settings.jsonSchema || "";
  els.settingMax.value = settings.maxTokens;
  els.settingRepeatPrompt.value = String(settings.promptRepeat ?? 1);
  els.settingContext.value = settings.contextSize;
  els.settingThreads.value = settings.threads;
  els.settingMaxThreads.value = settings.maxThreads;
  els.settingBatch.value = settings.batchSize;
  els.settingSequences.value = settings.sequences;
  els.settingGpuLayers.value = settings.gpuLayers;
  els.settingGpuBackend.value = settings.gpuBackend || "cpu";
  els.settingFlash.value = settings.flashAttention;
  els.settingMmap.value = settings.useMmap;
  els.settingCheckpoints.value = String(settings.checkpoints);
  els.settingCheckpointInterval.value = settings.checkpointInterval ?? 8192;
  els.settingCheckpointMax.value = settings.checkpointMax ?? 32;
  els.settingKv.value = settings.kvCache || "f16";
  updateSettingsOutputs();
  renderPresets();
  loadGpuStatus();
  els.settingsNote.textContent = state.loaded.status === "ready"
    ? "Temperature, top P and max tokens apply to the next message. Context, threads, batching, attention, mmap, checkpoints and KV cache apply after reloading the model."
    : "Changes are saved on this computer. Nothing is sent anywhere.";
  if (!els.settingsDialog.open) els.settingsDialog.showModal();
}

function renderPresets() {
  if (!els.presetBar || els.presetBar.children.length) return;
  for (const preset of state.presets) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "preset-btn";
    button.dataset.preset = preset.id;
    const title = document.createElement("strong");
    title.textContent = preset.label;
    const description = document.createElement("span");
    description.textContent = preset.description;
    button.append(title, description);
    button.addEventListener("click", () => applyPresetToForm(preset));
    els.presetBar.appendChild(button);
  }
}

function applySettingsToForm(values) {
  if (values.contextSize !== undefined) els.settingContext.value = values.contextSize;
  if (values.batchSize !== undefined) els.settingBatch.value = values.batchSize;
  if (values.maxTokens !== undefined) els.settingMax.value = values.maxTokens;
  if (values.topK !== undefined) els.settingTopk.value = values.topK;
  if (values.minP !== undefined) els.settingMinp.value = values.minP;
  if (values.repeatPenalty !== undefined) els.settingRepeat.value = values.repeatPenalty;
  if (values.reasoning !== undefined) els.settingReasoning.value = values.reasoning;
  if (values.promptRepeat !== undefined) els.settingRepeatPrompt.value = String(values.promptRepeat);
  if (values.kvCache !== undefined) els.settingKv.value = values.kvCache;
  if (values.flashAttention !== undefined) els.settingFlash.value = values.flashAttention;
  if (values.useMmap !== undefined) els.settingMmap.value = values.useMmap;
  if (values.checkpoints !== undefined) els.settingCheckpoints.value = String(values.checkpoints);
  if (values.checkpointInterval !== undefined) els.settingCheckpointInterval.value = values.checkpointInterval;
  if (values.checkpointMax !== undefined) els.settingCheckpointMax.value = values.checkpointMax;
  if (values.sequences !== undefined) els.settingSequences.value = values.sequences;
  if (values.threads !== undefined) els.settingThreads.value = values.threads;
  if (values.maxThreads !== undefined) els.settingMaxThreads.value = values.maxThreads;
  if (values.gpuLayers !== undefined) els.settingGpuLayers.value = values.gpuLayers;
  if (values.gpuBackend !== undefined) els.settingGpuBackend.value = values.gpuBackend;
  updateSettingsOutputs();
}

function applyPresetToForm(preset) {
  applySettingsToForm(preset.settings);
  els.settingsNote.textContent = `${preset.label} preset loaded into the form. Save settings, then reload the model if it is already loaded.`;
  els.presetBar.querySelectorAll(".preset-btn").forEach((button) => {
    button.classList.toggle("active", button.dataset.preset === preset.id);
  });
}

/* Server settings ---------------------------------------------------------- */

async function openServerSettings() {
  try {
    const data = await request("/api/server-settings");
    state.serverSettings = { ...data.settings, apiKeys: data.apiKeys, activeKeys: data.activeKeys };
    renderServerSettings();
    if (!els.serverDialog.open) els.serverDialog.showModal();
  } catch (error) {
    showError(error);
  }
}

function renderServerSettings() {
  const config = state.serverSettings;
  if (!config) return;
  els.serverPort.value = config.port;
  els.serverTtl.value = config.maxIdleTtlMinutes;
  els.serverAuth.checked = Boolean(config.requireAuth);
  els.serverLan.checked = Boolean(config.serveOnLocalNetwork);
  els.serverCors.checked = Boolean(config.enableCors);
  els.serverJit.checked = Boolean(config.justInTimeModelLoading);
  els.serverJitAuto.checked = Boolean(config.autoUnloadUnusedJit);
  els.serverJitLast.checked = Boolean(config.onlyKeepLastJitLoadedModel);
  els.serverMcpRequest.checked = Boolean(config.allowPerRequestMcps);
  els.serverMcpJson.checked = Boolean(config.allowCallingServersFromMcpJson);
  els.serverKeyCount.textContent = `${config.activeKeys ?? 0} active`;
  renderServerKeys(config.apiKeys ?? []);
  if (config.requireAuth && (config.activeKeys ?? 0) === 0) {
    els.serverKeyCount.textContent = "0 active — add one before enabling auth";
  }
}

function renderServerKeys(keys) {
  els.serverKeyList.replaceChildren();
  if (!keys.length) {
    const empty = document.createElement("p");
    empty.className = "key-empty";
    empty.textContent = "No API keys yet.";
    els.serverKeyList.appendChild(empty);
    return;
  }
  for (const key of keys) {
    const row = document.createElement("div");
    row.className = "key-row";
    const label = document.createElement("strong");
    label.textContent = key.label;
    const prefix = document.createElement("span");
    prefix.textContent = `${key.prefix}…`;
    const used = document.createElement("span");
    used.textContent = key.lastUsedAt ? `last used ${formatRelative(key.lastUsedAt)}` : "never used";
    const actions = document.createElement("div");
    actions.className = "key-actions";
    const revoke = document.createElement("button");
    revoke.type = "button";
    revoke.className = "small-btn";
    revoke.textContent = "Revoke";
    revoke.addEventListener("click", () => revokeServerKey(key));
    actions.appendChild(revoke);
    row.append(label, prefix, used, actions);
    els.serverKeyList.appendChild(row);
  }
}

function benchmarkMetric(label, value) {
  const box = document.createElement("div");
  box.className = "benchmark-metric";
  const strong = document.createElement("strong");
  strong.textContent = value;
  const small = document.createElement("small");
  small.textContent = label;
  box.append(strong, small);
  return box;
}

function phaseTitle(phase) {
  if (phase === "model") return "Model reloading";
  if (phase === "chat") return "Model usage";
  if (phase === "single") return "Single-model settings";
  return phase;
}

function renderDatasetTable(items) {
  if (!items?.byDataset) return null;
  const section = document.createElement("div");
  section.className = "benchmark-types";
  const heading = document.createElement("h4");
  heading.textContent = "Public datasets";
  const table = document.createElement("table");
  table.className = "benchmark-table";
  const headRow = document.createElement("tr");
  for (const label of ["Dataset", "Pass", "Rate", "95% CI"]) {
    const th = document.createElement("th");
    th.textContent = label;
    headRow.appendChild(th);
  }
  const thead = document.createElement("thead");
  thead.appendChild(headRow);
  const tbody = document.createElement("tbody");
  for (const [dataset, value] of Object.entries(items.byDataset)) {
    if (dataset === "own") continue;
    const row = document.createElement("tr");
    const name = document.createElement("td");
    name.textContent = dataset;
    const pass = document.createElement("td");
    pass.textContent = `${value.passed}/${value.total}`;
    const rate = document.createElement("td");
    rate.textContent = `${value.rate}%`;
    const ci = document.createElement("td");
    ci.textContent = value.ci95 ? `${value.ci95.low}-${value.ci95.high}%` : "—";
    row.append(name, pass, rate, ci);
    tbody.appendChild(row);
  }
  if (!tbody.children.length) return null;
  table.append(thead, tbody);
  section.append(heading, table);
  return section;
}

function renderCategoryTable(items) {
  if (!items?.byCategory) return null;
  const section = document.createElement("div");
  section.className = "benchmark-types";
  const heading = document.createElement("h4");
  heading.textContent = "By item type";
  const table = document.createElement("table");
  table.className = "benchmark-table";
  const headRow = document.createElement("tr");
  for (const label of ["Type", "Pass", "Rate", "95% CI"]) {
    const th = document.createElement("th");
    th.textContent = label;
    headRow.appendChild(th);
  }
  const thead = document.createElement("thead");
  thead.appendChild(headRow);
  const tbody = document.createElement("tbody");
  for (const [category, value] of Object.entries(items.byCategory)) {
    const row = document.createElement("tr");
    const name = document.createElement("td");
    name.textContent = category.startsWith("public-") ? `public · ${category.slice(7)}` : category;
    const pass = document.createElement("td");
    pass.textContent = `${value.passed}/${value.total}`;
    const rate = document.createElement("td");
    rate.textContent = `${value.rate}%`;
    const ci = document.createElement("td");
    ci.textContent = value.ci95 ? `${value.ci95.low}-${value.ci95.high}%` : "—";
    row.append(name, pass, rate, ci);
    tbody.appendChild(row);
  }
  table.append(thead, tbody);
  section.append(heading, table);
  return section;
}

function renderBenchmarkReport(data) {
  els.benchmarkPhases.replaceChildren();
  if (!data.available) {
    const empty = document.createElement("p");
    empty.className = "benchmark-empty";
    empty.textContent =
      "No benchmark results yet. Use Start above (model phase first), or run npm run bench:model and npm run bench:chat in a terminal.";
    els.benchmarkPhases.appendChild(empty);
    return;
  }
  for (const phase of data.phases) {
    const card = document.createElement("section");
    card.className = "benchmark-card";
    const head = document.createElement("div");
    head.className = "benchmark-head";
    const title = document.createElement("div");
    const eyebrow = document.createElement("p");
    eyebrow.className = "eyebrow";
    eyebrow.textContent = `Suite v${phase.suiteVersion} · ${phase.testHash}`;
    const heading = document.createElement("h3");
    heading.textContent = phase.phase === "single"
      ? `${phaseTitle(phase.phase)}${phase.label ? ` · ${phase.label}` : ""}`
      : phaseTitle(phase.phase);
    title.append(eyebrow, heading);
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = `${phase.checksPassed}/${phase.checksTotal}`;
    head.append(title, badge);

    const metrics = document.createElement("div");
    metrics.className = "benchmark-metrics";
    metrics.append(
      benchmarkMetric("quality", `${Number(phase.quality).toFixed(1)}%`),
      ...(phase.items
        ? [benchmarkMetric("items passed", `${phase.items.rate}%${phase.items.ci95 ? ` (95% CI ${phase.items.ci95.low}-${phase.items.ci95.high})` : ""}`)]
        : []),
      benchmarkMetric("speed", `${Number(phase.tokensPerSecond).toFixed(1)} tok/s`),
      benchmarkMetric("runtime", `${(Number(phase.runtimeMs) / 1000).toFixed(1)}s`),
      benchmarkMetric("first token", `${Number(phase.firstTokenMs)} ms`),
      ...(phase.items?.byOrigin?.own
        ? [benchmarkMetric("own questions", `${phase.items.byOrigin.own.rate}% (${phase.items.byOrigin.own.passed}/${phase.items.byOrigin.own.total})`)]
        : []),
      ...(phase.items?.byOrigin?.public
        ? [benchmarkMetric("public benchmarks", `${phase.items.byOrigin.public.rate}% (${phase.items.byOrigin.public.passed}/${phase.items.byOrigin.public.total})`)]
        : []),
    );

    const table = document.createElement("table");
    table.className = "benchmark-table";
    const headRow = document.createElement("tr");
    for (const label of ["Test", "Dataset", "Group", "Pass", "%"]) {
      const th = document.createElement("th");
      th.textContent = label;
      headRow.appendChild(th);
    }
    const thead = document.createElement("thead");
    thead.appendChild(headRow);
    const tbody = document.createElement("tbody");
    if (!phase.tests.length) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 5;
      cell.textContent = "No per-test data";
      row.appendChild(cell);
      tbody.appendChild(row);
    }
    for (const test of phase.tests) {
      const row = document.createElement("tr");
      const name = document.createElement("td");
      name.textContent = test.label;
      const dataset = document.createElement("td");
      dataset.textContent = test.dataset ?? "own";
      const group = document.createElement("td");
      group.textContent = test.origin === "public" ? "public" : "own";
      const pass = document.createElement("td");
      pass.textContent = `${test.passed}/${test.total}`;
      const percent = document.createElement("td");
      percent.textContent = `${Number(test.percent).toFixed(1)}%`;
      row.append(name, dataset, group, pass, percent);
      tbody.appendChild(row);
    }
    table.append(thead, tbody);

    const commit = document.createElement("p");
    commit.className = "benchmark-commit";
    commit.textContent = phase.commit?.hash
      ? `Commit ${phase.commit.hash}${phase.commit.subject ? ` · ${phase.commit.subject}` : ""}`
      : "Not linked to a commit yet";
    const types = renderCategoryTable(phase.items);
    const datasets = renderDatasetTable(phase.items);
    card.append(head, metrics, ...(types ? [types] : []), ...(datasets ? [datasets] : []), table, commit);
    els.benchmarkPhases.appendChild(card);
  }

  if (data.history?.length) {
    const section = document.createElement("section");
    section.className = "benchmark-history";
    const heading = document.createElement("h3");
    heading.textContent = "Recent runs";
    const table = document.createElement("table");
    table.className = "benchmark-table";
    const headRow = document.createElement("tr");
    for (const label of ["When", "Phase", "Quality", "Speed", "Runtime", "Commit"]) {
      const th = document.createElement("th");
      th.textContent = label;
      headRow.appendChild(th);
    }
    const thead = document.createElement("thead");
    thead.appendChild(headRow);
    const tbody = document.createElement("tbody");
    for (const run of data.history) {
      const row = document.createElement("tr");
      const when = document.createElement("td");
      when.textContent = run.recordedAt ? new Date(run.recordedAt).toLocaleString() : "—";
      const phase = document.createElement("td");
      phase.textContent = phaseTitle(run.phase);
      const quality = document.createElement("td");
      quality.textContent = `${Number(run.quality).toFixed(1)}%`;
      const speed = document.createElement("td");
      speed.textContent = `${Number(run.tokensPerSecond).toFixed(1)} tok/s`;
      const runtime = document.createElement("td");
      runtime.textContent = `${(Number(run.runtimeMs) / 1000).toFixed(1)}s`;
      const commit = document.createElement("td");
      commit.textContent = run.commit?.hash ?? "—";
      row.append(when, phase, quality, speed, runtime, commit);
      tbody.appendChild(row);
    }
    table.append(thead, tbody);
    section.append(heading, table);
    els.benchmarkPhases.appendChild(section);
  }
}

const RECOMMENDATION_TITLES = {
  quality: "Best quality",
  overall: "Best overall",
  coding: "Best coding",
  speed: "Fastest within budget",
  "speed-tuning": "Speed tuning",
};
const SETTING_LABELS = {
  kvCache: "KV cache",
  contextSize: "Context",
  batchSize: "Batch",
  threads: "Threads",
  maxThreads: "Thread pool",
  sequences: "Sequences",
  flashAttention: "Flash attention",
  useMmap: "Memory map",
  gpuLayers: "GPU layers",
  gpuBackend: "GPU backend",
  checkpoints: "Checkpoints",
  checkpointInterval: "Checkpoint interval",
  checkpointMax: "Max checkpoints",
};

function settingChips(settings) {
  const chips = document.createElement("div");
  chips.className = "benchmark-chips";
  const entries = Object.entries(settings ?? {});
  if (!entries.length) {
    const chip = document.createElement("span");
    chip.className = "benchmark-chip";
    chip.textContent = "already optimal";
    chips.appendChild(chip);
    return chips;
  }
  for (const [key, value] of entries) {
    const chip = document.createElement("span");
    chip.className = "benchmark-chip";
    chip.textContent = `${SETTING_LABELS[key] ?? key} ${typeof value === "boolean" ? (value ? "on" : "off") : value}`;
    chips.appendChild(chip);
  }
  return chips;
}

function fillSettingsFromAdvice(item) {
  openSettings();
  applySettingsToForm(item.settings);
  const title = RECOMMENDATION_TITLES[item.kind] ?? item.kind;
  els.settingsNote.textContent =
    `${title} settings from the benchmark were loaded into the form. ` +
    "Review them, save, then reload the model to apply the reload-time values.";
}

function recommendationCard(item) {
  const card = document.createElement("article");
  card.className = "benchmark-advice-card";
  const eyebrow = document.createElement("p");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = RECOMMENDATION_TITLES[item.kind] ?? item.kind;
  const title = document.createElement("h4");
  title.textContent = item.label ?? item.fileName ?? item.variantId;
  const stats = document.createElement("p");
  stats.className = "benchmark-advice-stats";
  const parts = [];
  if (Number.isFinite(Number(item.rate))) parts.push(`${Number(item.rate).toFixed(1)}% items`);
  if (Number.isFinite(Number(item.tokensPerSecond))) parts.push(`${Number(item.tokensPerSecond).toFixed(1)} tok/s`);
  if (Number.isFinite(Number(item.baseTokensPerSecond))) parts.push(`base ${Number(item.baseTokensPerSecond).toFixed(1)} tok/s`);
  if (item.codingRate !== null && item.codingRate !== undefined) parts.push(`${item.codingRate}% coding`);
  stats.textContent = parts.join(" · ");
  const why = document.createElement("p");
  why.className = "benchmark-advice-why";
  why.textContent = item.why;
  const measured = document.createElement("p");
  measured.className = "benchmark-commit";
  measured.textContent = item.fileName ? `Measured on ${item.fileName}` : "";
  const actions = document.createElement("div");
  actions.className = "benchmark-advice-actions";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "small-btn";
  button.textContent = "Fill settings";
  button.addEventListener("click", () => fillSettingsFromAdvice(item));
  actions.appendChild(button);
  if (item.kind !== "speed-tuning") {
    const use = document.createElement("button");
    use.type = "button";
    use.className = "small-btn";
    use.dataset.chatBase = item.variantId;
    use.textContent = "Use for chat";
    use.addEventListener("click", () => selectChatBaseForChat(item));
    actions.appendChild(use);
  }
  card.append(eyebrow, title, stats, settingChips(item.settings), why, measured, actions);
  return card;
}

function markChatBaseButtons() {
  document.querySelectorAll("[data-chat-base]").forEach((button) => {
    const selected = state.chatBase?.variantId === button.dataset.chatBase;
    button.textContent = selected ? "Selected for chat" : "Use for chat";
    button.disabled = selected;
  });
}

function renderChatBase(chatBase) {
  if (!els.benchmarkChatBase) return;
  els.benchmarkChatBase.textContent = chatBase
    ? `Chat phase base: ${chatBase.label} · ${chatBase.fileName ?? chatBase.catalogId}` +
      `${chatBase.selectedAt ? ` · selected ${new Date(chatBase.selectedAt).toLocaleString()}` : ""}`
    : "Chat phase base: default Qwen2.5 0.5B Q4. Choose a recommendation card to run the chat phase on a measured configuration.";
}

async function selectChatBaseForChat(item) {
  try {
    const { chatBase } = await request("/api/benchmarks/base", {
      method: "POST",
      body: { variantId: item.variantId },
    });
    state.chatBase = chatBase;
    renderChatBase(chatBase);
    markChatBaseButtons();
    els.benchmarkPhase.value = "chat";
    showToast("Chat phase base selected", {
      message: `${chatBase.label}. Start the chat phase whenever you are ready.`,
      kind: "success",
      timeout: 7000,
    });
  } catch (error) {
    showError(error);
  }
}

function renderRecommendations(advice, headerTitle = "Recommended configurations") {
  if (!els.benchmarkRecommendations) return;
  els.benchmarkRecommendations.replaceChildren();
  if (!advice?.available) {
    const empty = document.createElement("p");
    empty.className = "benchmark-empty";
    empty.textContent =
      "No configuration advice yet. Run the model phase, or pick a single model to sweep its settings.";
    els.benchmarkRecommendations.appendChild(empty);
    return;
  }
  const section = document.createElement("section");
  section.className = "benchmark-advice";
  const heading = document.createElement("div");
  heading.className = "benchmark-head";
  const title = document.createElement("div");
  const eyebrow = document.createElement("p");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = `Suite v${advice.suiteVersion ?? "?"}${advice.createdAt ? ` · ${new Date(advice.createdAt).toLocaleString()}` : ""}`;
  const name = document.createElement("h3");
  name.textContent = headerTitle;
  title.append(eyebrow, name);
  heading.appendChild(title);
  const grid = document.createElement("div");
  grid.className = "benchmark-advice-grid";
  for (const item of advice.items) grid.appendChild(recommendationCard(item));
  if (advice.speedTuning) {
    grid.appendChild(recommendationCard({ ...advice.speedTuning, kind: "speed-tuning", why: advice.speedTuning.why }));
  }
  section.append(heading, grid);
  els.benchmarkRecommendations.appendChild(section);
  markChatBaseButtons();
}

function stopBenchmarkPolling() {
  if (state.benchmarkTimer) clearInterval(state.benchmarkTimer);
  state.benchmarkTimer = null;
}

function startBenchmarkPolling() {
  if (state.benchmarkTimer) return;
  state.benchmarkTimer = setInterval(() => void pollBenchmark(), 1500);
}

async function pollBenchmark() {
  if (!els.benchmarkDialog.open) {
    stopBenchmarkPolling();
    return;
  }
  try {
    const { job } = await request("/api/benchmarks/status");
    const previous = state.benchmarkJob;
    state.benchmarkJob = job ?? null;
    renderBenchmarkJob(job ?? null);
    if (previous?.status === "running" && job && job.status !== "running") {
      stopBenchmarkPolling();
      if (job.status === "complete") {
        const quality = Number(job.progress?.quality);
        const gateFailed = job.progress?.gate === "fail";
        showToast(`Benchmark finished${Number.isFinite(quality) ? `: ${quality.toFixed(1)}%` : ""}`, {
          message: gateFailed
            ? "The paired item gate failed; do not accept this change without an ADR."
            : job.progress?.baselineUpdated
              ? "The baseline was replaced."
              : "Results are in the report below.",
          kind: gateFailed ? "error" : "success",
          timeout: 7000,
        });
      } else if (job.status === "failed") {
        showError(Object.assign(new Error(job.error?.message ?? "The benchmark failed"), { info: job.error }));
      }
      const report = await request("/api/benchmarks").catch(() => null);
      if (report) {
        renderBenchmarkReport(report);
        state.chatBase = report.chatBase ?? state.chatBase;
        renderChatBase(state.chatBase);
        renderRecommendations(report.recommendations, report.recommendationsTitle);
      }
    }
  } catch {
    stopBenchmarkPolling();
  }
}

function renderBenchmarkJob(job) {
  const running = job?.status === "running";
  els.benchmarkStart.disabled = running;
  els.benchmarkCancel.disabled = !running;
  els.benchmarkRunState.textContent = job ? job.status : "idle";
  els.benchmarkRunState.className = "badge";
  if (!job) {
    els.benchmarkProgress.textContent = "No benchmark is running.";
    stopBenchmarkPolling();
    return;
  }
  const progress = job.progress ?? {};
  if (running) {
    let line = "Starting…";
    if (progress.type === "prompt") {
      line = `${phaseTitle(job.phase)} · variant ${progress.variantIndex}/${progress.variantsTotal} · item ${progress.index}/${progress.total}: ${progress.label}`;
    } else if (progress.type === "variant") {
      line = `${phaseTitle(job.phase)} · variant ${progress.index}/${progress.total}: ${progress.label}`;
    } else if (progress.type === "benchmark") {
      line = `${phaseTitle(job.phase)} · suite v${progress.suiteVersion} · ${progress.variants} variants`;
    }
    const started = job.startedAt ? Math.max(0, Date.now() - new Date(job.startedAt).getTime()) : 0;
    els.benchmarkProgress.textContent = `${line} · ${Math.floor(started / 60000)}m ${Math.floor((started % 60000) / 1000)}s`;
    startBenchmarkPolling();
  } else if (job.status === "complete") {
    const quality = Number(progress.quality);
    els.benchmarkProgress.textContent =
      `Finished: ${Number.isFinite(quality) ? `${quality.toFixed(1)}% quality` : "complete"}` +
      `${progress.itemsRate !== undefined ? ` · ${progress.itemsRate}% items` : ""}` +
      `${progress.tokensPerSecond !== undefined ? ` · ${Number(progress.tokensPerSecond).toFixed(1)} tok/s` : ""}` +
      `${progress.baselineUpdated ? " · baseline replaced" : ""}` +
      `${progress.gate === "fail" ? " · quality gate failed" : ""}`;
    stopBenchmarkPolling();
  } else if (job.status === "cancelled") {
    els.benchmarkProgress.textContent = "Cancelled. No baseline was changed.";
    stopBenchmarkPolling();
  } else {
    els.benchmarkProgress.textContent = job.error?.message ?? "The benchmark failed.";
    stopBenchmarkPolling();
  }
}

async function startBenchmark() {
  els.benchmarkStart.disabled = true;
  try {
    const { job } = await request("/api/benchmarks/run", {
      method: "POST",
      body: {
        phase: els.benchmarkPhase.value,
        updateBaseline: els.benchmarkBaseline.checked,
        download: els.benchmarkDownload.checked,
        fullMatrix: els.benchmarkPhase.value === "model" && els.benchmarkFull.checked,
        model: els.benchmarkPhase.value === "model" && els.benchmarkModel.value
          ? els.benchmarkModel.value
          : null,
      },
    });
    state.benchmarkJob = job;
    renderBenchmarkJob(job);
    startBenchmarkPolling();
  } catch (error) {
    els.benchmarkStart.disabled = false;
    showError(error);
    const status = await request("/api/benchmarks/status").catch(() => null);
    if (status) {
      state.benchmarkJob = status.job ?? null;
      renderBenchmarkJob(status.job ?? null);
    }
  }
}

async function cancelBenchmark() {
  els.benchmarkCancel.disabled = true;
  try {
    const { job } = await request("/api/benchmarks/cancel", { method: "POST" });
    state.benchmarkJob = job;
    renderBenchmarkJob(job);
  } catch (error) {
    els.benchmarkCancel.disabled = false;
    showError(error);
  }
}

function populateBenchmarkModels(models) {
  if (!els.benchmarkModel || !Array.isArray(models)) return;
  const previous = els.benchmarkModel.value;
  while (els.benchmarkModel.options.length > 1) els.benchmarkModel.remove(1);
  for (const model of models) {
    const option = document.createElement("option");
    option.value = model.catalogId;
    option.textContent = `${model.label} · ${model.kind}`;
    els.benchmarkModel.appendChild(option);
  }
  if ([...els.benchmarkModel.options].some((option) => option.value === previous)) {
    els.benchmarkModel.value = previous;
  }
}

const TUNE_TASKS = ["chat", "code", "math", "recall"];

function tuneStageLine(stages) {
  if (!stages) return "not tuned";
  const perTask = (entry) => `${TUNE_TASKS.filter((task) => entry?.[task] === "done").length}/${TUNE_TASKS.length}`;
  const mark = (status) => (status === "done" ? "✓" : status === "partial" ? "…" : "–");
  return `device ${mark(stages.device)} · quality ${mark(stages.quality)} · speed ${mark(stages.speed)} · sampling ${perTask(stages.sampling)} · prompt ${perTask(stages.prompt)}`;
}

function tuneCell(text, title = "") {
  const cell = document.createElement("td");
  cell.textContent = text;
  if (title) cell.title = title;
  return cell;
}

function renderTuneModels() {
  const models = state.tuneOverview ?? [];
  const items = new Map((state.tuneJob?.items ?? []).map((item) => [item.profileId, item]));
  els.tuneModels.replaceChildren();
  if (!models.length) {
    const empty = document.createElement("p");
    empty.className = "benchmark-empty";
    empty.textContent = "Install a model to tune it.";
    els.tuneModels.appendChild(empty);
    return;
  }
  const table = document.createElement("table");
  table.className = "benchmark-table";
  const head = table.createTHead().insertRow();
  for (const label of ["Model", "Device", "Stages", "Speed presets", "Task presets", ""]) {
    head.appendChild(Object.assign(document.createElement("th"), { textContent: label }));
  }
  const body = table.createTBody();
  const running = state.tuneJob?.status === "running";
  // Several quantisations of one model share a name; show their file names then.
  const repeated = new Set(models.map((model) => model.name).filter((name, index, names) => names.indexOf(name) !== index));
  for (const model of models) {
    const profile = model.profile;
    const row = body.insertRow();
    const item = items.get(model.profileId);
    const step = item?.progress?.stage ? ` · ${item.progress.stage}${item.progress.axis ? `: ${item.progress.axis}` : ""}` : "";
    const live = item && running ? ` — ${item.status}${item.lane ? ` in the ${item.lane.toUpperCase()} lane` : ""}${step}` : "";
    const label = repeated.has(model.name) ? `${model.name} (${model.fileName})` : model.name;
    row.appendChild(tuneCell(`${label}${live}`, model.fileName));
    const device = profile?.device?.settings;
    row.appendChild(tuneCell(device ? (device.gpuBackend === "cpu" ? "CPU" : `${device.gpuBackend} GPU`) : "–", profile?.device?.reason ?? ""));
    row.appendChild(tuneCell(tuneStageLine(profile?.stages), model.warnings.join("\n")));
    const speed = profile?.speed;
    row.appendChild(tuneCell(speed ? `Fastest ${speed.fastest?.threads ?? "–"} threads · Light ${speed.light?.threads ?? "–"}` : "–"));
    const tasks = Object.entries(profile?.tasks ?? {});
    const settingsText = tasks.map(([task, preset]) => `${task}: ${Object.entries(preset.settings).map(([key, value]) => `${key}=${value}`).join(", ")}`).join("\n");
    row.appendChild(tuneCell(tasks.map(([task, preset]) => (preset.stats ? `${task} ${preset.stats.rate}%` : `${task} …`)).join(" · ") || "–", settingsText));
    const action = document.createElement("td");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "small-btn";
    button.dataset.tuneModel = model.id;
    // An out-of-date profile can only be re-tuned from scratch.
    if (model.warnings.length) button.dataset.tuneForce = "true";
    button.disabled = running;
    const stages = profile?.stages ?? {};
    const complete = ["device", "quality", "speed"].every((stage) => stages[stage] === "done") &&
      TUNE_TASKS.every((task) => stages.sampling?.[task] === "done" && stages.prompt?.[task] === "done");
    button.textContent = model.warnings.length ? "Re-tune ⚠" : complete ? "Tuned ✓" : profile ? "Continue" : "Tune";
    if (model.warnings.length) button.title = model.warnings.join("\n");
    // A finished tune is skipped unless asked again, so say how.
    else if (complete) button.title = "Fully tuned. Tick Re-tune from scratch, or choose settings above, to run it again.";
    action.appendChild(button);
    row.appendChild(action);
  }
  els.tuneModels.appendChild(table);
}

function renderTuneJob() {
  const job = state.tuneJob;
  const running = job?.status === "running";
  els.tuneAll.disabled = running;
  els.tuneCancel.disabled = !running;
  els.tuneRunState.textContent = job ? job.status : "idle";
  els.tuneRunState.className = running ? "badge accent" : job?.status === "complete" ? "badge green" : "badge";
  if (job) {
    const count = (status) => job.items.filter((item) => item.status === status).length;
    const failed = job.items.filter((item) => item.status === "failed").map((item) => `${item.name}: ${item.error}`);
    els.tuneProgress.textContent = `${count("done") + count("skipped")} of ${job.items.length} models finished · ${count("running")} running · ${count("queued")} waiting${failed.length ? ` · failed: ${failed.join("; ")}` : ""}`;
  }
  renderTuneModels();
}

function stopTunePolling() {
  clearInterval(state.tuneTimer);
  state.tuneTimer = null;
}

function startTunePolling() {
  if (!state.tuneTimer) state.tuneTimer = setInterval(() => void pollTune(), 2000);
}

async function loadTuneOverview() {
  const [overview, status] = await Promise.all([request("/api/tune/overview"), request("/api/tune/status").catch(() => ({ job: null }))]);
  state.tuneOverview = overview.models ?? [];
  state.tuneJob = status.job ?? null;
  renderTuneJob();
  if (state.tuneJob?.status === "running") startTunePolling();
}

async function pollTune() {
  if (!els.benchmarkDialog.open) {
    stopTunePolling();
    return;
  }
  try {
    const { job } = await request("/api/tune/status");
    state.tuneJob = job ?? null;
    if (job?.status === "running") {
      renderTuneJob();
      return;
    }
    stopTunePolling();
    await loadTuneOverview();
    if (job?.status === "complete") showToast("Tuning finished", { message: "Tuned settings apply the next time each model loads.", kind: "success" });
  } catch (error) {
    stopTunePolling();
    showError(error);
  }
}

async function startTune(models, { force = false, forceStale = false } = {}) {
  const settings = [...els.tuneOnly.querySelectorAll("input:checked")].map((input) => input.value);
  // Chosen settings run wherever they belong, so they override the stage boxes.
  const stages = settings.length
    ? [...els.tuneStages.querySelectorAll("input[value]")].map((input) => input.value).filter((value) => value !== "on")
    : [...els.tuneStages.querySelectorAll("input[value]:checked")].map((input) => input.value);
  if (!stages.length) {
    showToast("Choose at least one stage", { kind: "error" });
    return;
  }
  try {
    const { job } = await request("/api/tune/start", { method: "POST", body: { models, stages, settings: settings.length ? settings : null, force: force || els.tuneForce.checked, forceStale } });
    state.tuneJob = job;
    renderTuneJob();
    startTunePolling();
  } catch (error) {
    showError(error);
  }
}

async function cancelTune() {
  try {
    const { job } = await request("/api/tune/cancel", { method: "POST" });
    state.tuneJob = job;
    renderTuneJob();
  } catch (error) {
    showError(error);
  }
}

// Every editable tune setting: [path in the steps object, label, kind].
const TUNE_STEP_FIELDS = [
  ["Stage 0 · device", [["device.backends", "Devices to probe (cpu is always the reference)"]]],
  ["Lanes on this PC", [["lanes.cpu", "CPU lanes (1-4)", "number"], ["lanes.gpu", "GPU lanes (0-4; 0 = GPU models wait for the CPU lane)", "number"]]],
  ["Stage 1 · quality", [["load.contextSize", "Context sizes"], ["load.kvCache", "KV cache types"]]],
  ["Stage 2 · speed", [
    ["load.flashAttention", "Flash attention"], ["load.useMmap", "mmap"], ["load.batchSize", "Batch sizes"],
    ["load.threads", "Threads (capped at three quarters of this PC's threads)"],
    ["load.checkpointing.enabled", "Tune checkpointing (hybrid or sliding-window models only)", "checkbox"],
    ["load.checkpointing.interval", "Checkpoint intervals"], ["load.checkpointing.max", "Checkpoints kept"],
  ]],
  ["Stage 3 · sampling, per task", [
    ["sampling.temperature", "Temperature"], ["sampling.maxTokens.chat", "Token budgets · chat"],
    ["sampling.maxTokens.code", "Token budgets · code"], ["sampling.maxTokens.math", "Token budgets · math"],
    ["sampling.maxTokens.recall", "Token budgets · long context"], ["sampling.repeatPenalty", "Repeat penalty"],
    ["sampling.minP", "Min-p"], ["sampling.topP", "Top-p"], ["sampling.topK", "Top-k (0 = off)"],
  ]],
  ["Stage 4 · prompt, per task", [
    ["prompt.systemPrompt", "System prompts, one per line (the first is the reference)", "lines"],
    ["prompt.reasoning", "Reasoning"], ["prompt.promptRepeat", "Prompt repeats"],
  ]],
];

const stepAt = (steps, key) => key.split(".").reduce((value, part) => value?.[part], steps);

function setStep(steps, key, value) {
  const parts = key.split(".");
  const last = parts.pop();
  const parent = parts.reduce((object, part) => (object[part] ??= {}), steps);
  parent[last] = value;
}

function parseStepText(text) {
  return String(text).split(/[\s,]+/).filter(Boolean).map((part) => (/^-?\d+(\.\d+)?$/.test(part) ? Number(part) : part));
}

function renderTuneSettings(steps) {
  els.tuneSettingsForm.replaceChildren();
  for (const [title, fields] of TUNE_STEP_FIELDS) {
    const group = document.createElement("fieldset");
    group.className = "tune-settings-group";
    group.appendChild(Object.assign(document.createElement("legend"), { textContent: title }));
    for (const [key, label, kind = "list"] of fields) {
      const field = document.createElement("label");
      field.className = kind === "checkbox" ? "check" : "field";
      const value = stepAt(steps, key);
      let input;
      if (kind === "lines") {
        input = Object.assign(document.createElement("textarea"), { rows: 6, wrap: "off", value: (value ?? []).join("\n") });
      } else {
        input = Object.assign(document.createElement("input"), { type: kind === "list" ? "text" : kind });
        if (kind === "checkbox") input.checked = Boolean(value);
        else input.value = Array.isArray(value) ? value.join(", ") : value ?? "";
      }
      input.dataset.stepKey = key;
      input.dataset.stepKind = kind;
      const caption = Object.assign(document.createElement("span"), { textContent: label });
      if (kind === "checkbox") field.append(input, caption);
      else field.append(caption, input);
      group.appendChild(field);
    }
    els.tuneSettingsForm.appendChild(group);
  }
}

function readTuneSettings() {
  const steps = {};
  for (const input of els.tuneSettingsForm.querySelectorAll("[data-step-key]")) {
    const kind = input.dataset.stepKind;
    const value = kind === "checkbox" ? input.checked
      : kind === "number" ? Number(input.value)
      : kind === "lines" ? input.value.split("\n").map((line) => line.trim()).filter(Boolean)
      : parseStepText(input.value);
    setStep(steps, input.dataset.stepKey, value);
  }
  return steps;
}

function describeTuneEstimate(data) {
  const estimate = data.estimate;
  const perTask = (entries) => Math.max(0, ...Object.values(entries ?? {}).map((entry) => entry.configs));
  const hours = (seconds) => (seconds / 3600).toFixed(1);
  const problems = data.problems?.length ? ` Dropped: ${data.problems.join("; ")}.` : "";
  return `Per pass: device ${estimate.device.configs} · quality ${estimate.quality.configs} · speed ${estimate.speed.configs} · sampling ${perTask(estimate.sampling)} and prompt ${perTask(estimate.prompt)} per task. ` +
    `At about 3 s per answer (a small model on the CPU) one pass is up to ${hours(estimate.onePassSeconds)} h; GPU models are several times faster.${problems}`;
}

function renderTuneOnly(names) {
  if (els.tuneOnly.querySelector("input")) return;
  for (const name of names) {
    const option = document.createElement("label");
    option.className = "check";
    const box = Object.assign(document.createElement("input"), { type: "checkbox", value: name });
    option.append(box, Object.assign(document.createElement("span"), { textContent: name }));
    els.tuneOnly.appendChild(option);
  }
}

async function loadTuneSettings() {
  const data = await request("/api/tune/steps");
  renderTuneOnly(data.settingNames ?? []);
  state.tuneDefaults = data.defaults;
  renderTuneSettings(data.steps);
  els.tuneSettingsNote.textContent = `${data.custom ? "Your saved settings." : "Built-in defaults."} ${describeTuneEstimate(data)}`;
}

async function saveTuneSettings(steps) {
  try {
    const data = await request("/api/tune/steps", { method: "PUT", body: { steps } });
    renderTuneSettings(data.steps);
    els.tuneSettingsNote.textContent = `Saved. ${describeTuneEstimate(data)}`;
    showToast("Tune settings saved", { message: "The next tune uses them.", kind: data.problems?.length ? "info" : "success" });
  } catch (error) {
    showError(error);
  }
}

async function openBenchmarks() {
  if (!els.benchmarkDialog.open) els.benchmarkDialog.showModal();
  els.benchmarkPhases.replaceChildren();
  const loading = document.createElement("p");
  loading.className = "benchmark-empty";
  loading.textContent = "Loading benchmark report…";
  els.benchmarkPhases.appendChild(loading);
  try {
    const [report, status] = await Promise.all([
      request("/api/benchmarks"),
      request("/api/benchmarks/status").catch(() => ({ job: null })),
    ]);
    renderBenchmarkReport(report);
    populateBenchmarkModels(report.models);
    state.chatBase = report.chatBase ?? state.chatBase;
    renderChatBase(state.chatBase);
    renderRecommendations(report.recommendations, report.recommendationsTitle);
    state.benchmarkJob = status.job ?? null;
    renderBenchmarkJob(status.job ?? null);
    await loadTuneOverview().catch(showError);
    await loadTuneSettings().catch(showError);
  } catch (error) {
    els.benchmarkPhases.replaceChildren();
    const failed = document.createElement("p");
    failed.className = "benchmark-empty";
    failed.textContent = "The benchmark report could not be loaded.";
    els.benchmarkPhases.appendChild(failed);
    showError(error);
  }
}

async function saveServerSettings(event) {
  event.preventDefault();
  const payload = {
    port: Number(els.serverPort.value),
    requireAuth: els.serverAuth.checked,
    serveOnLocalNetwork: els.serverLan.checked,
    allowPerRequestMcps: els.serverMcpRequest.checked,
    allowCallingServersFromMcpJson: els.serverMcpJson.checked,
    enableCors: els.serverCors.checked,
    justInTimeModelLoading: els.serverJit.checked,
    autoUnloadUnusedJit: els.serverJitAuto.checked,
    maxIdleTtlMinutes: Number(els.serverTtl.value),
    onlyKeepLastJitLoadedModel: els.serverJitLast.checked,
  };
  const previous = state.serverSettings;
  try {
    const data = await request("/api/server-settings", { method: "PUT", body: { settings: payload } });
    state.serverSettings = { ...data.settings, apiKeys: data.apiKeys, activeKeys: data.activeKeys };
    els.serverDialog.close();
    showToast("Server settings saved", { message: "Restart ModelDuck to apply port or local-network changes." });
    if (
      previous &&
      (previous.port !== data.settings.port || previous.serveOnLocalNetwork !== data.settings.serveOnLocalNetwork)
    ) {
      showToast("Restart required", {
        message: "The listener port or network binding changes only after a restart.",
        fix: "Stop the terminal with Ctrl+C, then run start.bat again.",
      });
    }
  } catch (error) {
    showError(error);
  }
}

async function createServerKey() {
  const label = els.serverKeyLabel.value.trim() || "API key";
  els.serverKeyCreate.disabled = true;
  try {
    const data = await request("/api/server-settings/api-keys", {
      method: "POST",
      body: { label },
    });
    els.serverKeyValue.textContent = data.key;
    els.serverKeyOutput.hidden = false;
    els.serverKeyLabel.value = "";
    await openServerSettings();
    showToast("API key created", {
      message: "Copy it now; the full key is not shown again.",
      fix: "Use Authorization: Bearer <key> or X-API-Key.",
    });
  } catch (error) {
    showError(error);
  } finally {
    els.serverKeyCreate.disabled = false;
  }
}

async function revokeServerKey(key) {
  const confirmed = await askConfirm(
    "Revoke this API key?",
    `${key.label} (${key.prefix}…) will stop working immediately.`,
    "Revoke key",
  );
  if (!confirmed) return;
  try {
    await request(`/api/server-settings/api-keys/${encodeURIComponent(key.id)}`, { method: "DELETE" });
    await openServerSettings();
    showToast("API key revoked");
  } catch (error) {
    showError(error);
  }
}

function updateSettingsOutputs() {
  els.tempOut.textContent = Number(els.settingTemp.value).toFixed(2);
  els.toppOut.textContent = Number(els.settingTopp.value).toFixed(2);
}

async function saveSettings(event) {
  event.preventDefault();
  const payload = {
    systemPrompt: els.settingSystem.value,
    useTunedProfile: els.settingTuned.checked,
    speedPreset: els.settingSpeedPreset.value,
    temperature: Number(els.settingTemp.value),
    topP: Number(els.settingTopp.value),
    topK: Number(els.settingTopk.value),
    minP: Number(els.settingMinp.value),
    repeatPenalty: Number(els.settingRepeat.value),
    reasoning: els.settingReasoning.value,
    contextOverflow: els.settingOverflow.value,
    structuredOutput: els.settingStructured.value,
    jsonSchema: els.settingSchema.value,
    promptRepeat: Number(els.settingRepeatPrompt.value),
    maxTokens: Number(els.settingMax.value), // aikit:allow-secret token limit
    contextSize: Number(els.settingContext.value),
    threads: Number(els.settingThreads.value),
    maxThreads: Number(els.settingMaxThreads.value),
    batchSize: Number(els.settingBatch.value),
    sequences: Number(els.settingSequences.value),
    flashAttention: els.settingFlash.value,
    useMmap: els.settingMmap.value,
    gpuLayers: Number(els.settingGpuLayers.value),
    gpuBackend: els.settingGpuBackend.value,
    checkpoints: els.settingCheckpoints.value === "true",
    checkpointInterval: Number(els.settingCheckpointInterval.value),
    checkpointMax: Number(els.settingCheckpointMax.value),
    kvCache: els.settingKv.value,
  };
  const previous = state.settings;
  try {
    const data = await request("/api/settings", { method: "PUT", body: { settings: payload } });
    state.settings = data.settings;
    els.settingsDialog.close();
    showToast("Settings saved");
    if (
      state.loaded.status === "ready" &&
      previous &&
      (previous.contextSize !== data.settings.contextSize ||
        previous.threads !== data.settings.threads ||
        previous.kvCache !== data.settings.kvCache ||
        previous.batchSize !== data.settings.batchSize ||
        previous.sequences !== data.settings.sequences ||
        previous.flashAttention !== data.settings.flashAttention ||
        previous.useMmap !== data.settings.useMmap ||
        previous.checkpoints !== data.settings.checkpoints ||
        previous.gpuLayers !== data.settings.gpuLayers)
    ) {
      showToast("Reload to apply", {
        message: "Context, threads, batching, attention, mmap, checkpoints and KV cache change the next time a model is loaded.",
        fix: "Open Models → Installed → Load.",
      });
    }
  } catch (error) {
    showError(error);
  }
}

/* Confirm ------------------------------------------------------------------ */

function askConfirm(title, message, confirmLabel = "Delete") {
  els.confirmTitle.textContent = title;
  els.confirmMessage.textContent = message;
  els.confirmOk.textContent = confirmLabel;
  if (!els.confirmDialog.open) els.confirmDialog.showModal();
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      els.confirmDialog.close();
      resolve(value);
    };
    els.confirmOk.onclick = () => finish(true);
    els.confirmCancel.onclick = () => finish(false);
    els.confirmDialog.onclose = () => {
      if (!settled) {
        settled = true;
        resolve(false);
      }
    };
  });
}

/* Sidebar / composer helpers ----------------------------------------------- */

function openSidebar() {
  els.sidebar.classList.add("open");
  els.scrim.hidden = false;
}

function closeSidebar() {
  els.sidebar.classList.remove("open");
  els.scrim.hidden = true;
}

function resizePrompt() {
  els.prompt.style.height = "auto";
  els.prompt.style.height = `${Math.min(els.prompt.scrollHeight, 200)}px`;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand("copy");
    area.remove();
    return copied;
  }
}

/* Events ------------------------------------------------------------------- */

function bindEvents() {
  $("new-chat").addEventListener("click", newChat);
  $("open-models").addEventListener("click", () => openModels("installed"));
  $("status-card").addEventListener("click", () => openModels("installed"));
  $("model-pill").addEventListener("click", () => openModels("installed"));
  $("open-settings").addEventListener("click", openSettings);
  $("top-settings").addEventListener("click", openSettings);
  $("open-server").addEventListener("click", openServerSettings);
  $("open-benchmarks").addEventListener("click", openBenchmarks);
  els.benchmarkStart.addEventListener("click", startBenchmark);
  els.benchmarkCancel.addEventListener("click", cancelBenchmark);
  els.tuneAll.addEventListener("click", () => void startTune("all", { forceStale: true }));
  els.tuneCancel.addEventListener("click", cancelTune);
  els.tuneSettingsSave.addEventListener("click", () => void saveTuneSettings(readTuneSettings()));
  els.tuneSettingsReset.addEventListener("click", () => {
    if (state.tuneDefaults) void saveTuneSettings(state.tuneDefaults);
  });
  els.tuneModels.addEventListener("click", (event) => {
    const button = event.target.closest("[data-tune-model]");
    if (button) void startTune([button.dataset.tuneModel], { force: button.dataset.tuneForce === "true" });
  });
  els.benchmarkModel.addEventListener("change", () => {
    const single = Boolean(els.benchmarkModel.value);
    if (single) els.benchmarkFull.checked = false;
    els.benchmarkFull.disabled = single;
  });
  els.benchmarkDialog.addEventListener("close", stopBenchmarkPolling);
  $("theme-toggle").addEventListener("click", () => {
    state.theme = state.theme === "dark" ? "light" : "dark";
    applyTheme();
  });
  $("menu-toggle").addEventListener("click", openSidebar);
  $("sidebar-close").addEventListener("click", closeSidebar);
  els.scrim.addEventListener("click", closeSidebar);
  $("sidebar").addEventListener("click", (event) => {
    const open = event.target.closest("[data-open-conversation]");
    if (open) {
      openConversation(open.dataset.openConversation);
      return;
    }
    const remove = event.target.closest("[data-delete-conversation]");
    if (remove) deleteConversation(remove.dataset.deleteConversation);
  });

  els.search.addEventListener("input", () => {
    state.search = els.search.value;
    renderSidebar();
  });

  els.composer.addEventListener("submit", (event) => {
    event.preventDefault();
    if (state.streaming) return;
    sendMessage(els.prompt.value);
  });

  els.prompt.addEventListener("input", () => {
    resizePrompt();
    renderComposer();
  });

  els.prompt.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      if (state.streaming) return;
      sendMessage(els.prompt.value);
    }
  });

  els.stopBtn.addEventListener("click", stopGeneration);

  els.messages.addEventListener("click", async (event) => {
    const codeCopy = event.target.closest(".code-copy");
    if (codeCopy) {
      const code = decodeURIComponent(codeCopy.dataset.copy || "");
      if (await copyText(code)) {
        const original = codeCopy.textContent;
        codeCopy.textContent = "Copied";
        setTimeout(() => {
          codeCopy.textContent = original;
        }, 1200);
      }
      return;
    }

    const copyButton = event.target.closest("[data-copy-message]");
    if (copyButton) {
      const message = state.conversation?.messages.find(
        (item) => item.id === copyButton.dataset.copyMessage,
      );
      if (message && (await copyText(message.content))) showToast("Copied to clipboard");
      return;
    }

    const regenerate = event.target.closest("[data-regenerate]");
    if (regenerate) {
      await regenerateLast();
      return;
    }
  });

  document.querySelectorAll("[data-close-dialog]").forEach((button) => {
    button.addEventListener("click", () => {
      document.getElementById(button.dataset.closeDialog)?.close();
    });
  });

  document.querySelectorAll(".tab").forEach((button) => {
    button.addEventListener("click", () => switchTab(button.dataset.tab));
  });

  els.modelsDialog.addEventListener("click", (event) => {
    const download = event.target.closest("[data-download]");
    if (download) {
      if (!download.disabled) startDownload(download.dataset.download, download);
      return;
    }
    const cancel = event.target.closest("[data-cancel-download]");
    if (cancel) {
      cancelDownload(cancel.dataset.cancelDownload);
      return;
    }
    const load = event.target.closest("[data-load]");
    if (load) {
      loadModel(load.dataset.load);
      return;
    }
    const unload = event.target.closest("[data-unload]");
    if (unload) {
      unloadModel();
      return;
    }
    const remove = event.target.closest("[data-delete-model]");
    if (remove) {
      deleteModel(remove.dataset.deleteModel);
      return;
    }
    if (event.target.closest("[data-open-discover]")) {
      switchTab("discover");
      return;
    }
    if (event.target.closest("[data-refresh-models]")) {
      refreshModels();
      refreshCatalog();
    }
  });

  els.modelsDialog.addEventListener("close", () => {
    if (!hasActiveDownloads()) stopDownloadPolling();
  });

  $("open-folder").addEventListener("click", openModelsFolder);
  $("refresh-models").addEventListener("click", () => {
    refreshModels();
    refreshCatalog();
  });
  els.importBtn.addEventListener("click", importModel);
  els.importPath.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      importModel();
    }
  });

  els.settingsForm.addEventListener("submit", saveSettings);
  // The task choice is a per-viewer convenience; storage can be unavailable.
  try {
    const savedTask = localStorage.getItem("modelduck.task");
    if ([...els.taskPicker.options].some((option) => option.value === savedTask)) els.taskPicker.value = savedTask;
  } catch {
    // Keep the default task.
  }
  els.taskPicker.addEventListener("change", () => {
    try {
      localStorage.setItem("modelduck.task", els.taskPicker.value);
    } catch {
      // Not remembered this time.
    }
  });
  els.settingTemp.addEventListener("input", updateSettingsOutputs);
  els.settingTopp.addEventListener("input", updateSettingsOutputs);

  els.serverForm.addEventListener("submit", saveServerSettings);
  els.serverKeyCreate.addEventListener("click", createServerKey);
  els.serverKeyOutput.addEventListener("click", async (event) => {
    if (!event.target.closest("[data-copy-key]")) return;
    if (await copyText(els.serverKeyValue.textContent || "")) showToast("API key copied");
  });

  document.addEventListener("keydown", (event) => {
    const modifier = event.ctrlKey || event.metaKey;
    if (modifier && event.key.toLowerCase() === "k") {
      event.preventDefault();
      newChat();
    }
    if (modifier && event.key === ",") {
      event.preventDefault();
      openSettings();
    }
    if (event.key === "Escape") {
      if (els.sidebar.classList.contains("open")) closeSidebar();
    }
  });

  window.addEventListener("beforeunload", () => state.fetchAbort?.abort());

  els.modelsDialog.addEventListener("click", (event) => {
    if (event.target === els.modelsDialog) els.modelsDialog.close();
  });
  els.settingsDialog.addEventListener("click", (event) => {
    if (event.target === els.settingsDialog) els.settingsDialog.close();
  });
  els.serverDialog.addEventListener("click", (event) => {
    if (event.target === els.serverDialog) els.serverDialog.close();
  });
}

/* Boot --------------------------------------------------------------------- */

async function boot() {
  applyTheme();
  bindEvents();
  resizePrompt();

  try {
    const data = await request("/api/state");
    state.app = data.app;
    state.settings = data.settings;
    state.modelsDir = data.modelsDir;
    state.models = data.models ?? [];
    state.catalog = data.catalog ?? [];
    state.downloads = data.downloads ?? [];
    state.conversations = data.conversations ?? [];
    state.archivedConversations = data.archivedConversations ?? [];
    state.presets = data.presets ?? [];
    state.serverSettings = data.serverSettings ?? null;
    state.loaded = data.loaded ?? { status: "idle", model: null };
  } catch (error) {
    showError(error);
    state.loaded = { status: "idle", model: null };
  }

  document.body.classList.add("ready");
  renderSidebar();
  renderHeader();
  renderStatus();
  renderComposer();
  renderChat();
  renderCatalog();
  renderInstalled();
  if (hasActiveDownloads()) startDownloadPolling();
  els.prompt.focus();
}

boot();
