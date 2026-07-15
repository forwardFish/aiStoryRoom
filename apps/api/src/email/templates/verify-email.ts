export function verifyEmailTemplate(url: string) {
  return {
    subject: "Verify your Many Worlds email",
    text: `Verify your email to enter Many Worlds: ${url}`,
    html: `<p>Verify your email to enter Many Worlds.</p><p><a href="${escapeHtml(url)}">Verify email</a></p><p>This link expires soon and can be used once.</p>`
  };
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character] || character);
}
