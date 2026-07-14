import { apiFetch, getToken } from "./api-client.js";

const root = document.querySelector("[data-credits-app]");
const query = new URLSearchParams(location.search);
const intent = query.get("intent") === "WORLD_UNLOCK" ? "WORLD_UNLOCK" : "WALLET";
const runId = query.get("runId") || "";
const canonicalReturn = runId ? `/room-game?runId=${encodeURIComponent(runId)}` : "/credits";
const requestedReturn = query.get("returnTo") || canonicalReturn;
const returnTo = requestedReturn.startsWith("/") && !requestedReturn.startsWith("//") ? requestedReturn : canonicalReturn;
const packs = { credits_300: { credits: 300, price: "$7.99" }, credits_650: { credits: 650, price: "$14.99" } };
let selectedPack = query.get("confirm") in packs ? query.get("confirm") : "";
let currentBalance = { available: 0, purchased: 0, bonus: 0 };
let roomContext = null;

const by = (selector) => root.querySelector(selector);
function message(text, kind = "info") { const node = by("[data-message]"); node.textContent = text || ""; node.dataset.kind = kind; }
function urlFor(pack = "") { const next = new URLSearchParams(); if (intent === "WORLD_UNLOCK") next.set("intent", intent); if (runId) next.set("runId", runId); if (returnTo !== "/credits") next.set("returnTo", returnTo); if (pack) next.set("confirm", pack); const text = next.toString(); return `/credits${text ? `?${text}` : ""}`; }
function setContext() {
  by("[data-return-link]").href = returnTo; by("[data-return-link]").textContent = runId ? "Back to room" : "Back to rooms";
  by("[data-auth-link]").href = `/auth?returnTo=${encodeURIComponent(location.pathname + location.search)}`;
  const active = intent === "WORLD_UNLOCK";
  by("[data-unlock-context]").hidden = !active;
  by("[data-context-copy]").textContent = active ? "Add credits, then return to your shared story." : "Add credits to continue exploring Many Worlds.";
  if (roomContext) {
    const label = `You are unlocking ${roomContext.title || "your shared room"}`;
    const round = `You need ${Math.max(0, Number(roomContext.requiredCredits || 100) - currentBalance.available)} more Credits to continue Round ${roomContext.round || 4}.`;
    by("[data-context-room]").textContent = label; by("[data-context-round]").textContent = round;
    by("[data-confirm-room]").textContent = label; by("[data-confirm-round]").textContent = `Return to ${roomContext.title || "this room"} · Round ${roomContext.round || 4} of 7`;
  }
  by("[data-confirm-context]").hidden = !active;
}
function render() {
  const isConfirm = Boolean(selectedPack);
  by("[data-wallet-state]").hidden = isConfirm; by("[data-confirm-state]").hidden = !isConfirm;
  by("[data-wallet-title]").hidden = isConfirm;
  by("[data-unlock-context]").hidden = isConfirm || intent !== "WORLD_UNLOCK";
  by(".credits-trust").hidden = isConfirm;
  by("[data-balance]").textContent = String(currentBalance.available);
  by("[data-bonus]").textContent = String(currentBalance.bonus);
  by("[data-purchased]").textContent = String(currentBalance.purchased);
  if (!isConfirm) return;
  const pack = packs[selectedPack];
  by("[data-confirm-credits]").textContent = String(pack.credits); by("[data-confirm-price]").textContent = pack.price;
  by("[data-confirm-current]").textContent = `${currentBalance.available} Credits`;
  by("[data-confirm-after]").textContent = `${currentBalance.available + pack.credits} Credits`;
}
async function loadAccount() {
  if (!getToken()) { by("[data-signed-out]").hidden = false; render(); return; }
  try { currentBalance = await apiFetch("/v4/credits/balance"); }
  catch (error) { by("[data-signed-out]").hidden = false; message(error.message || "We could not load your credit balance.", "error"); }
}
async function loadRoomContext() {
  if (!runId || intent !== "WORLD_UNLOCK" || !getToken()) return;
  try {
    const game = await apiFetch(`/v4/rooms/${encodeURIComponent(runId)}/game`);
    roomContext = { title: game.room?.title, round: game.currentNode?.nodeIndex, requiredCredits: game.access?.requiredCredits || 100 };
  } catch { roomContext = { title:"your shared room", round:4, requiredCredits:100 }; }
}
function openConfirmation(key) {
  if (!getToken()) { by("[data-signed-out]").hidden = false; message("Please sign in before purchasing credits.", "error"); return; }
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
await Promise.all([loadAccount(), loadRoomContext()]); setContext(); render();
