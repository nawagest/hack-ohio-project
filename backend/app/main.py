from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from typing import Literal

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator

from .data import Dataset, load_dataset
from .engine import Scenario, analyze, deterministic_answer


app = FastAPI(
    title="Outage Concierge API",
    description="Transparent challenge prototype for outage risk and restoration scenarios.",
    version="0.1.0",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


class AnalysisRequest(BaseModel):
    location_id: str
    storm_severity: Literal["light", "moderate", "severe"] = "moderate"
    repair_count: int = Field(default=1, ge=1, le=4)
    crew_size: int = Field(default=2, ge=1, le=4)


class AssistantRequest(AnalysisRequest):
    question: str = Field(min_length=1, max_length=500)

    @field_validator("question")
    @classmethod
    def question_must_not_be_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Enter a question.")
        return value.strip()


def _dataset() -> Dataset:
    try:
        return load_dataset()
    except (FileNotFoundError, RuntimeError) as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


def _scenario(request: AnalysisRequest) -> Scenario:
    return Scenario(
        location_id=request.location_id,
        storm_severity=request.storm_severity,
        repair_count=request.repair_count,
        crew_size=request.crew_size,
    )


def _ollama_answer(question: str, result: dict) -> str:
    base_url = os.getenv("OLLAMA_BASE_URL", "").strip().rstrip("/")
    model = os.getenv("OLLAMA_MODEL", "").strip()
    if not base_url and not model:
        return deterministic_answer(question, result)
    if not base_url or not model:
        raise HTTPException(
            status_code=503,
            detail="Set both OLLAMA_BASE_URL and OLLAMA_MODEL, or leave both unset.",
        )
    if not base_url.startswith(("http://", "https://")):
        raise HTTPException(
            status_code=503,
            detail="OLLAMA_BASE_URL must be an HTTP or HTTPS URL.",
        )

    context = {
        "risk": result["risk"],
        "restoration": result["restoration"],
        "preparation": result["preparation"],
        "alert": result["alert"],
    }
    payload = json.dumps(
        {
            "model": model,
            "stream": False,
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "You are a plain-language outage preparation assistant. "
                        "Only explain the supplied calculated results and assumptions. "
                        "Never invent outage probabilities, utility confirmations, "
                        "customer identities, or restoration promises. State that the "
                        "risk index is not a probability and restoration is a scenario "
                        "estimate. Keep safety advice conservative and direct emergencies "
                        "to local emergency services."
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"Customer question: {question}\n"
                        f"Calculated, anonymized context: {json.dumps(context)}"
                    ),
                },
            ],
        }
    ).encode("utf-8")
    request = urllib.request.Request(
        f"{base_url}/api/chat",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=45) as response:
            body = json.loads(response.read())
    except urllib.error.HTTPError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"The configured Ollama service returned HTTP {exc.code}.",
        ) from exc
    except (urllib.error.URLError, TimeoutError) as exc:
        raise HTTPException(
            status_code=502,
            detail="Could not reach the configured Ollama service.",
        ) from exc
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=502,
            detail="The configured Ollama service returned invalid JSON.",
        ) from exc

    try:
        answer = body["message"]["content"].strip()
    except (KeyError, AttributeError, TypeError) as exc:
        raise HTTPException(
            status_code=502,
            detail="The configured Ollama service returned an invalid chat response.",
        ) from exc
    if not answer:
        raise HTTPException(
            status_code=502,
            detail="The configured Ollama service returned an empty answer.",
        )
    return answer


@app.get("/api/health")
def health() -> dict[str, str]:
    _dataset()
    base_url = os.getenv("OLLAMA_BASE_URL", "").strip()
    model = os.getenv("OLLAMA_MODEL", "").strip()
    assistant_mode = (
        "rules" if not base_url and not model else "ollama" if base_url and model else "misconfigured"
    )
    return {"status": "ok", "assistant": assistant_mode}


@app.get("/api/locations")
def locations() -> dict[str, list[dict[str, str]]]:
    dataset = _dataset()
    return {
        "locations": [
            {
                "id": location.id,
                "label": location.label,
                "description": "Anonymized sample circuit",
            }
            for location in dataset.locations
        ]
    }


@app.post("/api/analyze")
def analyze_request(request: AnalysisRequest) -> dict:
    dataset = _dataset()
    try:
        return analyze(dataset, _scenario(request))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.post("/api/assistant")
def assistant(request: AssistantRequest) -> dict:
    dataset = _dataset()
    try:
        result = analyze(dataset, _scenario(request))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    answer = _ollama_answer(request.question, result)
    normalized = request.question.casefold()
    wants_chart = any(
        word in normalized for word in ("chart", "graph", "plot", "compare")
    )
    return {
        "answer": answer,
        "visualization": result["chart"] if wants_chart else None,
    }
