import { generateForegroundOptions } from "../lib/narrator.js"
import { postNarrationParallel } from "./postNarrationParallel.js"

let registered = false

export function registerDefaultPostNarrationParallel() {
  if (registered) return postNarrationParallel
  registered = true

  postNarrationParallel.register({
    id: "options",
    isDisabled: ({ ablations = {}, optionsEnabled = true }) => !optionsEnabled || !!ablations.disableOptions,
    run: ({ action, narration, compiledContext, snapshot }) =>
      generateForegroundOptions({ action, narration, compiledContext, snapshot }),
    fallback: ({ disabled }) => disabled
      ? { options: [], tension: "reader-directed", storyComplete: false, source: "disabled" }
      : { options: [], tension: "unknown", storyComplete: false, source: "error" },
  })

  return postNarrationParallel
}
