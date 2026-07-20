function escapeTransitionText(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[character]);
}

export function renderTransitionScreen({
  eyebrow = "OUR MANY WORLDS",
  title = "Opening Your World",
  description = "Preparing your role, private information, and the latest state of the shared story.",
  status = "Entering the story...",
  testId = "loading",
  inline = false
} = {}) {
  return `<section class="mw-transition-screen${inline ? " is-inline" : ""}" data-testid="${escapeTransitionText(testId)}" role="status" aria-live="polite" aria-busy="true">
    <div class="mw-transition-card">
      <a class="mw-transition-brand" href="/" aria-label="Our Many Worlds home">
        <strong>Our Many Worlds</strong>
        <small>Real players. Living worlds.</small>
      </a>
      <div class="mw-transition-orbit" aria-hidden="true">
        <span class="mw-transition-mark">MW</span>
        <i></i><i></i><i></i>
      </div>
      <p class="mw-transition-eyebrow">${escapeTransitionText(eyebrow)}</p>
      <h1>${escapeTransitionText(title)}</h1>
      <p class="mw-transition-description">${escapeTransitionText(description)}</p>
      <div class="mw-transition-progress" aria-hidden="true"><span></span></div>
      <p class="mw-transition-status"><i aria-hidden="true"></i>${escapeTransitionText(status)}</p>
    </div>
  </section>`;
}
