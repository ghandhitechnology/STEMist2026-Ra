/**
 * app/api/traits/status/route.ts — GET -> { status, model, layerInfo? }
 *
 * Backs the Model Telemetry panel's connection state (DESIGN.md §6.1).
 * See lib/server/traits.ts for the full remote contract.
 */

import { NextResponse } from "next/server";
import { getTraitStatus } from "@/lib/server/traits";

export const runtime = "nodejs";

/**
 * Flattens lib/server/traits.ts's TraitStatusResponse (whose `layerInfo` is
 * a structured object, per the Gemma remote contract) into the string-typed
 * payload lib/useTelemetry.ts and <TelemetryPanel/> expect: `layerInfo` as
 * "12-24 · rank 8", `vectorSet` as the build tag, `detail` as the error copy.
 */
export async function GET() {
  const status = await getTraitStatus();
  const info = status.layerInfo;
  const layerInfo =
    info?.layerRange || typeof info?.projectionRank === "number"
      ? [
          info?.layerRange,
          typeof info?.projectionRank === "number"
            ? `rank ${info.projectionRank}`
            : undefined,
        ]
          .filter(Boolean)
          .join(" · ")
      : undefined;

  return NextResponse.json({
    status: status.status,
    model: status.model,
    layerInfo,
    vectorSet: info?.vectorBuild,
    detail: status.detail,
  });
}
