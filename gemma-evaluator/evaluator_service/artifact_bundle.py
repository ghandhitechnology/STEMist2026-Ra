from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import torch
from safetensors.torch import load_file


@dataclass(frozen=True)
class AxisMetadata:
    trait: str
    trait_id: str
    positive_label: str
    negative_label: str
    decision_threshold: float
    score_scale: float


@dataclass(frozen=True)
class ArtifactBundle:
    metadata: dict[str, Any]
    axes: tuple[AxisMetadata, ...]
    unit_vectors: torch.Tensor

    @property
    def model_id(self) -> str:
        return str(self.metadata["modelId"])

    @property
    def model_revision(self) -> str:
        return str(self.metadata["modelRevision"])

    @property
    def shared_layer(self) -> int:
        return int(self.metadata["sharedLayer"])

    @property
    def vector_build(self) -> str:
        return str(self.metadata["vectorBuild"])

    @property
    def activation_context(self) -> str:
        return str(self.metadata["activationContext"])

    @property
    def warnings(self) -> list[str]:
        return [str(item) for item in self.metadata.get("warnings", [])]

    @classmethod
    def load(cls, directory: Path) -> "ArtifactBundle":
        metadata_path = directory / "metadata.json"
        tensor_path = directory / "vectors.safetensors"
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        if metadata.get("schemaVersion") != 1:
            raise RuntimeError("Unsupported vector artifact schema.")
        expected_hash = metadata.get("tensorFile", {}).get("sha256")
        if not expected_hash or _sha256(tensor_path) != expected_hash:
            raise RuntimeError("Vector artifact checksum mismatch.")

        tensors = load_file(tensor_path, device="cpu")
        unit_vectors = tensors.get("unit_vectors")
        projection_rank = int(metadata["projectionRank"])
        hidden_size = int(metadata["hiddenSize"])
        if unit_vectors is None or tuple(unit_vectors.shape) != (
            projection_rank,
            hidden_size,
        ):
            raise RuntimeError("Vector artifact has an invalid unit-vector shape.")
        norms = torch.linalg.vector_norm(unit_vectors.float(), dim=1)
        if not torch.allclose(norms, torch.ones_like(norms), atol=0.002, rtol=0):
            raise RuntimeError("Vector artifact contains non-unit projection vectors.")

        raw_axes = metadata.get("axes")
        if not isinstance(raw_axes, list) or len(raw_axes) != projection_rank:
            raise RuntimeError("Vector metadata has an invalid axis list.")
        axes = tuple(
            AxisMetadata(
                trait=str(axis["trait"]),
                trait_id=str(axis["traitId"]),
                positive_label=str(axis["positiveLabel"]),
                negative_label=str(axis["negativeLabel"]),
                decision_threshold=float(axis["decisionThreshold"]),
                score_scale=float(axis["scoreScale"]),
            )
            for axis in raw_axes
        )
        if len({axis.trait_id for axis in axes}) != projection_rank:
            raise RuntimeError("Vector metadata contains duplicate trait IDs.")
        if any(axis.score_scale <= 0.0 for axis in axes):
            raise RuntimeError("Vector metadata contains a non-positive score scale.")
        return cls(metadata=metadata, axes=axes, unit_vectors=unit_vectors)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()
