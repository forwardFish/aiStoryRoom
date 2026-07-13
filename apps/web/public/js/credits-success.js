import { apiFetch } from "./api-client.js";

const root = document.querySelector("[data-success-app]");
const checkoutId = new URLSearchParams(location.search).get("checkout_id");
const status = root.querySelector("[data-status]");
let attempts = 0;
async function poll() {
  if (!checkoutId) { status.textContent = "Missing checkout ID."; return; }
  attempts += 1;
  try {
    const result = await apiFetch(`/v4/billing/checkouts/${encodeURIComponent(checkoutId)}`);
    if (result.status === "PAID") {
      status.textContent = `${result.credits} World Credits are ready. Available balance: ${result.balance.available}.`;
      return;
    }
    status.textContent = "Payment received. Adding your World Credits…";
  } catch (error) { status.textContent = error.status === 401 ? "Please sign in again to view this payment." : error.message; return; }
  if (attempts < 15) window.setTimeout(poll, 2000);
  else status.textContent = "Payment received, but the credit update is still processing. Refresh shortly.";
}
poll();
