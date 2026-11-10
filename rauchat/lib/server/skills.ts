/** Package-backed skills with legacy JSON migration and whole-package history. */

import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { TOOL_NAMES, type Skill, type ToolName } from "@/lib/types";
import {
  SKILL_ENTRY_FILE,
  type SkillCatalogEntry,
  type SkillCreateInput,
  type SkillManageInput,
  type SkillManageResult,
  type SkillPackage,
  type SkillPackageFile,
  type SkillPackageSnapshot,
  type SkillPackageView,
  type SkillRevision,
  type SkillSource,
  type SkillUpdateInput,
  type StoredSkillMetadata,
} from "@/lib/skill-types";
import { skillsDirFor, ensureWorkspaceDirs } from "./workspace";

const METADATA_FILE = "metadata.json";
const CURRENT_DIR = "current";
const REVISIONS_DIR = "revisions";
const MAX_FILE_BYTES = 1_000_000;
const MAX_PACKAGE_BYTES = 5_000_000;
const MAX_FILES = 100;
const shared = globalThis as typeof globalThis & {
  __rauchatSkillLocks?: Map<string, Promise<void>>;
};
const locks = (shared.__rauchatSkillLocks ??= new Map<string, Promise<void>>());

export class SkillIdError extends Error {
  constructor() {
    super("Invalid skill id.");
    this.name = "SkillIdError";
  }
}

export class SkillPackageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SkillPackageError";
  }
}

export function safeSkillId(raw: unknown): string {
  const id = String(raw ?? "");
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id)) throw new SkillIdError();
  return id;
}

function skillRoot(userId: string, rawId: unknown): string {
  const root = skillsDirFor(userId);
  const result = path.join(root, safeSkillId(rawId));
  if (!result.startsWith(`${root}${path.sep}`)) throw new SkillIdError();
  return result;
}

function legacyFile(userId: string, rawId: unknown): string {
  return `${skillRoot(userId, rawId)}.json`;
}

function revisionDir(root: string, revision: number): string {
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw new SkillPackageError("Revision must be a positive integer.");
  }
  return path.join(root, REVISIONS_DIR, String(revision).padStart(8, "0"));
}

export function normalizeSkillPackagePath(raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim()) {
    throw new SkillPackageError("Package path must be a non-empty string.");
  }
  const normalized = raw.replace(/\\/g, "/").replace(/^\.\//, "");
  if (
    normalized.length > 240 ||
    normalized.startsWith("/") ||
    normalized.includes("\0") ||
    normalized.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new SkillPackageError(`Unsafe package path: ${raw}`);
  }
  if (
    normalized !== SKILL_ENTRY_FILE &&
    !normalized.startsWith("scripts/") &&
    !normalized.startsWith("references/")
  ) {
    throw new SkillPackageError(
      "Package files must be SKILL.md or live under scripts/ or references/."
    );
  }
  return normalized;
}

function assertContent(content: unknown, filePath: string): string {
  if (typeof content !== "string") {
    throw new SkillPackageError(`${filePath} must contain text.`);
  }
  if (Buffer.byteLength(content, "utf8") > MAX_FILE_BYTES) {
    throw new SkillPackageError(`${filePath} exceeds the 1 MB file limit.`);
  }
  return content;
}

function requiredText(raw: unknown, field: string, maxLength: number): string {
  if (typeof raw !== "string" || !raw.trim()) {
    throw new SkillPackageError(`${field} must not be empty.`);
  }
  const value = raw.trim();
  if (value.length > maxLength) {
    throw new SkillPackageError(`${field} exceeds ${maxLength} characters.`);
  }
  return value;
}

function quoteYaml(value: string): string {
  return JSON.stringify(value.replace(/[\r\n]+/g, " ").trim());
}

function renderSkillMarkdown(name: string, description: string, instructions: string): string {
  return `---\nname: ${quoteYaml(name)}\ndescription: ${quoteYaml(description)}\n---\n\n${instructions.trim()}\n`;
}

function instructionBody(markdown: string): string {
  if (!markdown.startsWith("---\n")) return markdown.trim();
  const end = markdown.indexOf("\n---", 4);
  return end < 0 ? markdown.trim() : markdown.slice(end + 4).trim();
}

function normalizeSource(source: unknown): SkillSource {
  return source === "generated" || source === "imported" ? source : "manual";
}

function normalizeCapabilities(raw: Skill["capabilities"]): {
  tools: ToolName[];
  skills: string[];
} {
  return {
    tools: Array.isArray(raw?.tools) ? [...new Set(raw.tools)] : [],
    skills: Array.isArray(raw?.skills)
      ? [...new Set(raw.skills.map(String).filter(Boolean))]
      : [],
  };
}

function validateCapabilities(raw: unknown): { tools: ToolName[]; skills: string[] } {
  if (raw === undefined) return { tools: [], skills: [] };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new SkillPackageError("capabilities must contain tools and skills arrays.");
  }
  const record = raw as { tools?: unknown; skills?: unknown };
  if (
    (record.tools !== undefined && !Array.isArray(record.tools)) ||
    (record.skills !== undefined && !Array.isArray(record.skills))
  ) {
    throw new SkillPackageError("capabilities must contain tools and skills arrays.");
  }
  const allowedTools = new Set<string>(TOOL_NAMES);
  const tools = record.tools ?? [];
  const skills = record.skills ?? [];
  if (tools.length > TOOL_NAMES.length || skills.length > 20) {
    throw new SkillPackageError("Skill capabilities exceed the supported limit.");
  }
  if (!tools.every((tool) => typeof tool === "string" && allowedTools.has(tool))) {
    throw new SkillPackageError("Skill capabilities contain an unknown tool.");
  }
  if (
    !skills.every(
      (skill) =>
        typeof skill === "string" &&
        skill.trim().length > 0 &&
        skill.trim().length <= 100
    )
  ) {
    throw new SkillPackageError("Skill dependencies must be non-empty skill IDs or names.");
  }
  return {
    tools: [...new Set(tools as ToolName[])],
    skills: [...new Set((skills as string[]).map((skill) => skill.trim()))],
  };
}

function validateManagedFiles(
  raw: unknown,
  allowDelete: boolean
): Record<string, string | null> | undefined {
  if (raw === undefined) return undefined;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new SkillPackageError("files must be an object keyed by package path.");
  }
  const entries = Object.entries(raw as Record<string, unknown>);
  if (!entries.length || entries.length > MAX_FILES) {
    throw new SkillPackageError(`files must contain between 1 and ${MAX_FILES} entries.`);
  }
  const result: Record<string, string | null> = {};
  for (const [rawPath, content] of entries) {
    const filePath = normalizeSkillPackagePath(rawPath);
    if (filePath === SKILL_ENTRY_FILE) {
      throw new SkillPackageError("Set skill instructions through the instructions field.");
    }
    if (content === null && allowDelete) result[filePath] = null;
    else result[filePath] = assertContent(content, filePath);
  }
  return result;
}

async function withLock<T>(key: string, work: () => Promise<T>): Promise<T> {
  const prior = locks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = prior.catch(() => undefined).then(() => gate);
  locks.set(key, queued);
  await prior.catch(() => undefined);
  try {
    return await work();
  } finally {
    release();
    if (locks.get(key) === queued) locks.delete(key);
  }
}

async function exists(target: string): Promise<boolean> {
  try {
    await lstat(target);
    return true;
  } catch {
    return false;
  }
}

async function assertNotSymlink(target: string): Promise<void> {
  try {
    if ((await lstat(target)).isSymbolicLink()) {
      throw new SkillPackageError("Skill packages cannot contain symbolic links.");
    }
  } catch (error) {
    if (error instanceof SkillPackageError) throw error;
  }
}

async function listFiles(base: string): Promise<SkillPackageFile[]> {
  await assertNotSymlink(base);
  const output: SkillPackageFile[] = [];
  async function walk(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        throw new SkillPackageError("Skill packages cannot contain symbolic links.");
      }
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute);
      } else if (entry.isFile() && entry.name !== METADATA_FILE) {
        const info = await stat(absolute);
        const relative = path.relative(base, absolute).split(path.sep).join("/");
        normalizeSkillPackagePath(relative);
        output.push({ path: relative, size: info.size, updatedAt: info.mtimeMs });
      }
    }
  }
  await walk(base);
  return output.sort((a, b) => a.path.localeCompare(b.path));
}

async function readPackageFiles(base: string): Promise<Map<string, string>> {
  const files = await listFiles(base);
  const result = new Map<string, string>();
  for (const file of files) {
    result.set(file.path, await readFile(path.join(base, file.path), "utf8"));
  }
  return result;
}

function validateFileSet(files: Map<string, string>): void {
  if (!files.has(SKILL_ENTRY_FILE)) {
    throw new SkillPackageError("A skill package requires SKILL.md.");
  }
  if (files.size > MAX_FILES) {
    throw new SkillPackageError(`A skill package can contain at most ${MAX_FILES} files.`);
  }
  let total = 0;
  for (const [filePath, content] of files) {
    normalizeSkillPackagePath(filePath);
    total += Buffer.byteLength(assertContent(content, filePath), "utf8");
  }
  if (total > MAX_PACKAGE_BYTES) {
    throw new SkillPackageError("The skill package exceeds the 5 MB limit.");
  }
}

async function writeTree(
  target: string,
  files: Map<string, string>,
  metadata: StoredSkillMetadata
): Promise<void> {
  validateFileSet(files);
  await mkdir(target, { recursive: true });
  for (const [relative, content] of files) {
    const file = path.join(target, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, content, { encoding: "utf8", flag: "wx" });
  }
  await writeFile(path.join(target, METADATA_FILE), JSON.stringify(metadata, null, 2), {
    encoding: "utf8",
    flag: "wx",
  });
}

async function atomicReplaceDirectory(target: string, staging: string): Promise<void> {
  const backup = `${target}.old-${randomUUID()}`;
  const hadTarget = await exists(target);
  if (hadTarget) await rename(target, backup);
  try {
    await rename(staging, target);
    if (hadTarget) await rm(backup, { recursive: true, force: true });
  } catch (error) {
    if (hadTarget && !(await exists(target))) await rename(backup, target);
    throw error;
  }
}

async function revisionCount(root: string): Promise<number> {
  try {
    return (await readdir(path.join(root, REVISIONS_DIR), { withFileTypes: true })).filter(
      (entry) => entry.isDirectory() && /^\d{8}$/.test(entry.name)
    ).length;
  } catch {
    return 0;
  }
}

async function latestRevision(root: string): Promise<number> {
  try {
    const revisions = (await readdir(path.join(root, REVISIONS_DIR), { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && /^\d{8}$/.test(entry.name))
      .map((entry) => Number(entry.name));
    return revisions.length ? Math.max(...revisions) : 0;
  } catch {
    return 0;
  }
}

async function readMetadata(base: string): Promise<StoredSkillMetadata> {
  await assertNotSymlink(base);
  await assertNotSymlink(path.join(base, METADATA_FILE));
  const parsed = JSON.parse(
    await readFile(path.join(base, METADATA_FILE), "utf8")
  ) as StoredSkillMetadata;
  if (!parsed || parsed.schemaVersion !== 1 || safeSkillId(parsed.id) !== parsed.id) {
    throw new SkillPackageError("Invalid skill package metadata.");
  }
  return parsed;
}

async function packageFromDirectory(root: string, base: string): Promise<SkillPackage> {
  const files = await listFiles(base);
  const metadata = await readMetadata(base);
  const markdown = await readFile(path.join(base, SKILL_ENTRY_FILE), "utf8");
  return {
    id: metadata.id,
    name: metadata.name,
    description: metadata.description,
    instructions: instructionBody(markdown),
    createdAt: metadata.createdAt,
    updatedAt: metadata.updatedAt,
    revision: metadata.revision,
    revisionCount: await revisionCount(root),
    source: metadata.source,
    ...(metadata.sourceDraftId ? { sourceDraftId: metadata.sourceDraftId } : {}),
    ...(metadata.autoLoad ? { autoLoad: true } : {}),
    capabilities: normalizeCapabilities(metadata.capabilities),
    files,
  };
}

async function writeRevision(
  userId: string,
  id: string,
  files: Map<string, string>,
  metadata: StoredSkillMetadata
): Promise<SkillPackage> {
  const root = skillRoot(userId, id);
  const revisions = path.join(root, REVISIONS_DIR);
  await assertNotSymlink(root);
  await mkdir(root, { recursive: true });
  await assertNotSymlink(root);
  await assertNotSymlink(revisions);
  await mkdir(revisions, { recursive: true });
  await assertNotSymlink(revisions);
  const stagingRevision = path.join(root, `.revision-${randomUUID()}`);
  const finalRevision = revisionDir(root, metadata.revision);
  const stagingCurrent = path.join(root, `.current-${randomUUID()}`);
  try {
    if (await exists(finalRevision)) {
      if (await exists(path.join(root, CURRENT_DIR))) {
        throw new SkillPackageError(`Revision ${metadata.revision} already exists.`);
      }
      const recoveredMetadata = await readMetadata(finalRevision);
      const recoveredFiles = await readPackageFiles(finalRevision);
      await writeTree(stagingCurrent, recoveredFiles, recoveredMetadata);
      await atomicReplaceDirectory(path.join(root, CURRENT_DIR), stagingCurrent);
      return packageFromDirectory(root, path.join(root, CURRENT_DIR));
    }
    await writeTree(stagingRevision, files, metadata);
    await rename(stagingRevision, finalRevision);
    await writeTree(stagingCurrent, files, metadata);
    await atomicReplaceDirectory(path.join(root, CURRENT_DIR), stagingCurrent);
  } catch (error) {
    await rm(stagingRevision, { recursive: true, force: true });
    await rm(stagingCurrent, { recursive: true, force: true });
    throw error;
  }
  return packageFromDirectory(root, path.join(root, CURRENT_DIR));
}

async function migrateLegacyFile(userId: string, rawId: string): Promise<void> {
  const id = safeSkillId(rawId);
  const root = skillRoot(userId, id);
  const legacy = legacyFile(userId, id);
  await withLock(root, async () => {
    if (await exists(path.join(root, CURRENT_DIR))) {
      await unlink(legacy).catch(() => undefined);
      return;
    }
    let parsed: Skill;
    try {
      await assertNotSymlink(legacy);
      parsed = JSON.parse(await readFile(legacy, "utf8")) as Skill;
    } catch {
      return;
    }
    const createdAt = Number.isFinite(parsed.createdAt) ? parsed.createdAt : Date.now();
    const files = new Map([
      [SKILL_ENTRY_FILE, renderSkillMarkdown(parsed.name, parsed.description, parsed.instructions)],
    ]);
    const metadata: StoredSkillMetadata = {
      schemaVersion: 1,
      id,
      name: parsed.name,
      description: parsed.description,
      createdAt,
      updatedAt: createdAt,
      revision: 1,
      source: normalizeSource(parsed.source),
      ...(parsed.sourceDraftId ? { sourceDraftId: parsed.sourceDraftId } : {}),
      ...(parsed.autoLoad ? { autoLoad: true } : {}),
      capabilities: normalizeCapabilities(parsed.capabilities),
      revisionRecord: { revision: 1, createdAt, reason: "migrated" },
    };
    await mkdir(root, { recursive: true });
    await writeRevision(userId, id, files, metadata);
    await unlink(legacy).catch(() => undefined);
  });
}

async function migrateLegacySkills(userId: string): Promise<void> {
  await ensureWorkspaceDirs(userId);
  const entries = await readdir(skillsDirFor(userId), { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    try {
      await migrateLegacyFile(userId, entry.name.slice(0, -5));
    } catch {
      // One corrupt legacy record cannot hide the rest of the library.
    }
  }
}

export async function listSkills(userId: string): Promise<SkillPackage[]> {
  await migrateLegacySkills(userId);
  const entries = await readdir(skillsDirFor(userId), { withFileTypes: true });
  const skills: SkillPackage[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    try {
      const root = skillRoot(userId, entry.name);
      skills.push(await packageFromDirectory(root, path.join(root, CURRENT_DIR)));
    } catch {
      // Skip incomplete or corrupt packages rather than failing discovery.
    }
  }
  return skills.sort((a, b) => b.createdAt - a.createdAt);
}

export async function getSkill(userId: string, id: string): Promise<SkillPackage | null> {
  const safeId = safeSkillId(id);
  await ensureWorkspaceDirs(userId);
  if (await exists(legacyFile(userId, safeId))) await migrateLegacyFile(userId, safeId);
  const root = skillRoot(userId, safeId);
  try {
    return await packageFromDirectory(root, path.join(root, CURRENT_DIR));
  } catch {
    return null;
  }
}

export async function createSkill(userId: string, input: SkillCreateInput): Promise<SkillPackage> {
  await ensureWorkspaceDirs(userId);
  const creationKey = input.sourceDraftId
    ? `${skillsDirFor(userId)}:draft:${input.sourceDraftId}`
    : `${skillsDirFor(userId)}:create:${input.id ?? randomUUID()}`;
  return withLock(creationKey, async () => {
    if (input.sourceDraftId) {
      const existing = (await listSkills(userId)).find(
        (skill) => skill.sourceDraftId === input.sourceDraftId
      );
      if (existing) return existing;
    }
    const id = safeSkillId(input.id ?? randomUUID());
    const root = skillRoot(userId, id);
    const name = requiredText(input.name, "name", 100);
    const description = requiredText(input.description, "description", 300);
    const instructions = requiredText(input.instructions, "instructions", 20_000);
    return withLock(root, async () => {
      if (
        (await exists(path.join(root, CURRENT_DIR))) ||
        (await exists(legacyFile(userId, id)))
      ) {
        throw new SkillPackageError(`Skill ${id} already exists.`);
      }
      const now = Date.now();
      const files = new Map<string, string>([
        [SKILL_ENTRY_FILE, renderSkillMarkdown(name, description, instructions)],
      ]);
      for (const [rawPath, rawContent] of Object.entries(input.files ?? {})) {
        const filePath = normalizeSkillPackagePath(rawPath);
        if (filePath === SKILL_ENTRY_FILE) {
          throw new SkillPackageError("Set skill instructions through the instructions field.");
        }
        files.set(filePath, assertContent(rawContent, filePath));
      }
      const metadata: StoredSkillMetadata = {
        schemaVersion: 1,
        id,
        name,
        description,
        createdAt: now,
        updatedAt: now,
        revision: 1,
        source: normalizeSource(input.source),
        ...(input.sourceDraftId ? { sourceDraftId: input.sourceDraftId } : {}),
        ...(input.autoLoad ? { autoLoad: true } : {}),
        capabilities: validateCapabilities(input.capabilities),
        revisionRecord: { revision: 1, createdAt: now, reason: "created" },
      };
      await mkdir(root, { recursive: true });
      return writeRevision(userId, id, files, metadata);
    });
  });
}

export async function updateSkill(
  userId: string,
  id: string,
  patch: SkillUpdateInput
): Promise<SkillPackage | null> {
  if (
    !["name", "description", "instructions", "autoLoad", "capabilities", "files"].some(
      (field) => Object.prototype.hasOwnProperty.call(patch, field)
    )
  ) {
    throw new SkillPackageError("Skill update must include at least one change.");
  }
  const safeId = safeSkillId(id);
  await ensureWorkspaceDirs(userId);
  if (await exists(legacyFile(userId, safeId))) await migrateLegacyFile(userId, safeId);
  const root = skillRoot(userId, safeId);
  return withLock(root, async () => {
    const current = path.join(root, CURRENT_DIR);
    let existing: SkillPackage;
    let stored: StoredSkillMetadata;
    try {
      [existing, stored] = await Promise.all([
        packageFromDirectory(root, current),
        readMetadata(current),
      ]);
    } catch {
      return null;
    }
    const files = await readPackageFiles(current);
    const name =
      patch.name === undefined ? existing.name : requiredText(patch.name, "name", 100);
    const description =
      patch.description === undefined
        ? existing.description
        : requiredText(patch.description, "description", 300);
    const instructions =
      patch.instructions === undefined
        ? existing.instructions
        : requiredText(patch.instructions, "instructions", 20_000);
    files.set(SKILL_ENTRY_FILE, renderSkillMarkdown(name, description, instructions));
    for (const [rawPath, content] of Object.entries(patch.files ?? {})) {
      const filePath = normalizeSkillPackagePath(rawPath);
      if (filePath === SKILL_ENTRY_FILE) {
        throw new SkillPackageError("Set skill instructions through the instructions field.");
      }
      if (content === null) files.delete(filePath);
      else files.set(filePath, assertContent(content, filePath));
    }
    const now = Date.now();
    const revision = Math.max(existing.revision, await latestRevision(root)) + 1;
    const metadata: StoredSkillMetadata = {
      ...stored,
      name,
      description,
      updatedAt: now,
      revision,
      ...(patch.autoLoad === undefined
        ? {}
        : patch.autoLoad
          ? { autoLoad: true }
          : { autoLoad: undefined }),
      capabilities:
        patch.capabilities === undefined
          ? stored.capabilities
          : validateCapabilities(patch.capabilities),
      revisionRecord: { revision, createdAt: now, reason: "updated" },
    };
    return writeRevision(userId, safeId, files, metadata);
  });
}

export async function listSkillRevisions(userId: string, id: string): Promise<SkillRevision[]> {
  const safeId = safeSkillId(id);
  await ensureWorkspaceDirs(userId);
  if (await exists(legacyFile(userId, safeId))) await migrateLegacyFile(userId, safeId);
  const root = skillRoot(userId, safeId);
  const directory = path.join(root, REVISIONS_DIR);
  await assertNotSymlink(root);
  await assertNotSymlink(directory);
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  const revisions: SkillRevision[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || !/^\d{8}$/.test(entry.name)) continue;
    try {
      const base = path.join(directory, entry.name);
      const metadata = await readMetadata(base);
      revisions.push({
        ...metadata.revisionRecord,
        files: (await listFiles(base)).map((file) => file.path),
      });
    } catch {
      // Ignore an incomplete snapshot.
    }
  }
  return revisions.sort((a, b) => b.revision - a.revision);
}

export async function restoreSkillRevision(
  userId: string,
  id: string,
  targetRevision: number
): Promise<SkillPackage | null> {
  const safeId = safeSkillId(id);
  await ensureWorkspaceDirs(userId);
  if (await exists(legacyFile(userId, safeId))) await migrateLegacyFile(userId, safeId);
  const root = skillRoot(userId, safeId);
  return withLock(root, async () => {
    const current = path.join(root, CURRENT_DIR);
    const target = revisionDir(root, targetRevision);
    let currentMetadata: StoredSkillMetadata;
    let targetMetadata: StoredSkillMetadata;
    try {
      [currentMetadata, targetMetadata] = await Promise.all([
        readMetadata(current),
        readMetadata(target),
      ]);
    } catch {
      return null;
    }
    const files = await readPackageFiles(target);
    const now = Date.now();
    const revision = Math.max(currentMetadata.revision, await latestRevision(root)) + 1;
    const metadata: StoredSkillMetadata = {
      ...targetMetadata,
      id: currentMetadata.id,
      createdAt: currentMetadata.createdAt,
      updatedAt: now,
      revision,
      revisionRecord: {
        revision,
        createdAt: now,
        reason: "restored",
        restoredFrom: targetRevision,
      },
    };
    return writeRevision(userId, safeId, files, metadata);
  });
}

export async function readSkillPackageFile(
  userId: string,
  id: string,
  rawPath: string,
  revision?: number
): Promise<string | null> {
  const safeId = safeSkillId(id);
  await ensureWorkspaceDirs(userId);
  if (await exists(legacyFile(userId, safeId))) await migrateLegacyFile(userId, safeId);
  const root = skillRoot(userId, safeId);
  const relative = normalizeSkillPackagePath(rawPath);
  const base = revision == null ? path.join(root, CURRENT_DIR) : revisionDir(root, revision);
  try {
    await assertNotSymlink(base);
    let cursor = base;
    for (const segment of relative.split("/")) {
      cursor = path.join(cursor, segment);
      await assertNotSymlink(cursor);
    }
    return await readFile(path.join(base, relative), "utf8");
  } catch (error) {
    if (error instanceof SkillPackageError) throw error;
    return null;
  }
}

export async function writeSkillPackageFile(
  userId: string,
  id: string,
  filePath: string,
  content: string | null
): Promise<SkillPackage | null> {
  return updateSkill(userId, id, { files: { [filePath]: content } });
}

export async function viewSkillPackage(
  userId: string,
  id: string,
  options: { path?: string; revision?: number } = {}
): Promise<SkillPackageView | null> {
  const skill = await getSkill(userId, id);
  if (!skill) return null;
  const revisions = await listSkillRevisions(userId, id);
  const target = options.revision ?? skill.revision;
  const revision = revisions.find((item) => item.revision === target);
  if (!revision) return null;
  const filePath = options.path ? normalizeSkillPackagePath(options.path) : undefined;
  const content = filePath
    ? await readSkillPackageFile(userId, id, filePath, target)
    : undefined;
  if (filePath && content === null) return null;
  return { skill, revision, ...(filePath ? { path: filePath, content: content! } : {}) };
}

export async function snapshotSkillPackage(
  userId: string,
  id: string,
  revision?: number
): Promise<SkillPackageSnapshot | null> {
  const skill = await getSkill(userId, id);
  if (!skill) return null;
  const targetRevision = revision ?? skill.revision;
  const root = skillRoot(userId, id);
  const base = revisionDir(root, targetRevision);
  try {
    const metadata = await readMetadata(base);
    const files = Object.fromEntries(await readPackageFiles(base));
    return {
      id: skill.id,
      name: metadata.name,
      description: metadata.description,
      revision: targetRevision,
      files,
    };
  } catch {
    return null;
  }
}

export async function listSkillCatalog(userId: string, query = ""): Promise<SkillCatalogEntry[]> {
  const terms = [...new Set(query.toLowerCase().match(/[a-z0-9_-]+/g) ?? [])];
  const scored = (await listSkills(userId)).map((skill) => {
    const name = skill.name.toLowerCase();
    const description = skill.description.toLowerCase();
    const filePaths = skill.files.map((file) => file.path.toLowerCase());
    const matchedOn: string[] = [];
    let score = 0;
    for (const term of terms) {
      if (name.includes(term)) {
        score += 5;
        matchedOn.push("name");
      }
      if (description.includes(term)) {
        score += 2;
        matchedOn.push("description");
      }
      if (filePaths.some((file) => file.includes(term))) {
        score += 1;
        matchedOn.push("files");
      }
    }
    const entry: SkillCatalogEntry = {
      id: skill.id,
      name: skill.name,
      description: skill.description,
      source: skill.source,
      capabilities: skill.capabilities,
      autoLoad: skill.autoLoad,
      updatedAt: skill.updatedAt,
      revision: skill.revision,
      ...(matchedOn.length ? { matchedOn: [...new Set(matchedOn)] } : {}),
    };
    return { entry, score };
  });
  return scored
    .filter(({ score }) => !terms.length || score > 0)
    .sort((a, b) => b.score - a.score || b.entry.updatedAt - a.entry.updatedAt)
    .map(({ entry }) => entry);
}

export async function manageSkillPackage(
  userId: string,
  input: SkillManageInput
): Promise<SkillManageResult> {
  if (!input || typeof input !== "object") {
    throw new SkillPackageError("Skill management input must be an object.");
  }
  const raw = input as unknown as Record<string, unknown>;
  switch (raw.action) {
    case "create": {
      const files = validateManagedFiles(raw.files, false);
      const skill = await createSkill(userId, {
        id: typeof raw.id === "string" ? raw.id : undefined,
        name: raw.name as string,
        description: raw.description as string,
        instructions: raw.instructions as string,
        source: "generated",
        autoLoad: false,
        capabilities: raw.capabilities as Skill["capabilities"],
        files: files as Record<string, string> | undefined,
      });
      return { action: "create", skill };
    }
    case "update": {
      if (typeof raw.id !== "string") {
        throw new SkillPackageError("id is required when updating a skill.");
      }
      const files = validateManagedFiles(raw.files, true);
      const skill = await updateSkill(userId, raw.id, {
        ...(raw.name !== undefined ? { name: raw.name as string } : {}),
        ...(raw.description !== undefined
          ? { description: raw.description as string }
          : {}),
        ...(raw.instructions !== undefined
          ? { instructions: raw.instructions as string }
          : {}),
        ...(raw.capabilities !== undefined
          ? { capabilities: raw.capabilities as Skill["capabilities"] }
          : {}),
        ...(files !== undefined ? { files } : {}),
      });
      if (!skill) throw new SkillPackageError("Skill not found.");
      return { action: "update", skill };
    }
    case "restore": {
      if (
        typeof raw.id !== "string" ||
        !Number.isSafeInteger(raw.revision) ||
        (raw.revision as number) < 1
      ) {
        throw new SkillPackageError("id and a positive revision are required to restore.");
      }
      const skill = await restoreSkillRevision(userId, raw.id, raw.revision as number);
      if (!skill) throw new SkillPackageError("Skill or revision not found.");
      return { action: "restore", skill };
    }
    case "delete": {
      if (typeof raw.id !== "string") {
        throw new SkillPackageError("id is required when deleting a skill.");
      }
      return { action: "delete", id: raw.id, deleted: await deleteSkill(userId, raw.id) };
    }
    default:
      throw new SkillPackageError("Unknown skill management action.");
  }
}

export async function listAutoLoadSkills(userId: string): Promise<SkillPackage[]> {
  return (await listSkills(userId)).filter((skill) => skill.autoLoad);
}

export async function resolveSkills(
  userId: string,
  rootIds: readonly string[]
): Promise<SkillPackage[]> {
  const installed = await listSkills(userId);
  const byId = new Map(installed.map((skill) => [skill.id, skill]));
  const visiting = new Set<string>();
  const resolved = new Set<string>();
  const ordered: SkillPackage[] = [];
  const visit = (id: string) => {
    if (resolved.has(id) || visiting.has(id)) return;
    const skill = byId.get(id);
    if (!skill) return;
    visiting.add(id);
    for (const dependencyId of skill.capabilities?.skills ?? []) visit(dependencyId);
    visiting.delete(id);
    resolved.add(id);
    ordered.push(skill);
  };
  for (const id of rootIds) visit(id);
  return ordered;
}

export async function deleteSkill(userId: string, id: string): Promise<boolean> {
  const safeId = safeSkillId(id);
  const root = skillRoot(userId, safeId);
  return withLock(root, async () => {
    const packageExists = await exists(root);
    const legacyExists = await exists(legacyFile(userId, safeId));
    if (!packageExists && !legacyExists) return false;
    if (packageExists) {
      await assertNotSymlink(root);
      await rm(root, { recursive: true, force: false });
    }
    if (legacyExists) await unlink(legacyFile(userId, safeId));
    return true;
  });
}
