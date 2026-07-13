import { apiFetch, setToken } from "./api-client.js";

const root = document.querySelector("[data-credits-app]");
const message = (text, kind = "info") => { const node = root.querySelector("[data-message]"); node.textContent = text; node.dataset.kind = kind; };
const renderBalance = (balance) => { root.querySelector("[data-balance]").textContent = `${balance.available} available · ${balance.bonus} bonus · ${balance.purchased} purchased`; };

async function loadAccount() {
  try {
    const [me, balance, referral] = await Promise.all([apiFetch("/v4/auth/me"), apiFetch("/v4/credits/balance"), apiFetch("/v4/referrals/me")]);
    root.querySelector("[data-account]").textContent = `${me.email || me.nickname} · verified`;
    renderBalance(balance);
    root.querySelector("[data-invite]").value = referral.inviteUrl;
    root.querySelector("[data-reward-slots]").textContent = `${referral.remainingRewardSlots} reward slots remaining`;
  } catch (error) {
    root.querySelector("[data-account]").textContent = "Not signed in";
    if (error.status !== 401) message(error.message, "error");
  }
}

root.querySelector("[data-register]").addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget));
  try {
    const result = await apiFetch("/v4/auth/register", { method: "POST", body: JSON.stringify(data) });
    setToken(result.token);
    root.querySelector("[data-verification-token]").value = result.verificationToken || "";
    message("Account created. Verify with the local token shown below.", "success");
    await loadAccount();
  } catch (error) { message(error.message, "error"); }
});

root.querySelector("[data-verify]").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const data = Object.fromEntries(new FormData(event.currentTarget));
    await apiFetch("/v4/auth/verify", { method: "POST", body: JSON.stringify(data) });
    message("Email verified. You can now claim your signup credits.", "success");
    await loadAccount();
  } catch (error) { message(error.message, "error"); }
});

root.querySelector("[data-login]").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const result = await apiFetch("/v4/auth/login", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) });
    setToken(result.token);
    message("Signed in.", "success");
    await loadAccount();
  } catch (error) { message(error.message, "error"); }
});

root.querySelector("[data-onboarding]").addEventListener("click", async () => {
  try { const result = await apiFetch("/v4/credits/onboarding", { method: "POST", body: JSON.stringify({}) }); renderBalance(result.balance); message(result.bonusGranted ? "50 Bonus Credits added." : "Signup bonus already claimed.", "success"); } catch (error) { message(error.message, "error"); }
});

root.querySelectorAll("[data-pack]").forEach((button) => button.addEventListener("click", async () => {
  try { const result = await apiFetch("/v4/billing/checkouts", { method: "POST", body: JSON.stringify({ packKey: button.dataset.pack }) }); window.location.assign(result.checkoutUrl); } catch (error) { message(error.message, "error"); }
}));

root.querySelector("[data-copy]").addEventListener("click", async () => { await navigator.clipboard.writeText(root.querySelector("[data-invite]").value); message("Invite link copied. Sharing alone does not grant credits.", "success"); });
loadAccount();
