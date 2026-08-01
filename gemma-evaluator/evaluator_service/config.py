from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    api_key: str
    vector_dir: Path
    model_id: str
    model_revision: str
    max_sequence_tokens: int

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
        )
