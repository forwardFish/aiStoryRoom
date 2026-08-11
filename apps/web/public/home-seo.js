const FAQ_ITEMS = Object.freeze([
  Object.freeze({
    question: "What is a world in Our Many Worlds?",
    answer: "A world is a designed crisis shared by several roles. Each role enters with its own goals, private information, relationships, resources, and limited point of view. Everyone acts inside the same world, so one player's decision can change the choices, risks, and opportunities faced by everyone else."
  }),
  Object.freeze({
    question: "How is this different from a normal interactive story?",
    answer: "You are not following branches written for a single protagonist, and players are not having separate conversations with AI. Each person makes decisions from a different perspective. AI resolves those decisions together into one evolving world, where your actions can change what other characters know, believe, and are able to do. There is no predetermined path, but every world still has rules, limits, and consequences."
  }),
  Object.freeze({
    question: "How does a world begin?",
    answer: "Every run begins with a designed situation, a cast of roles, world rules, and a private briefing for each character. You know what your role would realistically know—not the whole truth. From that point onward, the situation evolves through player decisions, AI-controlled characters, and consequences already set in motion."
  }),
  Object.freeze({
    question: "What can I do during a run?",
    answer: "You can talk to characters, investigate claims or events, use leverage, or make your own move in your own words. Leverage may include favors, evidence, authority, relationships, resources, or promises. Every action can carry a cost, a risk, a level of visibility, and consequences for you, other characters, or the shared world."
  }),
  Object.freeze({
    question: "Do all players see the same information?",
    answer: "No. Players share one world, but they do not share one complete version of the truth. Public events may be visible to everyone, while private messages, clues, commitments, suspicions, and intentions are shown only to the roles that could realistically know them. What you reveal, hide, trade, misunderstand, or choose to believe becomes part of the game."
  }),
  Object.freeze({
    question: "Can I play by myself?",
    answer: "Yes. In Solo, you choose one role and AI controls the remaining characters. You still experience private information, competing goals, changing relationships, and consequences created by other roles, but you can move through the world at your own pace."
  }),
  Object.freeze({
    question: "Can I create a room and invite real people?",
    answer: "Yes. Choose a world, create a shared room, and invite people to take different roles. Each player receives their own goals, briefing, and private information. AI can fill any roles your group leaves open, so you do not need a full human cast to begin. Human and AI-controlled characters all act inside the same evolving world."
  }),
  Object.freeze({
    question: "What does the AI do during a run?",
    answer: "AI acts as the world simulator, the performer for unfilled roles, and the narrator of consequences. It interprets actions, resolves conflicting intentions, updates relationships and world conditions, and shows how decisions affect different characters. AI does not make choices for human players, and it does not force every run toward the same storyline or ending."
  }),
  Object.freeze({
    question: "What are World Credits?",
    answer: "Under the active-action policy, World Credits pay for creating a run and for successful player-directed actions. Creating a run costs 20 Credits. A suggested action costs 1 Credit, and a custom or complex action costs 2 Credits. Reading, AI-controlled actions, system-driven progress, retries, and failed generations cost 0 Credits. Some worlds may still use the previous one-time unlock policy; if so, that policy and its cost are shown before room creation."
  }),
  Object.freeze({
    question: "How can I get World Credits?",
    answer: "You can purchase 300 World Credits for $7.99 or 650 World Credits for $14.99. New accounts receive 50 bonus World Credits, and eligible referrals can earn 25 bonus World Credits. The current purchase and referral terms are shown before you confirm."
  })
]);

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[character]);
}

function setText(element, value) {
  if (element && element.textContent !== value) element.textContent = value;
}

function setHtml(element, value) {
  if (element && element.innerHTML !== value) element.innerHTML = value;
}

function setLabelPreservingIcon(element, value) {
  if (!element) return;
  const existingText = String(element.textContent || "").trim();
  if (existingText === value) return;
  const icon = element.querySelector("img")?.cloneNode(true);
  const ownerDocument = element.ownerDocument;
  element.replaceChildren(...(icon ? [icon, ownerDocument.createTextNode(` ${value}`)] : [ownerDocument.createTextNode(value)]));
}

function renderFaqItems() {
  return FAQ_ITEMS.map(({ question, answer }) => `<details><summary>${escapeHtml(question)}<img class="mw-icon" src="/assets/icon/39.png" alt="" aria-hidden="true" /></summary><p>${escapeHtml(answer)}</p></details>`).join("");
}

export function applySeoMarketingCopy(documentRef = document) {
  const root = documentRef.querySelector("#homeApp");
  if (!root) return false;

  setText(root.querySelector(".hero-copy .eyebrow"), "AI-POWERED SHARED WORLDS");
  setHtml(root.querySelector(".hero-copy h1"), "Everyone sees a <em>different truth.</em><br>Everyone changes the <em>same world.</em>");
  setText(
    root.querySelector(".hero-copy > p"),
    "Enter a living world as a character with your own goals, secrets, relationships, and limited point of view. Talk, investigate, bargain, or act in your own words. AI resolves everyone's moves into one shared world—and every choice can change what other players know, believe, and do."
  );

  const proofItems = root.querySelectorAll(".hero-proof > span");
  setLabelPreservingIcon(proofItems[0], "Solo or Multiplayer");
  setLabelPreservingIcon(proofItems[1], "Different goals and secrets");
  setLabelPreservingIcon(proofItems[2], "Your choices affect other players");

  setText(root.querySelector(".how-showcase-head .how-kicker"), "How It Plays");
  setHtml(
    root.querySelector("#how-it-works-title"),
    "<span>Not a story with branches.</span><em>One shared world shaped by everyone.</em>"
  );
  setText(
    root.querySelector(".how-showcase-head > p"),
    "Choose a role. Make your move. Watch private goals and decisions collide in one shared world."
  );

  const steps = root.querySelectorAll(".how-step");
  setText(steps[0]?.querySelector("h3"), "Choose a World and Role");
  setText(steps[0]?.querySelector("p"), "Enter as a character with your own goal, private information, relationships, and leverage.");
  setText(steps[1]?.querySelector("h3"), "Make Your Move");
  setText(steps[1]?.querySelector("p"), "Talk, investigate, bargain, use leverage, or describe your own action in your own words.");
  setText(steps[2]?.querySelector("h3"), "Face the Consequences");
  setText(steps[2]?.querySelector("p"), "See how your move changes your position, other players' choices, and the shared world.");

  setText(
    root.querySelector(".faq-simple-head > p"),
    "Clear answers about shared worlds, private roles, Solo and Multiplayer play, AI resolution, and World Credits."
  );
  const faqGrid = root.querySelector(".faq-grid");
  if (faqGrid && faqGrid.dataset.seoFaq !== "complete") {
    faqGrid.innerHTML = renderFaqItems();
    faqGrid.dataset.seoFaq = "complete";
  }
  return true;
}

if (typeof document !== "undefined") {
  let scheduled = false;
  const apply = () => {
    scheduled = false;
    applySeoMarketingCopy(document);
  };
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(apply);
  };
  apply();
  if (typeof MutationObserver === "function") {
    new MutationObserver(schedule).observe(document.querySelector("#homeApp") || document.documentElement, {
      childList: true,
      subtree: true
    });
  }
}
