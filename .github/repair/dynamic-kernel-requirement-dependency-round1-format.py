from pathlib import Path

path = Path("packages/templates/tests/part-one-dynamic-kernel-lite.test.ts")
text = path.read_text(encoding="utf-8")
path.write_text(text.rstrip() + "\n", encoding="utf-8")
