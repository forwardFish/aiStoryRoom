#!/usr/bin/env python3
import json
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageStat


def main() -> int:
    if len(sys.argv) != 3:
        raise SystemExit("usage: modal-trigger-visual-diff.py REFERENCE ACTUAL")
    reference_path, actual_path = map(Path, sys.argv[1:])
    reference = Image.open(reference_path).convert("RGB")
    actual = Image.open(actual_path).convert("RGB")
    if reference.size != actual.size:
        result = {"status": "FAIL", "reason": "SIZE_MISMATCH", "referenceSize": reference.size, "actualSize": actual.size}
        print(json.dumps(result, ensure_ascii=False))
        return 1
    difference = ImageChops.difference(reference, actual)
    channel_means = ImageStat.Stat(difference).mean
    normalized_mean = sum(channel_means) / (len(channel_means) * 255.0)
    result = {
        "schemaVersion": "pressure_modal_visual_diff_v1",
        "status": "PASS" if normalized_mean <= 0.08 else "FAIL",
        "normalizedMeanAbsoluteDifference": round(normalized_mean, 6),
        "maximumAllowed": 0.08,
        "reference": str(reference_path),
        "actual": str(actual_path),
    }
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result["status"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
