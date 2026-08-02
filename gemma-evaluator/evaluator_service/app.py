from __future__ import annotations

import asyncio
import hmac
from contextlib import asynccontextmanager, suppress
from typing import Any, AsyncIterator

from fastapi import FastAPI, Header, HTTPException, Request, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from .artifact_bundle import ArtifactBundle
from .config import Settings
from .engine import GemmaEvaluator, ProjectionInputError


class ProjectRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    prompt: str = Field(min_length=1, max_length=50_000)
    response: str = Field(min_length=1, max_length=50_000)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = Settings.from_env()
    bundle = ArtifactBundle.load(settings.vector_dir)
    engine = GemmaEvaluator(settings, bundle)
    app.state.settings = settings
    app.state.engine = engine
    app.state.inference_gate = asyncio.Semaphore(1)
    app.state.load_task = asyncio.create_task(asyncio.to_thread(engine.load))
    yield
    task: asyncio.Task[Any] = app.state.load_task
    if not task.done():
        task.cancel()
    with suppress(asyncio.CancelledError, Exception):
        await task


app = FastAPI(
    title="Rauchat Gemma 4 Trait Evaluator",
    version="0.1.0",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
    lifespan=lifespan,
)


def _authorize(request: Request, authorization: str | None) -> None:
    settings: Settings = request.app.state.settings
    prefix = "Bearer "
    if not authorization or not authorization.startswith(prefix):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED)
    supplied = authorization[len(prefix) :]
    if not hmac.compare_digest(supplied, settings.api_key):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED)


@app.get("/health")
async def health(
    request: Request,
    authorization: str | None = Header(default=None),
) -> JSONResponse:
    _authorize(request, authorization)
    engine: GemmaEvaluator = request.app.state.engine
    payload = {
        "status": "ok" if engine.status == "ready" else engine.status,
        "model": "gemma-4-12b",
        "modelRevision": engine.bundle.model_revision,
        "activationContext": engine.bundle.activation_context,
        "layerInfo": {
            "layerRange": str(engine.bundle.shared_layer),
            "projectionRank": len(engine.bundle.axes),
            "vectorBuild": engine.bundle.vector_build,
        },
        "detail": engine.detail,
        "warnings": engine.bundle.warnings,
        "recenteredTraits": engine.recentered_traits,
    }
    return JSONResponse(payload, status_code=200 if engine.status == "ready" else 503)


@app.post("/project")
async def project(
    body: ProjectRequest,
    request: Request,
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    _authorize(request, authorization)
    engine: GemmaEvaluator = request.app.state.engine
    if engine.status != "ready":
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=engine.detail,
        )
    try:
        async with request.app.state.inference_gate:
            return await asyncio.to_thread(engine.project, body.prompt, body.response)
    except ProjectionInputError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc
