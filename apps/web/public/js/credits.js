import { apiFetch, getToken } from "./api-client.js";

const root = document.querySelector("[data-credits-app]");
const query = new URLSearchParams(location.search);
const requestedIntent = query.get("intent") || "WALLET";
const intent = ["WORLD_UNLOCK", "RUN_CREATE", "PLAYER_RECLAIM"].includes(requestedIntent) ? requestedIntent : "WALLET";
const runId = query.get("runId") || "";
const canonicalReturn = intent === "WORLD_UNLOCK" && runId
  ? `/game?runId=${encodeURIComponent(runId)}`
  : intent === "PLAYER_RECLAIM" && runId
    ? `/game?runId=${encodeURIComponent(runId)}`
    : intent === "RUN_CREATE" ? "/rooms" : "/";
const requestedReturn = query.get("returnTo") || canonicalReturn;
const safeRequestedReturn = requestedReturn.startsWith("/") && !requestedReturn.startsWith("//") && !requestedReturn.startsWith("/credits") ? requestedReturn : canonicalReturn;
const returnTo = intent !== "WALLET" ? safeRequestedReturn : "/";
const packs = { credits_300: { credits: 300, price: "$7.99" }, credits_650: { credits: 650, price: "$14.99" } };
let selectedPack = query.get("confirm") in packs ? query.get("confirm") : "";
let currentBalance = { available: 0 };
let roomContext = null;

const by = (selector) => root.querySelector(selector);
function message(text, kind = "info") { const node = by("[data-message]"); node.textContent = text || ""; node.dataset.kind = kind; }
function urlFor(pack = "") { const next = new URLSearchParams(); if (intent !== "WALLET") next.set("intent", intent); if (runId) next.set("runId", runId); if (returnTo !== "/") next.set("returnTo", returnTo); if (pack) next.set("confirm", pack); const text = next.toString(); return `/credits${text ? `?${text}` : ""}`; }
function authUrl(pack) { return `/auth?returnTo=${encodeURIComponent(urlFor(pack))}`; }
function setContext() {
  const active = intent !== "WALLET";
  document.querySelectorAll("[data-return-label]").forEach((label) => { label.textContent = active ? "Return to story" : "Back"; });
  document.querySelectorAll("[data-return-link], [data-return-bottom]").forEach((link) => {
    link.href = returnTo;
    link.setAttribute("aria-label", active ? "Return to story" : "Back");
  });
  by("[data-unlock-context]").hidden = !active;
  by("[data-context-copy]").textContent = intent === "RUN_CREATE" ? "Add Credits, then return to create your living world." : intent === "PLAYER_RECLAIM" ? "Add Credits, then return to reclaim your character safely." : active ? "Add Credits to your account, then return to your shared story." : "Add Credits to your account. Choose a pack to continue to secure checkout.";
  if (roomContext) {
    const title = roomContext.title || "your shared story";
    by("[data-context-room]").textContent = `Add Credits, then return to ${title}`;
    by("[data-context-round]").textContent = "Your room link will be preserved while you complete checkout.";
    by("[data-confirm-room]").textContent = `Return to ${title} after checkout`;
    by("[data-confirm-round]").textContent = "Your room link will be preserved.";
  }
  by("[data-confirm-context]").hidden = !active;
}
function render() {
  const isConfirm = Boolean(selectedPack);
  root.dataset.view = isConfirm ? "confirm" : "wallet";
  by("[data-wallet-state]").hidden = isConfirm; by("[data-confirm-state]").hidden = !isConfirm;
  by("[data-wallet-title]").hidden = isConfirm;
  by("[data-unlock-context]").hidden = isConfirm || intent === "WALLET";
  by(".credits-trust").hidden = isConfirm;
  by("[data-balance]").textContent = String(currentBalance.available);
  if (!isConfirm) return;
  const pack = packs[selectedPack];
  by("[data-confirm-credits]").textContent = String(pack.credits); by("[data-confirm-price]").textContent = pack.price;
  by("[data-confirm-current]").textContent = `${currentBalance.available} Credits`;
  by("[data-confirm-after]").textContent = `${currentBalance.available + pack.credits} Credits`;
}
async function loadAccount() {
  if (!getToken()) { render(); return; }
  try {
    const [balance, transactions] = await Promise.all([apiFetch("/v4/credits/balance"), apiFetch("/v4/credits/transactions?pageSize=20")]);
    currentBalance = balance;
    renderTransactions([...(transactions.items || []), ...(transactions.allowanceUsages || [])].sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt)));
  }
  catch (error) { message(error.message || "We could not load your credit balance.", "error"); }
}
async function loadRoomContext() {
  if (!runId || !["WORLD_UNLOCK", "PLAYER_RECLAIM"].includes(intent) || !getToken()) return;
  try {
    const game = await apiFetch(`/v4/rooms/${encodeURIComponent(runId)}/game`);
    roomContext = { title: game.room?.title };
  } catch { roomContext = { title: "your shared story" }; }
}
function openConfirmation(key) {
  if (!getToken()) { location.assign(authUrl(key)); return; }
  selectedPack = key;
  history.pushState({}, "", urlFor(key));
  setContext();
  render();
}
async function startCheckout() {
  if (!selectedPack) return;
  const button = by("[data-confirm-purchase]"); if (button.disabled) return;
  button.disabled = true; button.textContent = "Opening secure checkout…";
  try { const result = await apiFetch("/v4/billing/checkouts", { method: "POST", body: JSON.stringify({ packKey: selectedPack, intent, runId: runId || undefined, returnTo }) }); location.assign(result.checkoutUrl); }
  catch (error) { location.assign(`/credits/failed?${new URLSearchParams({ intent, ...(runId ? { runId } : {}), ...(returnTo ? { returnTo } : {}) })}`); }
}

by("[data-confirm-purchase]").addEventListener("click", startCheckout);
root.querySelectorAll("[data-pack]").forEach((button) => button.addEventListener("click", () => openConfirmation(button.dataset.pack)));
by("[data-back-wallet]").addEventListener("click", () => {
  selectedPack = "";
  history.pushState({}, "", urlFor());
  setContext();
  render();
});
window.addEventListener("popstate", () => {
  const next = new URLSearchParams(location.search).get("confirm");
  selectedPack = next in packs ? next : "";
  setContext();
  render();
});
if (selectedPack && !getToken()) {
  location.replace(authUrl(selectedPack));
} else {
  setContext();
  render();
  await Promise.all([loadAccount(), loadRoomContext()]);
  setContext();
  render();
}
function renderTransactions(items) {
  const target = by("[data-credit-transactions]");
  if (!target) return;
  const labels = { RUN_CREATE: "Run created", PLAYER_ACTION: "Player action", RUN_SPONSORSHIP: "Run sponsorship", RUN_ALLOWANCE_USAGE: "Run allowance action", SYSTEM_REFUND: "System release", WORLD_UNLOCK: "World unlocked", SIGNUP_BONUS: "New account reward", REFERRAL_REWARD: "Referral reward", PURCHASE: "Credits purchased" };
  target.innerHTML = items.length ? items.map((item) => {
    const delta = item.allowanceDelta === undefined ? Number(item.purchasedDelta || 0) + Number(item.bonusDelta || 0) : Number(item.allowanceDelta || 0);
    const unit = item.reason === "RUN_ALLOWANCE_USAGE" ? " Run" : "";
    const trace = item.trace || {};
    const traceText = [trace.runId ? `Run ${shortId(trace.runId)}` : "", trace.charge?.id ? `Charge ${shortId(trace.charge.id)}` : "", trace.actionId ? `Action ${shortId(trace.actionId)}` : ""].filter(Boolean).join(" · ");
    return `<li><span><b>${labels[item.reason] || String(item.reason || "Credit update").replaceAll("_", " ")}</b><small>${new Date(item.createdAt).toLocaleString()}${traceText ? ` · ${traceText}` : ""}</small></span><strong class="${delta >= 0 ? "positive" : "negative"}">${delta >= 0 ? "+" : ""}${delta}${unit}</strong></li>`;
  }).join("") : "<li><span>No Credit transactions yet.</span></li>";
}

function shortId(value) { const text = String(value || ""); return text.length > 14 ? `${text.slice(0, 6)}…${text.slice(-5)}` : text; }
