import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const styles = await readFile(new URL("../public/main-game.css", import.meta.url), "utf8");

test("solo game stacks every reading surface at browser-side-panel widths", () => {
  assert.match(styles, /@media \(max-width: 1180px\)/);
  assert.match(
    styles,
    /\.causal-player-root:has\(\.v2-current-situation-summary\) \{[^}]*height: 100vh;[^}]*overflow-y: auto;/,
  );
  assert.match(
    styles,
    /\.causal-shell:has\(\.v2-current-situation-summary\) \{[^}]*grid-template-columns: minmax\(0, 1fr\);[^}]*overflow: visible;/,
  );
  assert.match(
    styles,
    /\.causal-shell:has\(\.v2-current-situation-summary\) \.causal-left,[^}]*\.causal-right \{[^}]*display: flex;[^}]*overflow: visible;/,
  );
});

test("solo game resource panels keep their natural height instead of shrinking", () => {
  assert.match(
    styles,
    /\.causal-shell:has\(\.v2-current-situation-summary\) \.causal-left > \.causal-panel \{\s*flex: 0 0 auto;/,
  );
});
