"""Compare the approved worlds-lobby reference with a fresh browser capture."""

from __future__ import annotations

import json
import os
from pathlib import Path

from PIL import Image, ImageChops, ImageStat


ROOT = Path(__file__).resolve().parents[2]
REFERENCE = Path(os.environ.get("WORLDS_LOBBY_REFERENCE", ROOT / "docs" / "UI" / "web" / "游戏大厅.png"))
ARTIFACTS = Path(os.environ.get("WORLDS_LOBBY_OUT_DIR", ROOT / ".omx" / "artifacts" / "visual-ralph" / "worlds-lobby"))
ACTUAL = ARTIFACTS / "actual-final.png"
IMAGE_INTERIORS = (
    (45, 147, 533, 367),
    (555, 147, 1043, 367),
    (1065, 147, 1554, 367),
    (45, 545, 533, 759),
    (555, 545, 1043, 759),
    (1065, 545, 1554, 759),
)


def ratio(diff: Image.Image) -> tuple[float, float]:
    mean = sum(ImageStat.Stat(diff).mean) / (3 * 255)
    changed = sum(diff.convert("L").histogram()[10:]) / (diff.width * diff.height)
    return mean, changed


def main() -> None:
    reference = Image.open(REFERENCE).convert("RGB")
    actual = Image.open(ACTUAL).convert("RGB")
    if reference.size != actual.size:
        raise RuntimeError(f"size mismatch: reference={reference.size}, actual={actual.size}")

    raw_diff = ImageChops.difference(reference, actual)
    raw_diff.save(ARTIFACTS / "diff-final.png")
    raw_mean, raw_changed = ratio(raw_diff)

    masked_reference = reference.copy()
    masked_actual = actual.copy()
    for box in IMAGE_INTERIORS:
        masked_reference.paste((255, 255, 255), box)
        masked_actual.paste((255, 255, 255), box)
    masked_diff = ImageChops.difference(masked_reference, masked_actual)
    masked_diff.save(ARTIFACTS / "diff-final-masked.png")
    masked_mean, masked_changed = ratio(masked_diff)

    status = "PASS" if masked_mean <= 0.05 and masked_changed <= 0.25 else "REPAIR_REQUIRED"
    metrics = {
        "status": status,
        "reference": str(REFERENCE.relative_to(ROOT)).replace("\\", "/"),
        "actual": str(ACTUAL.relative_to(ROOT)).replace("\\", "/"),
        "dimensions": {"width": reference.width, "height": reference.height},
        "rawMeanRgbRatio": round(raw_mean, 6),
        "rawChangedPixelsGt10Ratio": round(raw_changed, 6),
        "maskedMeanRgbRatio": round(masked_mean, 6),
        "maskedChangedPixelsGt10Ratio": round(masked_changed, 6),
        "thresholds": {"maxMaskedMeanRgbRatio": 0.05, "maxMaskedChangedPixelsGt10Ratio": 0.25},
        "maskScope": "Six image interiors only; homepage background reuse is explicitly approved by the user.",
    }
    (ARTIFACTS / "metrics-final.json").write_text(json.dumps(metrics, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(metrics))
    if status != "PASS":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
