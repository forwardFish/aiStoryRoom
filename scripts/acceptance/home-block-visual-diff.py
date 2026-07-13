"""Real-browser homepage reference comparison split into fixed reference blocks.

The script deliberately compares an actual captured browser screenshot against
the supplied 910x1729 homepage reference.  It never participates in runtime
rendering and cannot mask visual differences in the product UI.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image, ImageChops, ImageStat


ROOT = Path(__file__).resolve().parents[2]
REFERENCE_DIR = ROOT / "docs" / "UI" / "web"
ACTUAL = ROOT / "docs" / "auto-execute" / "screenshots" / "v12-homepage-910x1729.png"
RESULT = ROOT / "docs" / "auto-execute" / "results" / "home-block-visual-diff.json"
DIFF_DIR = ROOT / "docs" / "auto-execute" / "screenshots" / "home-block-diffs"
VIEWPORT = (910, 1729)
MEAN_THRESHOLD = 0.10

# Exact y-ranges from the supplied homepage reference at 910x1729.
BLOCKS = (
    ("header", (0, 0, 910, 58)),
    ("hero", (0, 58, 910, 398)),
    ("world_catalog", (0, 398, 910, 760)),
    ("principles", (0, 760, 910, 905)),
    ("entry_modes", (0, 905, 910, 1111)),
    ("world_flow", (0, 1111, 910, 1229)),
    ("world_builder", (0, 1229, 910, 1382)),
    ("ending_review", (0, 1382, 910, 1548)),
    ("pricing", (0, 1548, 910, 1673)),
    ("footer", (0, 1673, 910, 1729)),
)


def homepage_reference() -> Path:
    candidates = [path for path in REFERENCE_DIR.glob("*.png") if Image.open(path).size == VIEWPORT]
    if len(candidates) != 1:
        raise RuntimeError(f"expected exactly one {VIEWPORT[0]}x{VIEWPORT[1]} homepage reference, got {candidates}")
    return candidates[0]


def block_metrics(reference: Image.Image, actual: Image.Image, bounds: tuple[int, int, int, int]) -> tuple[dict, Image.Image]:
    diff = ImageChops.difference(reference.crop(bounds), actual.crop(bounds))
    mean_ratio = sum(ImageStat.Stat(diff).mean) / (3 * 255)
    luminance = diff.convert("L")
    changed_gt_10 = sum(luminance.histogram()[10:]) / (luminance.width * luminance.height)
    return {
        "meanRgbRatio": round(mean_ratio, 6),
        "changedPixelsGt10Ratio": round(changed_gt_10, 6),
        "threshold": MEAN_THRESHOLD,
        "status": "PASS" if mean_ratio <= MEAN_THRESHOLD else "NEEDS_REPAIR",
    }, diff


def main() -> None:
    reference_path = homepage_reference()
    if not ACTUAL.exists():
        raise RuntimeError(f"missing actual browser screenshot: {ACTUAL}")
    reference = Image.open(reference_path).convert("RGB")
    actual = Image.open(ACTUAL).convert("RGB")
    if reference.size != VIEWPORT or actual.size != VIEWPORT:
        raise RuntimeError(f"expected both images to be {VIEWPORT}, got reference={reference.size}, actual={actual.size}")

    DIFF_DIR.mkdir(parents=True, exist_ok=True)
    rows = []
    for block_id, bounds in BLOCKS:
        metrics, diff = block_metrics(reference, actual, bounds)
        diff_path = DIFF_DIR / f"{block_id}-diff.png"
        diff.save(diff_path)
        rows.append({
            "id": block_id,
            "bounds": {"x": bounds[0], "y": bounds[1], "width": bounds[2] - bounds[0], "height": bounds[3] - bounds[1]},
            **metrics,
            "diffImage": str(diff_path.relative_to(ROOT)).replace("\\", "/"),
        })

    report = {
        "status": "PASS" if all(row["status"] == "PASS" for row in rows) else "NEEDS_REPAIR",
        "method": "Pillow full-pixel RGB absolute difference over exact reference block bounds",
        "reference": str(reference_path.relative_to(ROOT)).replace("\\", "/"),
        "actual": str(ACTUAL.relative_to(ROOT)).replace("\\", "/"),
        "viewport": {"width": VIEWPORT[0], "height": VIEWPORT[1]},
        "blocks": rows,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "note": "PASS means the configured numerical threshold is met; final pixel-perfect completion still requires visual review of each generated diff image.",
    }
    RESULT.parent.mkdir(parents=True, exist_ok=True)
    RESULT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
