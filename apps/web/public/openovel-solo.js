const RUN_KEY = "our-many-worlds.openovel-product.run-id";
const CREATE_KEY = "our-many-worlds.openovel-product.create-key";
const PENDING_ACTION_KEY = "our-many-worlds.openovel-product.pending-action";

const params = new URLSearchParams(location.search);
const apiBase = String(params.get("apiBase") || "/api").replace(/\/+$/, "");
const forceNewRun = params.get("start") === "new";
const storyElement = document.querySelector("#story");
const streamingElement = document.querySelector("#streaming");
const optionsElement = document.querySelector("#options");
const formElement = document.querySelector("#free-action");
const actionElement = document.querySelector("#action-text");
const submitElement = document.querySelector("#submit-action");
const statusElement = document.querySelector("#status");
const newRunElement = document.querySelector("#new-run");

let currentRun = null;
let busy = false;

if (forceNewRun) {
  localStorage.removeItem(RUN_KEY);
  localStorage.setItem(CREATE_KEY, stableKey("run"));
  localStorage.removeItem(PENDING_ACTION_KEY);
  params.delete("start");
  const cleanSearch = params.toString();
  history.replaceState(null, "", `${location.pathname}${cleanSearch ? `?${cleanSearch}` : ""}${location.hash}`);
}

newRunElement.addEventListener("click", async () => {
  if (busy || !confirm("重新开始会创建一条新的故事线，确定继续吗？")) return;
  localStorage.removeItem(RUN_KEY);
  localStorage.setItem(CREATE_KEY, stableKey("run"));
  localStorage.removeItem(PENDING_ACTION_KEY);
  currentRun = null;
  await boot();
});

formElement.addEventListener("submit", async (event) => {
  event.preventDefault();
  const action = actionElement.value.trim();
  if (!action || busy) return;
  actionElement.value = "";
  await takeAction(action, null);
});

async function boot() {
  setBusy(true, "正在打开总督府的卷宗……");
  try {
    const savedRunId = localStorage.getItem(RUN_KEY);
    if (savedRunId) {
      const restored = await request(`/v4/openovel/runs/${encodeURIComponent(savedRunId)}`);
      currentRun = restored;
      renderRun(currentRun);
      setBusy(false, "");
      return;
    }
    const createKey = localStorage.getItem(CREATE_KEY) || stableKey("run");
    localStorage.setItem(CREATE_KEY, createKey);
    currentRun = await request("/v4/openovel/runs", {
      method: "POST",
      body: JSON.stringify({ idempotencyKey: createKey }),
    });
    localStorage.setItem(RUN_KEY, currentRun.runId);
    renderRun(currentRun);
    setBusy(false, "");
  } catch (error) {
    if (Number(error.status) === 401) return redirectToLogin();
    setBusy(false, humanError(error));
    console.error(error);
  }
}

async function takeAction(action, boundOption) {
  if (!currentRun) return;
  setBusy(true, "人物正在回应你的决定……");
  streamingElement.textContent = "";
  streamingElement.hidden = false;
  optionsElement.replaceChildren();

  const prior = readPendingAction();
  const pending = prior && prior.runId === currentRun.runId
    && prior.action === action
    && JSON.stringify(prior.boundOption || null) === JSON.stringify(boundOption || null)
      ? prior
      : {
          runId: currentRun.runId,
          action,
          boundOption,
          idempotencyKey: stableKey("turn"),
        };
  localStorage.setItem(PENDING_ACTION_KEY, JSON.stringify(pending));

  let committed = null;
  let warning = "";
  let warningCode = "";
  try {
    const response = await fetch(
      `${apiBase}/v4/openovel/runs/${encodeURIComponent(currentRun.runId)}/actions`,
      {
        method: "POST",
        credentials: "include",
        headers: {
          accept: "text/event-stream",
          "content-type": "application/json",
        },
        body: JSON.stringify(pending),
      },
    );
    if (response.status === 401) return redirectToLogin();
    if (!response.ok || !response.body) throw await responseError(response);
    await readEventStream(response.body, (event) => {
      if (event.type === "narration.delta") {
        streamingElement.textContent += String(event.data.text || "");
      } else if (event.type === "turn.committed") {
        committed = event.data;
      } else if (event.type === "runtime.warning") {
        warningCode = String(event.data?.code || "");
        warning = warningMessage(event.data);
      }
    });
    if (!committed) throw new Error(warning || "本回合尚未完成");

    localStorage.removeItem(PENDING_ACTION_KEY);
    currentRun = await request(`/v4/openovel/runs/${encodeURIComponent(currentRun.runId)}`);
    renderRun(currentRun);
    setBusy(false, "");
  } catch (error) {
    // A warning followed by a closed stream is a terminal server result. The
    // failed action remains in the audit trail, but a player retry must use a
    // new idempotency key. For an ambiguous network interruption, keep the key
    // so reconnecting cannot accidentally submit the action twice.
    if (!committed && warningCode) localStorage.removeItem(PENDING_ACTION_KEY);
    streamingElement.hidden = true;
    streamingElement.textContent = "";
    setBusy(false, warning || humanError(error));
    renderOptions(currentRun.options || []);
    console.error(error);
  }
}

async function request(path, options = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (!response.ok) throw await responseError(response);
  return response.json();
}

async function responseError(response) {
  const payload = await response.json().catch(() => ({}));
  return Object.assign(
    new Error(String(payload.message || payload.code || `请求失败（${response.status}）`)),
    { status: response.status, code: payload.code, payload },
  );
}

async function readEventStream(stream, onEvent) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() || "";
    for (const block of blocks) {
      const lines = block.split(/\r?\n/);
      const type = lines.find((line) => line.startsWith("event:"))?.slice(6).trim();
      const data = lines
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("\n");
      if (type && data) onEvent({ type, data: JSON.parse(data) });
    }
    if (done) break;
  }
}

function renderRun(run) {
  streamingElement.hidden = true;
  streamingElement.textContent = "";
  renderCanon(run.canon || "");
  renderOptions(run.options || []);
  requestAnimationFrame(() => {
    if (Number(run.turnNumber || 0) === 0) {
      window.scrollTo({ top: 0, behavior: "auto" });
      return;
    }
    storyElement.lastElementChild?.scrollIntoView({ block: "start", behavior: "auto" });
  });
}

function renderCanon(markdown) {
  storyElement.replaceChildren();
  const chunks = String(markdown)
    .replace(/\r/g, "")
    .split(/\n{2,}/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
  for (const chunk of chunks) {
    // Reader actions remain in Canon for audit and Storykeeper continuity, but
    // the player-facing reader must contain only story prose. The selected
    // option was already visible when the player chose it.
    if (chunk.startsWith("**读者选择**：")) continue;
    if (chunk.startsWith("# ")) {
      const heading = document.createElement("h2");
      heading.textContent = chunk.slice(2).trim();
      storyElement.append(heading);
      continue;
    }
    const paragraph = document.createElement("p");
    paragraph.textContent = chunk;
    storyElement.append(paragraph);
  }
}

function renderOptions(options) {
  optionsElement.replaceChildren();
  for (const option of options) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "option-button";
    button.textContent = String(option.label || "");
    button.disabled = busy;
    button.addEventListener("click", () => takeAction(button.textContent, {
      id: String(option.id || ""),
      label: button.textContent,
    }));
    optionsElement.append(button);
  }
}

function setBusy(nextBusy, message) {
  busy = nextBusy;
  actionElement.disabled = nextBusy;
  submitElement.disabled = nextBusy;
  newRunElement.disabled = nextBusy;
  for (const button of optionsElement.querySelectorAll("button")) button.disabled = nextBusy;
  statusElement.textContent = message;
}

function stableKey(prefix) {
  const suffix = globalThis.crypto?.randomUUID?.()
    || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${suffix}`.replace(/[^A-Za-z0-9._:-]/g, "-");
}

function readPendingAction() {
  try {
    return JSON.parse(localStorage.getItem(PENDING_ACTION_KEY) || "null");
  } catch {
    return null;
  }
}

function redirectToLogin() {
  const returnTo = `${location.pathname}${location.search}${location.hash}`;
  location.assign(`/auth?returnTo=${encodeURIComponent(returnTo)}`);
}

function warningMessage(value) {
  const code = String(value?.code || "");
  if (code === "WORLD_CREDITS_REQUIRED") return "可用 World Credits 不足，暂时不能提交这次行动。";
  if (code === "OPENOVEL_ACTION_IN_PROGRESS") return "这次行动仍在生成，请稍候再试。";
  return "这一回合没有写完。你的原决定已经保留，可以再次提交。";
}

function humanError(error) {
  if (Number(error?.status) === 402 || error?.code === "WORLD_CREDITS_REQUIRED") {
    return "可用 World Credits 不足，暂时不能提交这次行动。";
  }
  return "故事暂时没有续写成功。你的原决定已经保留，可以再次提交。";
}

await boot();
