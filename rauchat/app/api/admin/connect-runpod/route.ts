import { NextRequest, NextResponse } from "next/server";
import { writeGemmaRuntimeConfig } from "@/lib/server/gemma-runtime-config";

export const dynamic = "force-dynamic";

type RunPodPod = {
  id?: unknown;
  desiredStatus?: unknown;
  imageName?: unknown;
  env?: unknown;
};

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: NextRequest) {
  const runpodApiKey = request.headers.get("x-runpod-api-key")?.trim() || "";
  if (!runpodApiKey.startsWith("rpa_") || runpodApiKey.length < 32) {
    return json({ ok: false, error: "Valid RunPod credentials required." }, 401);
  }

  try {
    const podsResponse = await fetch("https://rest.runpod.io/v1/pods", {
      headers: {
        Authorization: `Bearer ${runpodApiKey}`,
        "User-Agent": "rauchat-production-bootstrap/1.0",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    if (!podsResponse.ok) {
      return json({ ok: false, error: "RunPod credentials were rejected." }, 401);
    }

    const payload = (await podsResponse.json()) as unknown;
    const pods = Array.isArray(payload) ? (payload as RunPodPod[]) : [];
    const pod = pods.find(
      (candidate) =>
        candidate.desiredStatus === "RUNNING" &&
        typeof candidate.imageName === "string" &&
        candidate.imageName.includes("rauchat-gemma-evaluator")
    );
    if (!pod || typeof pod.id !== "string") {
      return json({ ok: false, error: "No running Rauchat evaluator pod found." }, 404);
    }

    const env =
      pod.env && typeof pod.env === "object"
        ? (pod.env as Record<string, unknown>)
        : {};
    const gemmaApiKey =
      typeof env.GEMMA_API_KEY === "string" ? env.GEMMA_API_KEY.trim() : "";
    if (gemmaApiKey.length < 32) {
      return json({ ok: false, error: "Evaluator credential is unavailable." }, 502);
    }

    const endpointUrl = `https://${pod.id}-8000.proxy.runpod.net`;
    const healthResponse = await fetch(`${endpointUrl}/health`, {
      headers: {
        Authorization: `Bearer ${gemmaApiKey}`,
        "User-Agent": "rauchat-production-bootstrap/1.0",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
    const health = (await healthResponse.json().catch(() => ({}))) as {
      status?: unknown;
    };
    if (!healthResponse.ok || health.status !== "ok") {
      return json(
        { ok: false, error: "Evaluator health verification failed." },
        502
      );
    }

    await writeGemmaRuntimeConfig({ endpointUrl, apiKey: gemmaApiKey });
    return json({
      ok: true,
      podId: pod.id,
      endpointUrl,
      evaluatorStatus: "ok",
    });
  } catch (error) {
    console.error(
      "RunPod production bootstrap failed:",
      error instanceof Error ? error.message : "unknown error"
    );
    return json({ ok: false, error: "Production bootstrap failed." }, 500);
  }
}
