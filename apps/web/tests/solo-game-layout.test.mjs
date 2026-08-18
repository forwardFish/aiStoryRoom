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

test("Pressure decision cards stay centered and long generated copy cannot widen the page", () => {
  assert.match(
    styles,
    /\.causal-shell\[data-pressure-chapter="true"\] \.causal-center\.decision-center \.decision-composer \{[^}]*box-sizing: border-box;[^}]*max-width: 680px;[^}]*min-width: 0;[^}]*justify-self: center;/,
  );
  assert.match(
    styles,
    /\.causal-shell\[data-pressure-chapter="true"\] \.decision-composer \.decision-zone-head h2,[^}]*\.option-copy \{[^}]*min-width: 0;[^}]*white-space: normal;[^}]*overflow-wrap: anywhere;/,
  );
});

test("Pressure decision cards hide redundant titles and enlarge the actionable detail", () => {
  assert.match(
    styles,
    /\.causal-shell\[data-pressure-chapter="true"\] \.decision-composer \.option-copy > b \{\s*display: none;/,
  );
  assert.match(
    styles,
    /\.causal-shell\[data-pressure-chapter="true"\] \.decision-composer \.option-copy > span \{[^}]*font-size: 16px;[^}]*line-height: 1\.55;/,
  );
});
