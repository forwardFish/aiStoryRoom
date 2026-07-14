import { apiFetch, getToken } from "./api-client.js";

const root = document.querySelector("[data-credits-app]");
const query = new URLSearchParams(location.search);
const intent = query.get("intent") === "WORLD_UNLOCK" ? "WORLD_UNLOCK" : "WALLET";
const runId = query.get("runId") || "";
const canonicalReturn = runId ? `/room-game?runId=${encodeURIComponent(runId)}` : "/credits";
const requestedReturn = query.get("returnTo") || canonicalReturn;
const returnTo = requestedReturn.startsWith("/") && !requestedReturn.startsWith("//") ? requestedReturn : canonicalReturn;
const packs = { credits_300: { credits: 300, price: "$7.99" }, credits_650: { credits: 650, price: "$14.99" } };
let selectedPack = null;
let currentBalance = null;

function message(text, kind = "info") { const node = root.querySelector("[data-message]"); node.textContent = text; node.dataset.kind = kind; }
function updateContext() {
  root.querySelector("[data-return-link]").href = returnTo;
  root.querySelector("[data-return-link]").textContent = runId ? "Back to room" : "Back to rooms";
  if (intent === "WORLD_UNLOCK") root.querySelector("[data-context-copy]").textContent = "Add credits, then we will take you straight back to this room to unlock the next shared round.";
  root.querySelector("[data-auth-link]").href = `/auth?returnTo=${encodeURIComponent(location.pathname + location.search)}`;
}
async function loadAccount() {
  if (!getToken()) { root.querySelector("[data-signed-out]").hidden = false; return; }
  try { currentBalance = await apiFetch("/v4/credits/balance"); root.querySelector("[data-balance]").textContent = currentBalance.available; root.querySelector("[data-balance-details]").textContent = `${currentBalance.purchased} purchased · ${currentBalance.bonus} bonus`; }
  catch (error) { root.querySelector("[data-signed-out]").hidden = false; message(error.message || "We could not load your credit balance.", "error"); }
}
function openConfirmation(key) {
  if (!getToken()) { root.querySelector("[data-signed-out]").hidden = false; message("Please sign in before purchasing credits.", "error"); return; }
  selectedPack = key;
  const pack = packs[key];
  root.querySelector("[data-confirm-title]").textContent = `${pack.credits} World Credits`;
  root.querySelector("[data-confirm-price]").textContent = pack.price;
  root.querySelector("[data-confirm-balance]").textContent = currentBalance ? `Current: ${currentBalance.available} · After payment: ${currentBalance.available + pack.credits}` : "Your balance will update after payment confirmation.";
  root.querySelector("[data-purchase-dialog]").showModal();
}
async function startCheckout() {
  if (!selectedPack) return;
  const button = root.querySelector("[data-confirm-purchase]");
  button.disabled = true; button.textContent = "Opening secure checkout…";
  try {
    const result = await apiFetch("/v4/billing/checkouts", { method: "POST", body: JSON.stringify({ packKey: selectedPack, intent, runId: runId || undefined, returnTo }) });
    location.assign(result.checkoutUrl);
  } catch (error) { button.disabled = false; button.textContent = "Continue to secure checkout"; message(error.message || "We could not start secure checkout. Please try again.", "error"); }
}
root.querySelectorAll("[data-pack]").forEach((button) => button.addEventListener("click", () => openConfirmation(button.dataset.pack)));
root.querySelector("[data-confirm-purchase]").addEventListener("click", startCheckout);
root.querySelector("[data-close-dialog]").addEventListener("click", () => root.querySelector("[data-purchase-dialog]").close());
updateContext(); loadAccount();
