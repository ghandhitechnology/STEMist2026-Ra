# Rauchat Gemma 4 evaluator

This service loads the exact `google/gemma-4-12B-it` revision used by the
trait-vector notebook, extracts the mean response-token activation at decoder
layer 36, and projects it onto the eight calibrated trait directions.

The service is an evaluator only. Rauchat's selected OpenRouter model still
generates the response; Gemma receives the latest user/reference context and
the completed response afterward.

## Runtime contract

- `GET /health` reports loading, ready, or error state plus artifact identity.
- `POST /project` accepts `{ "prompt": string, "response": string }` and
  returns eight `{ traitId, score, confidence }` readings.
- Both endpoints require `Authorization: Bearer <GEMMA_API_KEY>`.
- Inference concurrency is one request per GPU to avoid VRAM spikes.
- Input is capped to the most recent `MAX_SEQUENCE_TOKENS` tokens (2048 by
  default), with truncation disclosed in the response metadata.

## Artifact bundle

`artifacts/vectors.safetensors` and `artifacts/metadata.json` were generated
from the downloaded Colab packages without calling `torch.load`. The converter
uses a restricted unpickler for tensor metadata, copies only F16 storage bytes,
checks every unit norm and shared field, and emits a checksummed safe bundle.

Rebuild it with:

```bash
python3 scripts/convert_vectors.py \
  --source ../gemma-results/full-original-layer-36/vectors \
  --metrics ../gemma-results/full-original-layer-36/metrics/full__original__shared_metrics.json \
  --output artifacts
```

The current bundle is explicitly provisional: it uses `activation_context =
original` and one judge pass. A neutral-context, three-pass bundle can replace
these two artifact files without changing the API.

## Container

Build from the repository root:

```bash
docker build \
  -f gemma-evaluator/Dockerfile \
  -t rauchat-gemma-evaluator:0.1.0 \
  gemma-evaluator
```

The image is Linux/AMD64 and starts one Uvicorn worker on port 8000. Required
runtime secrets are `HF_TOKEN` and `GEMMA_API_KEY`; model cache should live at
`/workspace/huggingface` on persistent storage.
