import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { WORKSPACE_BASE_ROOT } from "./paths";

export type GemmaRuntimeConfig = {
  endpointUrl: string;
  apiKey: string;
};

const CONFIG_DIR = path.join(WORKSPACE_BASE_ROOT, ".runtime");
const CONFIG_FILE = path.join(CONFIG_DIR, "gemma.json");

function normalizeConfig(value: unknown): GemmaRuntimeConfig | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const endpointUrl =
    typeof record.endpointUrl === "string"
      ? record.endpointUrl.trim().replace(/\/+$/, "")
      : "";
  const apiKey = typeof record.apiKey === "string" ? record.apiKey.trim() : "";
  if (!endpointUrl || apiKey.length < 32) return null;

  try {
    const url = new URL(endpointUrl);
    if (
      url.protocol !== "https:" ||
      !url.hostname.endsWith(".proxy.runpod.net") ||
      url.pathname !== "/"
    ) {
      return null;
    }
  } catch {
    return null;
  }

  return { endpointUrl, apiKey };
}

export async function readGemmaRuntimeConfig(): Promise<GemmaRuntimeConfig | null> {
  try {
    const raw = await readFile(CONFIG_FILE, "utf8");
    return normalizeConfig(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function writeGemmaRuntimeConfig(
  config: GemmaRuntimeConfig
): Promise<void> {
  const normalized = normalizeConfig(config);
  if (!normalized) throw new Error("Invalid Gemma runtime configuration.");

  await mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
  const temporary = `${CONFIG_FILE}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(normalized)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporary, CONFIG_FILE);
}
