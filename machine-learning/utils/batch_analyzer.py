#!/usr/bin/env python3
"""Batch Analyzer script

Invoked by Node.js mlController as:

python batch_analyzer.py <tmp_json_file>

Where the temporary JSON file contains an array of objects, each at minimum
containing a `type` (behaviour type) and `data` payload. The script returns a
JSON object with the following structure (written to stdout):

{
  "success": true,
  "results": [
     { "behavior_type": "eye_gaze", "detected": true, "confidence": 0.87, "label": 1 },
     ...
  ],
  "total_analyzed": 5
}

The placeholder implementation relies on the same random-based detector found
in `ml_analyzer.py` so that the API can be exercised end-to-end even without
trained models.
"""

import json
import os
import sys
from typing import Any, Dict, List

# Reuse single-behaviour predictor from ml_analyzer to ensure identical
# preprocessing/model logic.
from ml_analyzer import _predict  # type: ignore


# ---------------------------------------------------------------------------
# Main entry
# ---------------------------------------------------------------------------


def main() -> None:
    if len(sys.argv) < 2:
        print(json.dumps({"success": False, "error": "Missing data file argument"}))
        sys.exit(1)

    data_file = sys.argv[1]
    if not os.path.exists(data_file):
        print(json.dumps({"success": False, "error": f"File not found: {data_file}"}))
        sys.exit(1)

    try:
        with open(data_file, "r", encoding="utf-8") as fp:
            behaviors: List[Dict[str, Any]] = json.load(fp)
    except Exception as exc:
        print(json.dumps({"success": False, "error": f"Failed to read JSON: {exc}"}))
        sys.exit(1)

    results: List[Dict[str, Any]] = []
    for entry in behaviors:
        b_type = entry.get("type") or entry.get("behavior_type") or entry.get("behaviorType")
        data = entry.get("data") or entry.get("frame_sequence") or entry.get("frame")
        if not b_type:
            # Skip invalid entries but continue processing others
            continue
        single = _predict(b_type, data)
        single["behavior_type"] = b_type
        single["label"] = int(single["detected"])
        results.append(single)

    output = {"success": True, "results": results, "total_analyzed": len(results)}

    sys.stdout.write(json.dumps(output))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        # Any unhandled exception should result in non-zero exit status so that
        # Node.js recognises the failure.
        print(str(exc), file=sys.stderr)
        sys.exit(1) 