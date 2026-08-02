#!/usr/bin/env python3
"""Ensure a Rauchat Gemma evaluator pod is RUNNING; print its public URL."""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request

API = os.environ["RUNPOD_API_KEY"]
HDR = {
    "Authorization": f"Bearer {API}",
    "Content-Type": "application/json",
}
IMAGE_PREF = "rauchat-gemma-evaluator"
GPU_CANDIDATES = [
    "NVIDIA A100-SXM4-80GB",
    "NVIDIA A100 80GB PCIe",
    "NVIDIA L40S",
    "NVIDIA A40",
    "NVIDIA RTX A6000",
]


def get(url: str):
    req = urllib.request.Request(url, headers=HDR)
    with urllib.request.urlopen(req) as r:
        return json.load(r)


def post(url: str, body=None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, headers=HDR, method="POST")
    with urllib.request.urlopen(req) as r:
        raw = r.read()
        return json.loads(raw) if raw else {}


def recreate_from(old: dict) -> dict:
    env = dict(old.get("env") or {})
    if env.get("HF_TOKEN", "").startswith("{{") and os.environ.get("HF_TOKEN"):
        env["HF_TOKEN"] = os.environ["HF_TOKEN"]
    base = {
        "name": "rauchat-gemma-evaluator",
        "imageName": old["imageName"],
        "containerDiskInGb": old.get("containerDiskInGb", 25),
        "volumeInGb": 0,
        "volumeMountPath": "/workspace",
        "networkVolumeId": old["networkVolumeId"],
        "ports": ["8000/http"],
        "gpuCount": 1,
        "env": env,
        "containerRegistryAuthId": old.get("containerRegistryAuthId"),
        "cloudType": "SECURE",
        "dataCenterIds": ["US-MD-1"],
    }
    last = None
    for gpu in GPU_CANDIDATES:
        attempt = dict(base)
        attempt["gpuTypeIds"] = [gpu]
        try:
            return post("https://rest.runpod.io/v1/pods", attempt)
        except urllib.error.HTTPError as e:
            last = e.read().decode()
            print(f"create {gpu} failed: {last[:200]}", file=sys.stderr)
    raise SystemExit(f"could not recreate Gemma pod: {last}")


def main() -> int:
    pods = get("https://rest.runpod.io/v1/pods")
    if not isinstance(pods, list):
        raise SystemExit(f"unexpected pods payload: {type(pods)}")

    running = [
        p
        for p in pods
        if p.get("desiredStatus") == "RUNNING"
        and IMAGE_PREF in (p.get("imageName") or "")
    ]
    exited = [
        p
        for p in pods
        if p.get("desiredStatus") == "EXITED"
        and IMAGE_PREF in (p.get("imageName") or "")
    ]

    if running:
        pod = running[0]
    elif exited:
        old = exited[0]
        try:
            post(f"https://rest.runpod.io/v1/pods/{old['id']}/start")
            pod = get(f"https://rest.runpod.io/v1/pods/{old['id']}")
        except urllib.error.HTTPError as e:
            err = e.read().decode()
            print(f"start failed ({err[:200]}); recreating", file=sys.stderr)
            pod = recreate_from(old)
    else:
        raise SystemExit("No Gemma evaluator pod found on this RunPod account.")

    endpoint = f"https://{pod['id']}-8000.proxy.runpod.net"
    print(f"pod={pod['id']} status={pod.get('desiredStatus')}", file=sys.stderr)
    print(endpoint)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
