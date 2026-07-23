export type SoloStoryPreview = {
  title: string;
  text: string;
};

/**
 * Narrator streaming is plain prose. The preview is non-canonical and is
 * replaced only after both provider stages pass and the turn publishes.
 */
export function extractStoryPreview(rawProse: string): SoloStoryPreview | null {
  const text = String(rawProse || "").replace(/\r\n/g, "\n").trimStart();
  if (!text || /^\s*[\[{]/.test(text) || /^```/.test(text)) return null;
  return { title: "", text };
}
