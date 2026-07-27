const RUN_KEY = "our-many-worlds.openovel-playtest.run-id";

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

newRunElement.addEventListener("click", async () => {
  if (busy) return;
  localStorage.removeItem(RUN_KEY);
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
      const response = await fetch(`/internal/openovel/runs/${encodeURIComponent(savedRunId)}`);
      if (response.ok) {
        currentRun = await response.json();
        renderRun(currentRun);
        setBusy(false, "");
        return;
      }
      localStorage.removeItem(RUN_KEY);
    }
    const runId = createRunId();
    const response = await fetch("/internal/openovel/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        runId,
        worldId: "sangtian",
        roleId: "zhejiang_governor",
        storyPackageVersion: "openovel-playtest-v1",
        openingVersion: "current",
      }),
    });
    if (!response.ok) throw new Error(await responseMessage(response));
    currentRun = await response.json();
    localStorage.setItem(RUN_KEY, currentRun.runId);
    renderRun(currentRun);
    setBusy(false, "");
  } catch (error) {
    setBusy(false, "暂时无法进入故事，请稍后重试。");
    console.error(error);
  }
}

async function takeAction(action, boundOption) {
  if (!currentRun) return;
  setBusy(true, "人物正在回应你的决定……");
  streamingElement.textContent = "";
  streamingElement.hidden = false;
  optionsElement.replaceChildren();

  let committed = null;
  let warning = "";
  try {
    const response = await fetch(
      `/internal/openovel/runs/${encodeURIComponent(currentRun.runId)}/actions`,
      {
        method: "POST",
        headers: {
          accept: "text/event-stream",
          "content-type": "application/json",
        },
        body: JSON.stringify({ action, boundOption }),
      },
    );
    if (!response.ok || !response.body) throw new Error(await responseMessage(response));
    await readEventStream(response.body, (event) => {
      if (event.type === "narration.delta") {
        streamingElement.textContent += String(event.data.text || "");
      } else if (event.type === "turn.committed") {
        committed = event.data;
      } else if (event.type === "runtime.warning" && event.data.code === "FOREGROUND_FAILED") {
        warning = "这一回合没有写完，请保留原决定后再试一次。";
      }
    });

    if (!committed) throw new Error(warning || "本回合尚未完成");
    currentRun = await getRun(currentRun.runId);
    renderRun(currentRun);
    setBusy(false, "");
  } catch (error) {
    streamingElement.hidden = true;
    streamingElement.textContent = "";
    setBusy(false, warning || "故事暂时没有续写成功，你可以再次提交刚才的行动。");
    renderOptions(currentRun.options || []);
    console.error(error);
  }
}

async function getRun(runId) {
  const response = await fetch(`/internal/openovel/runs/${encodeURIComponent(runId)}`);
  if (!response.ok) throw new Error(await responseMessage(response));
  return response.json();
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
      if (!type || !data) continue;
      onEvent({ type, data: JSON.parse(data) });
    }
    if (done) break;
  }
}

function renderRun(run) {
  streamingElement.hidden = true;
  streamingElement.textContent = "";
  renderCanon(run.canon || "");
  renderOptions(run.options || []);
  actionElement.disabled = false;
  submitElement.disabled = false;
  requestAnimationFrame(() => {
    if (Number(run.turnNumber || 0) === 0) {
      window.scrollTo({ top: 0, behavior: "auto" });
      return;
    }
    const actionAnchors = storyElement.querySelectorAll(".reader-action");
    const latestAction = actionAnchors[actionAnchors.length - 1];
    latestAction?.scrollIntoView({ block: "start", behavior: "auto" });
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
    if (chunk.startsWith("# ")) {
      const heading = document.createElement("h2");
      heading.textContent = chunk.slice(2).trim();
      storyElement.append(heading);
      continue;
    }
    const paragraph = document.createElement("p");
    if (chunk.startsWith("**读者选择**：")) {
      paragraph.className = "reader-action";
      paragraph.textContent = `你的决定：${chunk.slice("**读者选择**：".length).trim()}`;
    } else {
      paragraph.textContent = chunk;
    }
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
  for (const button of optionsElement.querySelectorAll("button")) {
    button.disabled = nextBusy;
  }
  statusElement.textContent = message;
}

function createRunId() {
  const suffix = globalThis.crypto?.randomUUID?.()
    || `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  return `playtest_${suffix.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

async function responseMessage(response) {
  const payload = await response.json().catch(() => null);
  return String(payload?.error || `请求失败（${response.status}）`);
}

await boot();
