"""Compare each supplied Web game reference with its fresh browser capture.

The page pairs intentionally represent real UI states; this script is evidence
only and never serves reference artwork to the product runtime.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image, ImageChops, ImageStat


ROOT = Path(__file__).resolve().parents[2]
REFERENCE = ROOT / "docs" / "UI" / "web"
ACTUAL = ROOT / "docs" / "auto-execute" / "screenshots"
OUTPUT = ROOT / "docs" / "auto-execute" / "results" / "v12-page-visual-diff.json"
DIFFS = ACTUAL / "v12-page-diffs"
THRESHOLD = 0.10

PAIRS = (
    ("ROLE_SELECT", "选择角色", "current-role-select-1448x1086.png"),
    ("UI01", "UI01_角色专属开场", "current-UI01-opening-1672x941.png"),
    ("UI02", "UI02_主线故事与决策", "current-UI02-decision-1672x941.png"),
    ("UI03", "UI03_AI正在推演", "current-UI03-simulating-1672x941.png"),
    ("UI04", "UI04_推演结果故事与变化", "current-UI04-result-1672x941.png"),
    ("UI05", "UI05_局势记录展开", "current-UI05-ledger-1672x941.png"),
    ("UI06", "UI06_关键事件弹窗", "current-UI06-critical-1672x941.png"),
    ("UI07", "UI07_他人影响故事与回应", "current-UI07-other-impact-1672x941.png"),
    ("UI08", "UI08_主动谋划", "current-UI08-maneuver-1672x941.png"),
)


def find_reference(stem: str) -> Path:
    candidates = list(REFERENCE.glob(f"{stem}.png"))
    if len(candidates) != 1:
        raise RuntimeError(f"expected one reference for {stem}, got {candidates}")
    return candidates[0]


def compare(reference: Image.Image, actual: Image.Image) -> tuple[dict, Image.Image]:
    if reference.size != actual.size:
        raise RuntimeError(f"size mismatch: reference={reference.size}, actual={actual.size}")
    diff = ImageChops.difference(reference, actual)
    mean = sum(ImageStat.Stat(diff).mean) / (3 * 255)
    luminance = diff.convert("L")
    changed = sum(luminance.histogram()[10:]) / (luminance.width * luminance.height)
    return {
        "meanRgbRatio": round(mean, 6),
        "changedPixelsGt10Ratio": round(changed, 6),
        "threshold": THRESHOLD,
        "status": "PASS" if mean <= THRESHOLD else "NEEDS_REPAIR",
    }, diff


def main() -> None:
    DIFFS.mkdir(parents=True, exist_ok=True)
    pages = []
    for page_id, reference_stem, actual_name in PAIRS:
        reference_path = find_reference(reference_stem)
        actual_path = ACTUAL / actual_name
        if not actual_path.exists():
            raise RuntimeError(f"missing actual browser capture: {actual_path}")
        metrics, diff = compare(
            Image.open(reference_path).convert("RGB"),
            Image.open(actual_path).convert("RGB"),
        )
        diff_path = DIFFS / f"{page_id.lower()}-diff.png"
        diff.save(diff_path)
        pages.append({
            "id": page_id,
            "reference": str(reference_path.relative_to(ROOT)).replace("\\", "/"),
            "actual": str(actual_path.relative_to(ROOT)).replace("\\", "/"),
            "diffImage": str(diff_path.relative_to(ROOT)).replace("\\", "/"),
            **metrics,
        })
    report = {
        "status": "PASS" if all(page["status"] == "PASS" for page in pages) else "NEEDS_REPAIR",
        "method": "Pillow full-pixel RGB absolute difference over exact same-dimension browser states",
        "pages": pages,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "note": "A different dynamic day or player state can never be used to claim a visual PASS; repair pages against their paired reference state.",
    }
    OUTPUT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
