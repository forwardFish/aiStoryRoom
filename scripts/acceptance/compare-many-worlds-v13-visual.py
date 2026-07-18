"""Produce reproducible first-party visual comparison evidence for the five new routes.

The script compares only local reference and browser-captured PNG files. It
never serves a reference to the application. A reviewed manifest may mask only
temporary image content; the container border and all layout geometry remain
unmasked.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageChops, ImageStat


ROOT = Path(__file__).resolve().parents[2]
EVIDENCE = ROOT / "docs" / "auto-execute" / "evidence" / "many-worlds-v13" / "visual"
MASK_MANIFEST = ROOT / "scripts" / "acceptance" / "many-worlds-v13-image-mask.json"
VISUAL_IDS = ("VT-NEW-001", "VT-NEW-002", "VT-NEW-003", "VT-NEW-004", "VT-NEW-005")
MAX_CHANGED_RATIO = 0.015
MIN_SSIM = 0.985


def ssim(reference: np.ndarray, actual: np.ndarray) -> float:
    ref = cv2.cvtColor(reference, cv2.COLOR_RGB2GRAY).astype(np.float64)
    act = cv2.cvtColor(actual, cv2.COLOR_RGB2GRAY).astype(np.float64)
    mu_ref = cv2.GaussianBlur(ref, (11, 11), 1.5)
    mu_act = cv2.GaussianBlur(act, (11, 11), 1.5)
    sigma_ref = cv2.GaussianBlur(ref * ref, (11, 11), 1.5) - mu_ref * mu_ref
    sigma_act = cv2.GaussianBlur(act * act, (11, 11), 1.5) - mu_act * mu_act
    sigma_cross = cv2.GaussianBlur(ref * act, (11, 11), 1.5) - mu_ref * mu_act
    c1, c2 = 6.5025, 58.5225
    score = ((2 * mu_ref * mu_act + c1) * (2 * sigma_cross + c2)) / ((mu_ref * mu_ref + mu_act * mu_act + c1) * (sigma_ref + sigma_act + c2))
    return float(np.clip(score.mean(), -1, 1))


def load_masks() -> dict[str, list[list[int]]]:
    if not MASK_MANIFEST.exists():
        return {}
    raw = json.loads(MASK_MANIFEST.read_text(encoding="utf-8"))
    pages = raw.get("pages", {}) if isinstance(raw, dict) else {}
    return {str(key): value for key, value in pages.items() if isinstance(value, list)}


MASKS = load_masks()


def masked_images(reference: Image.Image, actual: Image.Image, rectangles: list[list[int]]) -> tuple[Image.Image, Image.Image, Image.Image, int]:
    """Mask only the supplied content rects, leaving each container edge visible."""
    ref_array = np.asarray(reference, dtype=np.uint8).copy()
    actual_array = np.asarray(actual, dtype=np.uint8).copy()
    mask = np.zeros((reference.height, reference.width), dtype=bool)
    for raw_rect in rectangles:
        if not isinstance(raw_rect, list) or len(raw_rect) != 4:
            raise RuntimeError(f"invalid mask rectangle: {raw_rect}")
        x, y, width, height = (int(value) for value in raw_rect)
        if x < 0 or y < 0 or width <= 0 or height <= 0 or x + width > reference.width or y + height > reference.height:
            raise RuntimeError(f"mask rectangle outside viewport: {raw_rect}")
        mask[y:y + height, x:x + width] = True
    # Substitute the same neutral RGB value into both images. This excludes
    # only pixels declared in the reviewed manifest; all other pixels retain
    # their exact, raw comparison.
    ref_array[mask] = (255, 255, 255)
    actual_array[mask] = (255, 255, 255)
    raw_diff = ImageChops.difference(reference, actual)
    diff_array = np.asarray(raw_diff, dtype=np.uint8).copy()
    diff_array[mask] = (0, 0, 0)
    return Image.fromarray(ref_array), Image.fromarray(actual_array), Image.fromarray(diff_array), int(mask.sum())


def compare(visual_id: str) -> dict:
    directory = EVIDENCE / visual_id
    reference_path = directory / "reference.png"
    actual_path = directory / "actual.png"
    if not reference_path.exists() or not actual_path.exists():
        raise RuntimeError(f"{visual_id} is missing reference or actual")
    reference = Image.open(reference_path).convert("RGB")
    actual = Image.open(actual_path).convert("RGB")
    if reference.size != actual.size:
        raise RuntimeError(f"{visual_id} dimensions differ: reference={reference.size}, actual={actual.size}")
    rectangles = MASKS.get(visual_id, [])
    masked_reference, masked_actual, diff, masked_pixel_count = masked_images(reference, actual, rectangles)
    luminance = np.asarray(diff.convert("L"), dtype=np.uint8)
    changed = float((luminance > 10).sum() / luminance.size)
    mean = float(sum(ImageStat.Stat(diff).mean) / (3 * 255))
    ref_array = np.asarray(masked_reference, dtype=np.uint8)
    actual_array = np.asarray(masked_actual, dtype=np.uint8)
    score = ssim(ref_array, actual_array)
    diff_path = directory / "diff.png"
    diff.save(diff_path)
    status = "PASS" if score >= MIN_SSIM and changed <= MAX_CHANGED_RATIO else "REPAIR_REQUIRED"
    metrics = {
        "visualId": visual_id,
        "status": status,
        "comparisonMethod": "Pillow exact-dimension RGB difference plus 11x11 Gaussian-window SSIM; reviewed temporary-image content mask applied while image container geometry remains unmasked",
        "reference": "reference.png",
        "actual": "actual.png",
        "diff": "diff.png",
        "dimensions": {"width": reference.width, "height": reference.height},
        "ssim": round(score, 6),
        "minSsim": MIN_SSIM,
        "changedPixelsGt10Ratio": round(changed, 6),
        "maxChangedPixelsGt10Ratio": MAX_CHANGED_RATIO,
        "meanRgbDifferenceRatio": round(mean, 6),
        "imageMask": {
            "status": "APPLIED" if rectangles else "NOT_REQUIRED",
            "manifest": str(MASK_MANIFEST.relative_to(ROOT)).replace("\\", "/"),
            "rectangleCount": len(rectangles),
            "maskedPixelCount": masked_pixel_count,
            "maskedPixelRatio": round(masked_pixel_count / (reference.width * reference.height), 6),
            "scope": "temporary image content only; container border, radius, size and position remain compared"
        },
        "generatedAt": datetime.now(timezone.utc).isoformat(),
    }
    (directory / "metrics.json").write_text(json.dumps(metrics, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return metrics


def main() -> None:
    pages = [compare(visual_id) for visual_id in VISUAL_IDS]
    report = {
        "status": "PASS" if all(page["status"] == "PASS" for page in pages) else "REPAIR_REQUIRED",
        "thresholds": {"minSsim": MIN_SSIM, "maxChangedPixelsGt10Ratio": MAX_CHANGED_RATIO},
        "pages": pages,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
    }
    (EVIDENCE / "visual-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
