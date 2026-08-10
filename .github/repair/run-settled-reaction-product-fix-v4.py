from pathlib import Path

source_path = Path(".github/repair/settled-reaction-product-fix-v3.py")
source = source_path.read_text(encoding="utf-8")
old = '''    segment = text[start:end]
    count = segment.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, found {count}")
    target.write_text(
        text[:start] + segment.replace(old, new, 1) + text[end:],
        encoding="utf-8",
    )
'''
new = '''    segment = text[start:end]
    count = segment.count(old)
    if (
        count == 0
        and "settledReactionContract" in segment
        and "unboundActionNarrativeSource" in segment
    ):
        return
    if count != 1:
        raise SystemExit(f"{label}: expected one match, found {count}")
    target.write_text(
        text[:start] + segment.replace(old, new, 1) + text[end:],
        encoding="utf-8",
    )
'''
if source.count(old) != 1:
    raise SystemExit("idempotent function helper marker missing")
patched = source.replace(old, new, 1)
exec(compile(patched, str(source_path), "exec"), {"__name__": "__main__"})
