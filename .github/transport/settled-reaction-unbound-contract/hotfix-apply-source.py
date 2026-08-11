from pathlib import Path
import sys

path = Path(sys.argv[1])
text = path.read_text(encoding="utf-8")
old = '''replace_once(
    engine,
    "  const presentActors = new Set(input.sceneAfter.presentActorRefs);\\n",
    "  const presentActors = new Set(input.reactionScene.presentActorRefs);\\n",
    "reaction builder uses current scene",
)'''
new = '''replace_in_function(
    engine,
    "buildAuthoritativeNpcReactions",
    "buildNarrativePlan",
    "  const presentActors = new Set(input.sceneAfter.presentActorRefs);\\n",
    "  const presentActors = new Set(input.reactionScene.presentActorRefs);\\n",
    "reaction builder uses current scene",
)'''
if text.count(old) != 1:
    raise SystemExit(f"reaction source hotfix marker count={text.count(old)}")
path.write_text(text.replace(old, new, 1), encoding="utf-8")
