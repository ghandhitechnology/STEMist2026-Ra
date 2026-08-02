#!/usr/bin/env python3
"""Convert the notebook's trusted PyTorch packages into a safe serving bundle.

The source files are torch.save ZIP archives. This converter never invokes
torch.load and only permits the exact pickle globals used by tensor metadata.
It copies the F16 tensor storage bytes into a safetensors file and writes all
non-tensor metadata as JSON.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import math
import pickle
import struct
import zipfile
from collections import OrderedDict
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


TRAIT_ORDER = [
    "factual_hallucinatory",
    "serious_funny",
    "casual_formal",
    "creative_empirical",
    "honest_sycophantic",
    "confident_unsure",
    "empathetic_unempathetic",
    "calm_anxious",
]

TRAIT_IDS = {
    "factual_hallucinatory": "factual",
    "serious_funny": "serious",
    "casual_formal": "casual",
    "creative_empirical": "creative",
    "honest_sycophantic": "honest",
    "confident_unsure": "confident",
    "empathetic_unempathetic": "empathetic",
    "calm_anxious": "calm",
}


@dataclass(frozen=True)
class TensorRef:
    storage_key: str
    storage_count: int
    offset: int
    shape: tuple[int, ...]
    stride: tuple[int, ...]


class _HalfStorage:
    pass


def _rebuild_tensor(
    storage: dict[str, Any],
    offset: int,
    shape: tuple[int, ...],
    stride: tuple[int, ...],
    _requires_grad: bool,
    _hooks: Any,
) -> TensorRef:
    return TensorRef(
        storage_key=str(storage["key"]),
        storage_count=int(storage["count"]),
        offset=int(offset),
        shape=tuple(int(value) for value in shape),
        stride=tuple(int(value) for value in stride),
    )


class _RestrictedTorchUnpickler(pickle.Unpickler):
    """Unpickler that blocks every executable global except known builders."""

    def find_class(self, module: str, name: str) -> Any:
        allowed = {
            ("torch._utils", "_rebuild_tensor_v2"): _rebuild_tensor,
            ("torch", "HalfStorage"): _HalfStorage,
            ("collections", "OrderedDict"): OrderedDict,
        }
        try:
            return allowed[(module, name)]
        except KeyError as exc:
            raise pickle.UnpicklingError(
                f"blocked unexpected pickle global {module}.{name}"
            ) from exc

    def persistent_load(self, persistent_id: Any) -> dict[str, Any]:
        if (
            isinstance(persistent_id, tuple)
            and len(persistent_id) == 5
            and persistent_id[0] == "storage"
            and persistent_id[1] is _HalfStorage
            and persistent_id[3] == "cpu"
        ):
            return {
                "key": persistent_id[2],
                "count": persistent_id[4],
            }
        raise pickle.UnpicklingError(
            f"unsupported tensor storage reference: {persistent_id!r}"
        )


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _read_package(path: Path) -> tuple[dict[str, Any], dict[str, bytes]]:
    with zipfile.ZipFile(path) as archive:
        pickle_name = next(
            (name for name in archive.namelist() if name.endswith("/data.pkl")),
            None,
        )
        if not pickle_name:
            raise ValueError(f"{path.name}: missing data.pkl")
        prefix = pickle_name[: -len("data.pkl")]
        byteorder_name = prefix + "byteorder"
        if archive.read(byteorder_name).decode("ascii").strip() != "little":
            raise ValueError(f"{path.name}: only little-endian tensor data is supported")

        package = _RestrictedTorchUnpickler(
            io.BytesIO(archive.read(pickle_name))
        ).load()
        tensor_bytes: dict[str, bytes] = {}
        for tensor_name in ("raw_vector", "unit_vector"):
            ref = package.get(tensor_name)
            if not isinstance(ref, TensorRef):
                raise ValueError(f"{path.name}: {tensor_name} is not a tensor")
            if ref.offset != 0 or ref.stride != (1,) or len(ref.shape) != 1:
                raise ValueError(f"{path.name}: unsupported non-contiguous vector")
            raw = archive.read(prefix + "data/" + ref.storage_key)
            expected_bytes = math.prod(ref.shape) * 2
            if len(raw) != expected_bytes or ref.storage_count != ref.shape[0]:
                raise ValueError(f"{path.name}: malformed {tensor_name} storage")
            tensor_bytes[tensor_name] = raw
        return package, tensor_bytes


def _f16_norm(raw: bytes) -> float:
    values = struct.unpack("<" + "e" * (len(raw) // 2), raw)
    return math.sqrt(sum(float(value) ** 2 for value in values))


def _write_safetensors(path: Path, tensors: dict[str, tuple[list[int], bytes]]) -> None:
    header: dict[str, Any] = {
        "__metadata__": {
            "format": "pt",
            "schema": "rauchat-gemma-trait-v1",
        }
    }
    offset = 0
    payload = bytearray()
    for name, (shape, raw) in tensors.items():
        header[name] = {
            "dtype": "F16",
            "shape": shape,
            "data_offsets": [offset, offset + len(raw)],
        }
        payload.extend(raw)
        offset += len(raw)

    encoded = json.dumps(header, separators=(",", ":")).encode("utf-8")
    encoded += b" " * ((8 - len(encoded) % 8) % 8)
    path.write_bytes(struct.pack("<Q", len(encoded)) + encoded + payload)


def convert(source: Path, metrics_path: Path, output: Path) -> None:
    packages: dict[str, tuple[Path, dict[str, Any], dict[str, bytes]]] = {}
    for path in sorted(source.glob("*__shared_layer_*__*.pt")):
        package, tensors = _read_package(path)
        trait = str(package.get("trait", ""))
        if trait in packages:
            raise ValueError(f"duplicate package for trait {trait}")
        packages[trait] = (path, package, tensors)

    missing = [trait for trait in TRAIT_ORDER if trait not in packages]
    extras = sorted(set(packages) - set(TRAIT_ORDER))
    if missing or extras:
        raise ValueError(f"trait package mismatch; missing={missing}, extras={extras}")

    shared_fields = (
        "model_id",
        "model_revision",
        "run_mode",
        "activation_context",
        "judge_model",
        "judge_prompt_version",
        "judge_passes",
        "judge_reasoning_effort",
        "layer",
    )
    common: dict[str, Any] = {}
    for field in shared_fields:
        values = {packages[trait][1].get(field) for trait in TRAIT_ORDER}
        if len(values) != 1:
            raise ValueError(f"packages disagree on {field}: {values}")
        common[field] = values.pop()

    hidden_sizes = {
        packages[trait][1]["unit_vector"].shape[0] for trait in TRAIT_ORDER
    }
    if len(hidden_sizes) != 1:
        raise ValueError(f"packages disagree on hidden size: {hidden_sizes}")
    hidden_size = hidden_sizes.pop()

    metrics = json.loads(metrics_path.read_text(encoding="utf-8"))
    metrics_by_trait = {entry["trait"]: entry for entry in metrics}
    if set(metrics_by_trait) != set(TRAIT_ORDER):
        raise ValueError("shared metrics do not contain exactly the eight traits")

    axes: list[dict[str, Any]] = []
    raw_rows: list[bytes] = []
    unit_rows: list[bytes] = []
    source_files: list[dict[str, str]] = []
    for trait in TRAIT_ORDER:
        path, package, tensors = packages[trait]
        norm = _f16_norm(tensors["unit_vector"])
        if not 0.998 <= norm <= 1.002:
            raise ValueError(f"{path.name}: unit-vector norm is {norm}")
        package_metrics = package["metrics"]
        if int(package_metrics["layer"]) != int(common["layer"]):
            raise ValueError(f"{path.name}: metric layer does not match package layer")
        if int(metrics_by_trait[trait]["n_test"]) != int(package_metrics["n_test"]):
            raise ValueError(f"{path.name}: shared metrics do not match package metrics")

        axes.append(
            {
                "trait": trait,
                "traitId": TRAIT_IDS[trait],
                "positiveLabel": package["positive_label"],
                "negativeLabel": package["negative_label"],
                "decisionThreshold": package["decision_threshold"],
                "scoreScale": package["score_scale"],
                "calibratorCoef": package["calibrator_coef"],
                "calibratorIntercept": package["calibrator_intercept"],
                "unitVectorNormF16": norm,
                "metrics": metrics_by_trait[trait],
            }
        )
        raw_rows.append(tensors["raw_vector"])
        unit_rows.append(tensors["unit_vector"])
        source_files.append({"name": path.name, "sha256": _sha256(path)})

    output.mkdir(parents=True, exist_ok=True)
    tensor_path = output / "vectors.safetensors"
    _write_safetensors(
        tensor_path,
        {
            "raw_vectors": ([len(TRAIT_ORDER), hidden_size], b"".join(raw_rows)),
            "unit_vectors": ([len(TRAIT_ORDER), hidden_size], b"".join(unit_rows)),
        },
    )

    layer = int(common["layer"])
    activation_context = str(common["activation_context"])
    warnings = []
    if activation_context != "neutral":
        warnings.append(
            "Vectors were fitted from original contrastive prompt contexts; "
            "treat cross-model projections as provisional until a neutral-context "
            "bundle passes the same held-out gates."
        )
    if int(common["judge_passes"]) < 3:
        warnings.append(
            "Judge stability used fewer than the notebook's recommended three final passes."
        )

    metadata = {
        "schemaVersion": 1,
        "vectorBuild": f"{common['run_mode']}-{activation_context}-layer-{layer}",
        "modelId": common["model_id"],
        "modelRevision": common["model_revision"],
        "runMode": common["run_mode"],
        "activationContext": activation_context,
        "sharedLayer": layer,
        "hiddenSize": hidden_size,
        "projectionRank": len(TRAIT_ORDER),
        "judge": {
            "model": common["judge_model"],
            "promptVersion": common["judge_prompt_version"],
            "passes": common["judge_passes"],
            "reasoningEffort": common["judge_reasoning_effort"],
        },
        "runtime": {
            "scoreMethod": "tanh((rawProjection - decisionThreshold) / scoreScale)",
            "confidenceMethod": "absolute signed score",
            "responsePooling": "mean over assistant response tokens",
        },
        "axes": axes,
        "warnings": warnings,
        "sourceFiles": source_files,
        "tensorFile": {
            "name": tensor_path.name,
            "sha256": _sha256(tensor_path),
        },
        "convertedAtUtc": datetime.now(timezone.utc).isoformat(),
    }
    (output / "metadata.json").write_text(
        json.dumps(metadata, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--metrics", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    convert(args.source, args.metrics, args.output)


if __name__ == "__main__":
    main()
