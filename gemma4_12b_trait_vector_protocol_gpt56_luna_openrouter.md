# Gemma 4 12B Trait-Vector Protocol — GPT-5.6 Luna via OpenRouter

## Change from the previous version

The sole automated evaluator is now GPT-5.6 Luna through OpenRouter. The Gemma generation, activation extraction, grouped layer selection, calibration, test evaluation, and steering stages are unchanged.

## Required Colab secrets

- `HF_TOKEN`
- `OPENROUTER_API_KEY`

## Model resolution

The notebook calls `GET https://openrouter.ai/api/v1/models`, prefers the model ID `openai/gpt-5.6-luna`, and otherwise searches the returned catalog for a model whose ID or display name contains both `gpt-5.6` and `luna`. This avoids silently using a different model if model slugs change.

## Rating request

The notebook uses the OpenAI Python SDK with:

- base URL `https://openrouter.ai/api/v1`
- the resolved GPT-5.6 Luna model ID
- strict `response_format.type = json_schema`
- `provider.require_parameters = true`
- medium reasoning effort when the model metadata indicates reasoning support
- a blinded evaluation packet
- resumable JSONL logging

The rater never receives Gemma's intended system prompt, intended pole, or intended label.

## Reproducibility records

Each rating stores:

- requested and returned model ID
- rater-prompt version
- reasoning effort
- request ID
- finish reason
- token usage
- UTC timestamp
- score, confidence, validity, reason, evidence, and flags

## Important migration rule

Do not mix ratings from Claude Opus 4.6 and GPT-5.6 Luna in one vector-construction dataset. Changing the evaluator can change which responses are accepted and their assigned poles. Regenerate all judge ratings and rerun every downstream stage from the accepted-example filter onward.

## Vector orientation

Each direction remains:

- factual − hallucinatory
- serious − funny
- casual − formal
- creative − empirical
- honest − sycophantic
- confident − unsure
- empathetic − unempathetic
- calm − anxious
