FROM pytorch/pytorch:2.10.0-cuda12.8-cudnn9-runtime

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    VIRTUAL_ENV=/opt/venv \
    PATH=/opt/venv/bin:$PATH \
    HF_HOME=/workspace/huggingface \
    VECTOR_DIR=/app/artifacts \
    MODEL_ID=google/gemma-4-12B-it \
    MODEL_REVISION=707f0a3b8a3c7ad586ed01e27eafbad8a27dd0f7 \
    MAX_SEQUENCE_TOKENS=2048 \
    PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True

WORKDIR /app

RUN apt-get update \
    && apt-get install --yes --no-install-recommends python3.12-venv \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /app/requirements.txt
RUN /usr/bin/python3 -m venv --system-site-packages "$VIRTUAL_ENV" \
    && python -m pip install --no-cache-dir -r /app/requirements.txt

COPY evaluator_service /app/evaluator_service
COPY artifacts /app/artifacts

EXPOSE 8000

CMD ["python", "-m", "uvicorn", "evaluator_service.app:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
