export function resetPasswordTemplate(url: string) {
  return {
    subject: "Reset your Many Worlds password",
    text: `Reset your Many Worlds password: ${url}`,
    html: `<p>Reset your Many Worlds password.</p><p><a href="${escapeHtml(url)}">Choose a new password</a></p><p>This link expires soon and can be used once.</p>`
  };
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character] || character);
}
