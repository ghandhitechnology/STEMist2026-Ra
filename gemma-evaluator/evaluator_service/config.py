from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path


def _parse_recenter_table(
    label: str, parsed: object
) -> dict[str, dict[str, float]]:
    """Validate one {traitId: {"threshold": float, "scale": float}} table."""
    if not isinstance(parsed, dict):
        raise RuntimeError(f"TRAIT_RECENTER_JSON {label} must be a JSON object.")
    overrides: dict[str, dict[str, float]] = {}
    for trait_id, entry in parsed.items():
        if not isinstance(entry, dict) or set(entry) != {"threshold", "scale"}:
            raise RuntimeError(
                f"TRAIT_RECENTER_JSON {label} entry for {trait_id!r} must "
                "contain exactly 'threshold' and 'scale'."
            )
        threshold = float(entry["threshold"])
        scale = float(entry["scale"])
        if scale <= 0.0:
            raise RuntimeError(
                f"TRAIT_RECENTER_JSON {label} scale for {trait_id!r} must be "
                "positive."
            )
        overrides[str(trait_id)] = {"threshold": threshold, "scale": scale}
    return overrides


def _parse_trait_recenter(raw: str) -> dict[str, object]:
    """Parse TRAIT_RECENTER_JSON into {"default": table, "models": {id: table}}.

    Two accepted shapes, so the scoring center can be recalibrated on live
    traffic without rebuilding the image:

      flat (back-compat)  {traitId: {"threshold": ..., "scale": ...}}
      keyed               {"default": <table>, "models": {<modelId>: <table>}}

    The keyed form lets each chat model carry its own calibration; /project
    selects a model table by exact id and falls back to "default".
    """
    if not raw.strip():
        return {"default": {}, "models": {}}
    parsed = json.loads(raw)
    if not isinstance(parsed, dict):
        raise RuntimeError("TRAIT_RECENTER_JSON must be a JSON object.")
    if not parsed or not ({"default", "models"} & set(parsed)):
        return {"default": _parse_recenter_table("table", parsed), "models": {}}
    if set(parsed) - {"default", "models"}:
        raise RuntimeError(
            "TRAIT_RECENTER_JSON keyed form allows only 'default' and 'models'."
        )
    models_raw = parsed.get("models", {})
    if not isinstance(models_raw, dict):
        raise RuntimeError("TRAIT_RECENTER_JSON 'models' must be an object.")
    return {
        "default": _parse_recenter_table("default", parsed.get("default", {})),
        "models": {
            str(model_id): _parse_recenter_table(f"models[{model_id}]", table)
            for model_id, table in models_raw.items()
        },
    }


@dataclass(frozen=True)
class Settings:
    api_key: str
    vector_dir: Path
    model_id: str
    model_revision: str
    max_sequence_tokens: int
    trait_recenter: dict[str, object]

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
