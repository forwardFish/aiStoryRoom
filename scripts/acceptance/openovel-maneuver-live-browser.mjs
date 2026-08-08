import { installLegacyWhichChromeResolver } from "./chrome-binary-resolver.mjs";

// Keep the browser journey unchanged and adapt only its legacy Unix `which`
// lookup. The adapter resolves Chrome/Edge with platform-native rules and is
// restored as soon as the acceptance journey completes.
const restoreChromeResolver = installLegacyWhichChromeResolver();

try {
  await import("./openovel-maneuver-live-browser-core.mjs");
} finally {
  restoreChromeResolver();
}
