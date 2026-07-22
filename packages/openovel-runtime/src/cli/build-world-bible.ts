import { writeWorldBible } from "../world-bible-compiler";

const result = writeWorldBible();
console.log(`WORLD_BIBLE_BUILD_PASS reviewGate=${result.worldBible.reviewGate} facts=${result.worldBible.runtimeFacts.length} cards=${result.worldBible.contextCards.length} sourceMap=${result.worldBible.sourceMap.length} path=${result.worldBiblePath}`);
