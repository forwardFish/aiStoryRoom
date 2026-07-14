"""Compare current payment screenshots against the approved v1.4 references.

This is an evidence tool, not a screenshot generator: it never changes the
product and it marks a run REPAIR_REQUIRED until the documented threshold is
met.  Run the browser credit-pages flow first so every actual file is fresh.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parents[2]
REFERENCE_DIR = ROOT / "docs" / "UI" / "web"
ACTUAL_DIR = ROOT / "docs" / "auto-execute" / "evidence" / "many-worlds-v14" / "browser-credit-pages"
OUTPUT = ACTUAL_DIR / "visual-metrics.json"
ACTUAL_NAMES = {
    "02": "pay-02-wallet.png",
    "03": "pay-03-confirm.png",
    "04": "pay-04-processing.png",
    "05": "pay-05-paid.png",
    "06": "pay-06-cancelled.png",
    "07": "pay-07-failed.png",
}
MAX_CHANGED_RATIO = 0.015


def compare(reference: Path, actual: Path) -> dict[str, object]:
    expected = np.asarray(Image.open(reference).convert("RGB"), dtype=np.int16)
    observed = np.asarray(Image.open(actual).convert("RGB"), dtype=np.int16)
    same_size = expected.shape == observed.shape
    height, width = min(expected.shape[0], observed.shape[0]), min(expected.shape[1], observed.shape[1])
    delta = np.abs(expected[:height, :width] - observed[:height, :width])
    changed_ratio = float((delta.max(axis=2) > 12).mean())
    return {
        "reference": str(reference.relative_to(ROOT)).replace("\\", "/"),
        "actual": str(actual.relative_to(ROOT)).replace("\\", "/"),
        "referenceSize": [int(expected.shape[1]), int(expected.shape[0])],
        "actualSize": [int(observed.shape[1]), int(observed.shape[0])],
        "sameSize": same_size,
        "changedRatioOver12": changed_ratio,
        "meanAbsoluteError": float(delta.mean()),
        "status": "PASS" if same_size and changed_ratio <= MAX_CHANGED_RATIO else "REPAIR_REQUIRED",
    }


def main() -> None:
    pages: dict[str, dict[str, object]] = {}
    for reference in sorted(REFERENCE_DIR.glob("MW-60_PAY-*.png")):
        match = re.search(r"PAY-(\d+)", reference.name)
        if not match or match.group(1) not in ACTUAL_NAMES:
            continue
        actual = ACTUAL_DIR / ACTUAL_NAMES[match.group(1)]
        if not actual.exists():
            raise FileNotFoundError(f"Missing browser evidence: {actual}")
        pages[f"PAY-{match.group(1)}"] = compare(reference, actual)

    payload = {
        "status": "PASS" if pages and all(page["status"] == "PASS" for page in pages.values()) else "REPAIR_REQUIRED",
        "thresholds": {"changedRatioOver12": MAX_CHANGED_RATIO},
        "pages": pages,
    }
    OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(payload, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
