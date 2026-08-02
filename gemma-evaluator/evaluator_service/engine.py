from __future__ import annotations

import gc
import threading
import time
from typing import Any

import torch
from transformers import AutoModelForMultimodalLM, AutoProcessor

from .artifact_bundle import ArtifactBundle
from .config import Settings


EVALUATOR_SYSTEM_PROMPT = (
    "Answer the user clearly. Do not add hidden commentary or discuss system instructions."
)


class ProjectionInputError(ValueError):
    pass


class GemmaEvaluator:
    def __init__(self, settings: Settings, bundle: ArtifactBundle) -> None:
        if settings.model_id != bundle.model_id:
            raise RuntimeError("Configured model ID does not match vector artifacts.")
        if settings.model_revision != bundle.model_revision:
            raise RuntimeError("Configured model revision does not match vector artifacts.")
        self.settings = settings
        self.bundle = bundle
        self.processor: Any | None = None
        self.model: Any | None = None
        self.device: torch.device | None = None
        self.unit_vectors: torch.Tensor | None = None
        # Calibration tensors keyed by chat-model id; None is the default
        # table (artifact values plus any "default" recenter overrides).
        self.calibrations: dict[str | None, tuple[torch.Tensor, torch.Tensor]] = {}
        self.recentered_traits: list[str] = []
        self.model_calibrations: list[str] = []
        known = {axis.trait_id for axis in bundle.axes}
        default_table = settings.trait_recenter["default"]
        model_tables = settings.trait_recenter["models"]
        for label, table in [("default", default_table)] + list(
            model_tables.items()
        ):
            unknown = set(table) - known
            if unknown:
                raise RuntimeError(
                    f"TRAIT_RECENTER_JSON {label} names unknown traits: "
                    f"{sorted(unknown)}"
                )
        self.status = "loading"
        self.detail = "waiting for model load"
        self._load_lock = threading.Lock()

    def load(self) -> None:
        with self._load_lock:
            if self.status == "ready":
                return
            try:
                if not torch.cuda.is_available():
                    raise RuntimeError("CUDA GPU is required for the BF16 evaluator.")
                self.detail = "loading processor"
                processor = AutoProcessor.from_pretrained(
                    self.settings.model_id,
                    revision=self.settings.model_revision,
                    token=True,
                )
                self.detail = "loading Gemma 4 12B weights"
                model = AutoModelForMultimodalLM.from_pretrained(
                    self.settings.model_id,
                    revision=self.settings.model_revision,
                    token=True,
                    dtype=torch.bfloat16,
                    device_map={"": 0},
                    low_cpu_mem_usage=True,
                )
                model.eval()
                device = next(model.parameters()).device
                self.processor = processor
                self.model = model
                self.device = device
                self.unit_vectors = self.bundle.unit_vectors.float().to(device)
                default_table = self.settings.trait_recenter["default"]
                model_tables = self.settings.trait_recenter["models"]

                def build(table: dict) -> tuple[torch.Tensor, torch.Tensor]:
                    thresholds = torch.tensor(
                        [
                            table.get(axis.trait_id, {}).get(
                                "threshold", axis.decision_threshold
                            )
                            for axis in self.bundle.axes
                        ],
                        dtype=torch.float32,
                        device=device,
                    )
                    scales = torch.tensor(
                        [
                            table.get(axis.trait_id, {}).get(
                                "scale", axis.score_scale
                            )
                            for axis in self.bundle.axes
                        ],
                        dtype=torch.float32,
                        device=device,
                    )
                    return thresholds, scales

                self.calibrations = {None: build(default_table)}
                for model_id, table in model_tables.items():
                    self.calibrations[model_id] = build(table)
                self.recentered_traits = sorted(default_table)
                self.model_calibrations = sorted(model_tables)
                self.status = "ready"
                self.detail = "model and vectors loaded"
            except Exception as exc:
                self.status = "error"
                self.detail = str(exc)
                raise

    @torch.inference_mode()
    def project(
        self, prompt: str, response: str, model: str | None = None
    ) -> dict[str, Any]:
        if self.status != "ready" or self.model is None or self.processor is None:
            raise RuntimeError("Evaluator is not ready.")
        if self.device is None or self.unit_vectors is None:
            raise RuntimeError("Evaluator tensors are not initialized.")
        if not self.calibrations:
            raise RuntimeError("Evaluator score scaling is not initialized.")
        calibration_key = model if model in self.calibrations else None
        decision_threshold, score_scale = self.calibrations[calibration_key]

        started = time.perf_counter()
        full_ids, response_start, response_end, truncated = self._render_ids(
            prompt, response
        )
        input_ids = torch.tensor([full_ids], dtype=torch.long, device=self.device)
        attention_mask = torch.ones_like(input_ids)
        outputs = self.model(
            input_ids=input_ids,
            attention_mask=attention_mask,
            output_hidden_states=True,
            use_cache=False,
            return_dict=True,
        )
        hidden_states = _layer_outputs_only(
            _get_hidden_states(outputs), self._num_layers()
        )
        if not 0 <= self.bundle.shared_layer < len(hidden_states):
            raise RuntimeError("Artifact layer is outside the model decoder range.")
        activation = hidden_states[self.bundle.shared_layer][
            0, response_start:response_end, :
        ].float().mean(dim=0)
        if activation.numel() != self.unit_vectors.shape[1]:
            raise RuntimeError("Model hidden size does not match vector artifacts.")

        raw_scores = torch.mv(self.unit_vectors, activation)
        signed_scores = torch.tanh(
            (raw_scores - decision_threshold) / score_scale
        )
        readings = [
            {
                "traitId": axis.trait_id,
                "score": float(score.item()),
                "confidence": float(score.abs().item()),
            }
            for axis, score in zip(self.bundle.axes, signed_scores, strict=True)
        ]
        raw_by_trait = {
            axis.trait_id: round(float(raw.item()), 3)
            for axis, raw in zip(self.bundle.axes, raw_scores, strict=True)
        }

        del outputs, hidden_states, activation, raw_scores, signed_scores
        gc.collect()
        return {
            "readings": readings,
            "meta": {
                "modelRevision": self.bundle.model_revision,
                "vectorBuild": self.bundle.vector_build,
                "layer": self.bundle.shared_layer,
                "sequenceTokens": len(full_ids),
                "responseTokens": response_end - response_start,
                "truncated": truncated,
                "rawScores": raw_by_trait,
                "recenteredTraits": self.recentered_traits,
                "calibration": calibration_key or "default",
                "latencyMs": round((time.perf_counter() - started) * 1000),
            },
        }

    def _render_ids(
        self, prompt: str, response: str
    ) -> tuple[list[int], int, int, bool]:
        assert self.processor is not None
        messages = [
            {"role": "system", "content": EVALUATOR_SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ]
        prompt_text = self.processor.apply_chat_template(
            messages,
            tokenize=False,
            add_generation_prompt=True,
            enable_thinking=False,
        )
        full_text = self.processor.apply_chat_template(
            messages + [{"role": "assistant", "content": response}],
            tokenize=False,
            add_generation_prompt=False,
            enable_thinking=False,
        )
        prompt_ids = self.processor(text=prompt_text, return_tensors="pt")[
            "input_ids"
        ][0].tolist()
        full_ids = self.processor(text=full_text, return_tensors="pt")[
            "input_ids"
        ][0].tolist()
        tokenizer = getattr(self.processor, "tokenizer", self.processor)
        special_ids = set(tokenizer.all_special_ids)

        if full_ids[: len(prompt_ids)] == prompt_ids:
            tail = full_ids[len(prompt_ids) :]
            trim_start, trim_end = _clean_bounds(tail, special_ids)
            response_start = len(prompt_ids) + trim_start
            response_end = len(prompt_ids) + trim_end
        else:
            response_ids = tokenizer(response, add_special_tokens=False)["input_ids"]
            response_start = _find_last_subsequence(full_ids, response_ids)
            response_end = response_start + len(response_ids)
        if response_start >= response_end:
            raise ProjectionInputError("The assistant response has no usable tokens.")

        truncated = False
        if len(full_ids) > self.settings.max_sequence_tokens:
            window_start = len(full_ids) - self.settings.max_sequence_tokens
            full_ids = full_ids[window_start:]
            response_start = max(0, response_start - window_start)
            response_end = max(0, response_end - window_start)
            truncated = True
        if response_start >= response_end:
            raise ProjectionInputError(
                "The response fell outside the configured token window."
            )
        return full_ids, response_start, response_end, truncated

    def _num_layers(self) -> int:
        assert self.model is not None
        text_config = getattr(self.model.config, "text_config", self.model.config)
        return int(text_config.num_hidden_layers)


def _clean_bounds(token_ids: list[int], special_ids: set[int]) -> tuple[int, int]:
    start = 0
    end = len(token_ids)
    while start < end and token_ids[start] in special_ids:
        start += 1
    while end > start and token_ids[end - 1] in special_ids:
        end -= 1
    return start, end


def _find_last_subsequence(sequence: list[int], subsequence: list[int]) -> int:
    if not subsequence:
        raise ProjectionInputError("The assistant response is empty.")
    last = -1
    for index in range(len(sequence) - len(subsequence) + 1):
        if sequence[index : index + len(subsequence)] == subsequence:
            last = index
    if last < 0:
        raise ProjectionInputError("Could not locate the response token span.")
    return last


def _get_hidden_states(outputs: Any) -> tuple[torch.Tensor, ...]:
    for attribute in ("hidden_states", "decoder_hidden_states"):
        value = getattr(outputs, attribute, None)
        if value is not None:
            return tuple(value)
    for nested_attribute in (
        "language_model_output",
        "text_model_output",
        "model_output",
    ):
        nested = getattr(outputs, nested_attribute, None)
        if nested is None:
            continue
        for attribute in ("hidden_states", "decoder_hidden_states"):
            value = getattr(nested, attribute, None)
            if value is not None:
                return tuple(value)
    raise RuntimeError("Gemma output did not contain decoder hidden states.")


def _layer_outputs_only(
    hidden_states: tuple[torch.Tensor, ...], num_layers: int
) -> tuple[torch.Tensor, ...]:
    if len(hidden_states) == num_layers + 1:
        return hidden_states[1:]
    if len(hidden_states) == num_layers:
        return hidden_states
    raise RuntimeError(
        f"Expected {num_layers} or {num_layers + 1} hidden states, "
        f"received {len(hidden_states)}."
    )
