const STANDARD_PAGE_HEADER_TAG = "standard-page-header";
const HTMLElementBase = globalThis.HTMLElement || class {};

function escapeAttribute(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[character]);
}

class StandardPageHeader extends HTMLElementBase {
  static get observedAttributes() {
    return ["back-href", "back-label", "brand-href", "dynamic-return"];
  }

  connectedCallback() {
    this.render();
  }

  attributeChangedCallback() {
    if (this.isConnected) this.render();
  }

  render() {
    const backHref = escapeAttribute(this.getAttribute("back-href") || "/");
    const backLabel = escapeAttribute(this.getAttribute("back-label") || "Back");
    const brandHref = escapeAttribute(this.getAttribute("brand-href") || "/");
    const dynamicReturn = this.hasAttribute("dynamic-return");
    const returnLink = dynamicReturn ? " data-return-link" : "";
    const returnLabel = dynamicReturn ? " data-return-label" : "";

    this.innerHTML = `<header class="standard-page-header__bar">
      <a class="standard-page-header__back" href="${backHref}" aria-label="${backLabel}"${returnLink}>
        <span class="standard-page-header__back-icon" aria-hidden="true">←</span>
        <span${returnLabel}>${backLabel}</span>
      </a>
      <a class="standard-page-header__brand" href="${brandHref}" aria-label="Our Many Worlds home">
        <strong>Our Many Worlds</strong>
        <small>Real players. Living worlds.</small>
      </a>
    </header>`;
  }
}

if (globalThis.customElements && !globalThis.customElements.get(STANDARD_PAGE_HEADER_TAG)) {
  globalThis.customElements.define(STANDARD_PAGE_HEADER_TAG, StandardPageHeader);
}

export { StandardPageHeader };
