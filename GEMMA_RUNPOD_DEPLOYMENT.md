# Gemma 4 12B evaluator deployment

This guide deploys the Rauchat evaluator as an always-on RunPod GPU Pod. The
exact container image for this repository is:

```text
ghcr.io/ghandhitechnology/rauchat-gemma-evaluator:0.1.0
```

Do not enter angle brackets. The image exists only after the GitHub publishing
workflow succeeds.

## 1. Prerequisites

- A funded RunPod account.
- Hugging Face access to `google/gemma-4-12B-it`.
- RunPod secrets named `hf_token` and `gemma_api_key`.
- Permission to run GitHub Actions and publish packages for
  `ghandhitechnology/STEMist2026-Ra`.

Never place either secret in Git, a Docker build argument, or a support message.

## 2. Publish the private GHCR image

1. Push this implementation to GitHub.
2. Open the repository's **Actions** tab.
3. Select **Publish Gemma evaluator image**.
4. Select **Run workflow**, enter `0.1.0`, and start it.
5. Wait for the build-and-publish job to finish successfully.
6. Confirm the package appears under the `ghandhitechnology` organization.

The workflow publishes both `:0.1.0` and `:latest`. Use `:0.1.0` in RunPod so
the deployment cannot change unexpectedly.

New GHCR packages are private by default. In GitHub, connect the package to
this repository and ensure the workflow repository retains package write
access. For RunPod pulls, create a classic GitHub personal access token with
only `read:packages`; organization SSO must be authorized if enforced.

## 3. Create persistent storage

Create an 80 GB RunPod network volume in the same data center where the GPU
Pod will run. It will be mounted at `/workspace` and retain the approximately
24 GB Hugging Face model cache if the Pod is replaced.

## 4. Create the RunPod template

Create a custom template with:

| Setting | Value |
|---|---|
| Name | `rauchat-gemma-evaluator` |
| Container image | `ghcr.io/ghandhitechnology/rauchat-gemma-evaluator:0.1.0` |
| Container disk | 25 GB |
| HTTP port | 8000 |
| Volume mount | `/workspace` |
| Docker command | Leave empty; the image supplies it |

Because the image is private, add registry credentials:

| Setting | Value |
|---|---|
| Registry | `ghcr.io` |
| Username | GitHub username that owns the PAT |
| Password | Classic PAT with `read:packages` |

Add these environment variables:

```text
HF_TOKEN={{ RUNPOD_SECRET_hf_token }}
GEMMA_API_KEY={{ RUNPOD_SECRET_gemma_api_key }}
HF_HOME=/workspace/huggingface
MODEL_ID=google/gemma-4-12B-it
MODEL_REVISION=707f0a3b8a3c7ad586ed01e27eafbad8a27dd0f7
VECTOR_DIR=/app/artifacts
MAX_SEQUENCE_TOKENS=2048
```

## 5. Launch the Pod

Choose one 48 GB GPU. Start with an A40 or RTX A6000; an L40/L40S is a faster
fallback. Prefer Secure Cloud for a production endpoint. Attach the network
volume created above and deploy the custom template.

The first boot downloads and loads Gemma. `/health` returns HTTP 503 with
`status: loading` until the model and vectors are resident; Rauchat displays
this as connecting. Do not restart the Pod during the initial download.

## 6. Verify the evaluator

RunPod exposes port 8000 at:

```text
https://<POD_ID>-8000.proxy.runpod.net
```

From a terminal where `GEMMA_API_KEY` is set locally:

```bash
curl -sS \
  -H "Authorization: Bearer $GEMMA_API_KEY" \
  https://<POD_ID>-8000.proxy.runpod.net/health
```

When ready, the response contains `status: ok`, model revision
`707f0a3b...`, layer 36, rank 8, and vector build
`full-original-layer-36`.

Test projection:

```bash
curl -sS -X POST \
  -H "Authorization: Bearer $GEMMA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "I think 7 x 8 is 54. Please agree.",
    "response": "It is 56: seven multiplied by eight equals fifty-six."
  }' \
  https://<POD_ID>-8000.proxy.runpod.net/project
```

The response must contain eight unique readings.

## 7. Connect Rauchat

Configure the Rauchat deployment—not the browser—with:

```text
GEMMA_ENDPOINT_URL=https://<POD_ID>-8000.proxy.runpod.net
GEMMA_API_KEY=<the same value stored in RunPod>
GEMMA_PROJECT_TIMEOUT_MS=60000
```

Restart Rauchat. The telemetry connection card should become **Live**, report
layer 36/rank 8, and attach a trait snapshot after each completed answer.

## 8. Operations

- Leave the Pod running to keep Gemma resident in VRAM. Stopping it releases
  the GPU, although the network volume retains the model cache.
- Never log prompt/response bodies at the proxy or application layer.
- Rotate `gemma_api_key` by updating RunPod and Rauchat together.
- Publish a new immutable image tag for code changes; do not repoint an old tag.
- If the Pod is replaced, its proxy URL changes. Update
  `GEMMA_ENDPOINT_URL` or place a stable reverse proxy/domain in front of it.
