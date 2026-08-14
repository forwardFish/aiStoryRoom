# M4A parallel development checkpoint

Status: `M4A_PRO_IN_PROGRESS / NOT_DELIVERED / NOT_ACCEPTED`

## Reason for the split

The six-hour execution window permits additional parallel Pro work, but M4 HTTP/Product Root wiring depends on accepted M2 and M3 artifacts. M4 was therefore split into:

- M4A: pure mode parser and selector core with two new files only;
- M4B: integration wiring, deferred until M2, M3, M4A and the latest-main compatibility gate all pass.

This keeps the active write sets disjoint and prevents an unaccepted snapshot reader or projector from leaking into production composition.

## Pro Chat

- URL: `https://chatgpt.com/g/g-p-69f810ddfcec8191b7a0d9371ec3ab86-aiduo-ren-ju-qing-tui-yan-aistory/c/6a7f234c-a9c4-83ee-84e7-83e4691eb9bf`
- Mode: ChatGPT Pro normal Chat.
- Exact source base requested: `b6f512442f7e67d6c6d0dcaa2e6449bdd849de44`.
- Allowed files:
  - `apps/api/src/pressure-chapter/game-projection/game-read-mode-selector.ts`
  - `apps/api/src/pressure-chapter/game-projection/game-read-mode-selector.spec.ts`

## Current evidence

The Pro page reports that it read the repository guidance and projection/snapshot contracts, implemented the selector core, and entered repository checkout/verification. No downloadable artifact exists yet. Therefore no implementation, test, or acceptance claim is made.

## Integration gate

M4A may be independently reviewed when its artifact arrives, but it cannot be wired into HTTP or Product Root until:

1. M2 is independently accepted;
2. the corrected M3 is independently accepted;
3. M4A is independently accepted;
4. the task code has been manually adapted to the exact latest `origin/main` backend contracts.
