from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path


def _parse_trait_recenter(raw: str) -> dict[str, dict[str, float]]:
    """Parse TRAIT_RECENTER_JSON: {traitId: {"threshold": float, "scale": float}}.

    Overrides the artifact's decisionThreshold/scoreScale per trait so the
    scoring center can be recalibrated on live traffic without rebuilding
    the image. Both keys are required per entry; scale must be positive.
    """
    if not raw.strip():
        return {}
    parsed = json.loads(raw)
    if not isinstance(parsed, dict):
        raise RuntimeError("TRAIT_RECENTER_JSON must be a JSON object.")
    overrides: dict[str, dict[str, float]] = {}
    for trait_id, entry in parsed.items():
        if not isinstance(entry, dict) or set(entry) != {"threshold", "scale"}:
            raise RuntimeError(
                f"TRAIT_RECENTER_JSON entry for {trait_id!r} must contain "
                "exactly 'threshold' and 'scale'."
            )
        threshold = float(entry["threshold"])
        scale = float(entry["scale"])
        if scale <= 0.0:
            raise RuntimeError(
                f"TRAIT_RECENTER_JSON scale for {trait_id!r} must be positive."
            )
        overrides[str(trait_id)] = {"threshold": threshold, "scale": scale}
    return overrides


@dataclass(frozen=True)
class Settings:
    api_key: str
    vector_dir: Path
    model_id: str
    model_revision: str
    max_sequence_tokens: int
    trait_recenter: dict[str, dict[str, float]]

    @classmethod
    def from_env(cls) -> "Settings":
        api_key = os.environ.get("GEMMA_API_KEY", "").strip()
        if len(api_key) < 32:
            raise RuntimeError(
                "GEMMA_API_KEY must be configured with at least 32 characters."
            )
        max_tokens = int(os.environ.get("MAX_SEQUENCE_TOKENS", "2048"))
        if not 256 <= max_tokens <= 8192:
            raise RuntimeError("MAX_SEQUENCE_TOKENS must be between 256 and 8192.")
        return cls(
            api_key=api_key,
            vector_dir=Path(os.environ.get("VECTOR_DIR", "/app/artifacts")),
            model_id=os.environ.get("MODEL_ID", "google/gemma-4-12B-it"),
            model_revision=os.environ.get(
                "MODEL_REVISION",
                "707f0a3b8a3c7ad586ed01e27eafbad8a27dd0f7",
            ),
            max_sequence_tokens=max_tokens,
            trait_recenter=_parse_trait_recenter(
                os.environ.get("TRAIT_RECENTER_JSON", "")
            ),
        )
