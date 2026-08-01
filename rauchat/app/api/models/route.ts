/**
 * app/api/models/route.ts — GET the model catalog plus live availability.
 *
 * Availability is checked against OpenRouter's public model catalog
 * (https://openrouter.ai/api/v1/models, no auth required) and cached for an
 * hour so the selector can gray out models whose catalog ids are absent
 * instead of failing at send time.
 */

import { MODELS } from "@/lib/models";
import { getUserId, unauthorized } from "@/lib/server/auth";

export const runtime = "nodejs";

const CATALOG_URL = "https://openrouter.ai/api/v1/models";
const CATALOG_TTL_MS = 60 * 60 * 1000;

let catalogCache: { ids: Set<string>; fetchedAt: number } | null = null;

async function getCatalogIds(): Promise<Set<string> | null> {
  if (catalogCache && Date.now() - catalogCache.fetchedAt < CATALOG_TTL_MS) {
    return catalogCache.ids;
  }
  try {
    const res = await fetch(CATALOG_URL, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return catalogCache?.ids ?? null;
    const data = (await res.json()) as { data?: Array<{ id?: string }> };
    const ids = new Set(
      (data.data ?? []).map((m) => m.id ?? "").filter(Boolean)
    );
    catalogCache = { ids, fetchedAt: Date.now() };
    return ids;
  } catch {
    return catalogCache?.ids ?? null;
  }
}

export async function GET() {
  if (!(await getUserId())) return unauthorized();
  const catalog = await getCatalogIds();
  const models = MODELS.map((m) => ({
    ...m,
    // null = catalog unreachable (assume available); boolean otherwise.
    available: catalog ? catalog.has(m.openrouterId) : null,
  }));
  return Response.json({
    models,
    configured: Boolean(process.env.OPENROUTER_API_KEY),
  });
}
