const pages = {
  "/privacy": { file: "privacy-policy.md", title: "Privacy Policy" },
  "/terms": { file: "terms-of-service.md", title: "Terms of Service" },
  "/refund": { file: "refund-policy.md", title: "Refund Policy" },
};

const escapeHtml = (value) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const inline = (value) => escapeHtml(value)
  .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
  .replace(/`(.+?)`/g, "<code>$1</code>")
  .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" rel="noreferrer">$1</a>');

function markdownToHtml(markdown) {
  const lines = markdown.replace(/^---[\s\S]*?---\s*/, "").replace(/\r/g, "").split("\n");
  const output = [];
  let list = null;
  const closeList = () => { if (list) { output.push(`</${list}>`); list = null; } };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { closeList(); continue; }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) { closeList(); output.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`); continue; }
    const item = line.match(/^[-*]\s+(.+)$/) || line.match(/^\d+\.\s+(.+)$/);
    if (item) { const next = /^\d+\./.test(line) ? "ol" : "ul"; if (list !== next) { closeList(); output.push(`<${next}>`); list = next; } output.push(`<li>${inline(item[1])}</li>`); continue; }
    if (/^\|.+\|$/.test(line)) { closeList(); output.push(`<p>${inline(line.replaceAll("|", " · "))}</p>`); continue; }
    closeList(); output.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  return output.join("\n");
}

function navigation(pathname) {
  return `<header class="legal-header"><a class="legal-brand" href="/"><span>◉</span> Our Many Worlds</a><nav class="legal-nav" aria-label="Legal pages">${Object.entries(pages).map(([path, page]) => `<a href="${path}" ${path === pathname ? 'aria-current="page"' : ""}>${page.title}</a>`).join("")}</nav></header>`;
}

async function render() {
  const root = document.querySelector("#legalApp");
  const page = pages[window.location.pathname] || pages["/privacy"];
  root.innerHTML = `${navigation(window.location.pathname)}<article class="legal-content"><p class="legal-meta">Loading ${page.title}…</p></article>`;
  try {
    const response = await fetch(`/legal/${page.file}`, { cache: "no-cache" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const markdown = await response.text();
    document.title = `${page.title} | Our Many Worlds`;
    root.innerHTML = `${navigation(window.location.pathname)}<article class="legal-content">${markdownToHtml(markdown)}</article><footer class="legal-footer">© 2026 Our Many Worlds · <a href="/">Return to home</a></footer>`;
  } catch (error) {
    root.innerHTML = `${navigation(window.location.pathname)}<article class="legal-content"><h1>${page.title}</h1><p class="legal-error">This policy could not be loaded (${escapeHtml(String(error.message))}).</p></article>`;
  }
}

render();
