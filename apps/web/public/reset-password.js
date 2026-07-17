const root = document.querySelector("#reset-password-app");
const form = root?.querySelector("[data-reset-password-form]");
const notice = root?.querySelector("[data-reset-notice]");
const token = String(new URLSearchParams(location.search).get("token") || "").trim();
const isLocalRuntime = location.hostname === "localhost" || location.hostname === "127.0.0.1";
const deployedApiBase = "https://appsapi-test.up.railway.app/api";
const apiBase = (isLocalRuntime ? "/api" : deployedApiBase).replace(/\/$/, "");

function showNotice(message) {
  if (!notice) return;
  notice.textContent = message;
  notice.hidden = false;
}

async function request(url, options = {}) {
  const response = await fetch(url.startsWith("/api/") ? `${apiBase}${url.slice(4)}` : url, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || data.code || `Request failed: ${response.status}`);
  return data;
}

if (!token) {
  form?.querySelectorAll("input,button").forEach((element) => { element.disabled = true; });
  showNotice("This password-reset link is invalid. Request a new link from the login page.");
}

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(form));
  const password = String(values.password || "");
  const confirmPassword = String(values.confirmPassword || "");
  if (password.length < 8) return showNotice("Choose a password of at least 8 characters.");
  if (password !== confirmPassword) return showNotice("The two passwords do not match.");

  const button = form.querySelector('button[type="submit"]');
  if (button) {
    button.disabled = true;
    button.textContent = "Updating...";
  }
  try {
    await request("/api/v4/auth/password-reset/confirm", {
      method: "POST",
      body: JSON.stringify({ token, password })
    });
    root.querySelector(".reset-password-card").innerHTML = `<div class="reset-password-success"><div class="success-mark" aria-hidden="true"><span>&#10003;</span></div><h1 class="auth-title">Your password has been updated</h1><p class="success-copy">Sign in with your new password to continue exploring your worlds. Your previous password can no longer be used.</p><a class="btn primary" href="/auth?mode=login">Continue to login</a><a class="success-home" href="/">Return to home</a></div>`;
  } catch (error) {
    if (button) {
      button.disabled = false;
      button.textContent = "Update password";
    }
    showNotice(error.message || "Unable to reset your password. Request a new link and try again.");
  }
});
