import type { SkillPackageSnapshot } from "@/lib/skill-types";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  writeFile,
} from "node:fs/promises";
import { userWorkspaceRoot } from "../paths";
import { workflowDirectory } from "../workflows/store";
import { withWorkspaceLock } from "../workspace-lock";

const ROOT = "/home/user/workspace";
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_SEED_BYTES = 100 * 1024 * 1024;
export const sandboxAvailable = () => Boolean(process.env.E2B_API_KEY);
export function sandboxPath(input: string) {
  if (
    !input ||
    input.includes("\\") ||
    input.startsWith("/") ||
    input.split("/").some((p) => p === "..")
  )
    throw new Error("Use a workspace-relative path.");
  return path.posix.join(ROOT, input);
}
const hash = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const quote = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;
/** The SDK gets only its connection key; no application environment is forwarded. */
export class WorkflowSandbox {
  private remote?: import("e2b").Sandbox;
  private connecting?: Promise<void>;
  readonly baseline: Record<string, string>;
  constructor(
    readonly userId: string,
    readonly workflowId: string,
    private options: {
      sandboxId?: string;
      baseline?: Record<string, string>;
      skillIds?: string[];
      skillSnapshots?: SkillPackageSnapshot[];
      onReady?: (id: string, baseline: Record<string, string>) => Promise<void>;
    } = {},
  ) {
    this.baseline = options.baseline ?? {};
  }
  private async connect() {
    if (this.remote) return this.remote;
    if (!this.connecting)
      this.connecting = (async () => {
        if (!sandboxAvailable())
          throw new Error("E2B_API_KEY is required for workspace execution.");
        const { Sandbox } = await import("e2b");
        this.remote = this.options.sandboxId
          ? await Sandbox.connect(this.options.sandboxId)
          : await Sandbox.create({
              timeoutMs: 900000,
              metadata: {
                app: "rauchat",
                userId: this.userId,
                workflowId: this.workflowId,
              },
            });
        if (!this.options.sandboxId) {
          await this.remote.commands.run(`mkdir -p ${quote(ROOT)}`);
          let bytes = 0;
          const walk = async (relative: string) => {
            const dir = await safeLocalPath(this.userId, relative || ".");
            let entries;
            try {
              entries = await readdir(dir, { withFileTypes: true });
            } catch (e) {
              if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
              throw e;
            }
            for (const entry of entries) {
              if (entry.isSymbolicLink() || entry.name.startsWith("."))
                continue;
              const rel = relative ? `${relative}/${entry.name}` : entry.name;
              // Skills are seeded only when selected; revision history never enters the sandbox.
              if (rel === "skills" || rel.startsWith("skills/")) {
                if (this.options.skillSnapshots) continue;
                const id = rel.split("/")[1]?.replace(/\.json$/, "");
                if (id && !this.options.skillIds?.includes(id)) continue;
                const parts = rel.split("/");
                if (parts.length >= 3 && parts[2] !== "current") continue;
              }
              if (entry.isDirectory()) {
                await walk(rel);
                continue;
              }
              if (!entry.isFile()) continue;
              const file = await safeLocalPath(this.userId, rel);
              const stat = await lstat(file);
              if (stat.size > MAX_FILE_BYTES)
                throw new Error(`Seed file exceeds 20 MB: ${rel}`);
              bytes += stat.size;
              if (bytes > MAX_SEED_BYTES)
                throw new Error("Workspace seed exceeds 100 MB.");
              const data = await readFile(file);
              this.baseline[rel] = hash(data);
              await this.remote!.files.write(
                sandboxPath(rel),
                new Uint8Array(data).buffer,
              );
            }
          };
          await walk("");
          for (const skill of this.options.skillSnapshots ?? []) {
            for (const [relative, content] of Object.entries(skill.files)) {
              await this.remote.files.write(
                sandboxPath(`skills/${skill.id}/current/${relative}`),
                content,
              );
            }
          }
        }
        await this.options.onReady?.(this.remote.sandboxId, this.baseline);
      })().catch(async (e) => {
        await this.remote?.kill().catch(() => undefined);
        this.remote = undefined;
        this.connecting = undefined;
        throw e;
      });
    await this.connecting;
    return this.remote!;
  }
  async read(relative: string) {
    const remote = await this.connect();
    await this.checkRemotePath(relative);
    return remote.files.read(sandboxPath(relative));
  }
  async write(relative: string, content: string) {
    if (relative === "skills" || relative.startsWith("skills/"))
      throw new Error("Use skill management tools to change skills.");
    const remote = await this.connect();
    await this.checkRemotePath(relative);
    if (Buffer.byteLength(content) > MAX_FILE_BYTES)
      throw new Error("File exceeds 20 MB.");
    await remote.files.write(sandboxPath(relative), content);
    return `Wrote ${relative}`;
  }
  async edit(relative: string, oldText: string, newText: string) {
    if (!oldText) throw new Error("oldText must not be empty.");
    const content = await this.read(relative);
    const count = content.split(oldText).length - 1;
    if (count !== 1)
      throw new Error(`Expected exactly one match; found ${count}.`);
    return this.write(relative, content.replace(oldText, newText));
  }
  private async checkRemotePath(relative: string) {
    const remote = await this.connect();
    const full = sandboxPath(relative);
    // Shell commands can create symlinks; SDK reads/writes must never follow one outside the workspace.
    const check = await remote.commands.run(
      `python3 -c ${quote("import os,sys; p=os.path.realpath(sys.argv[1]); root=sys.argv[2]; assert p == root or p.startswith(root + '/'), 'Path escapes workspace'")} ${quote(full)} ${quote(ROOT)}`,
    );
    if (check.exitCode !== 0) throw new Error("Path escapes workspace.");
  }
  async bash(
    command: string,
    signal?: AbortSignal,
    onOutput?: (text: string) => void,
  ) {
    signal?.throwIfAborted();
    const remote = await this.connect();
    signal?.throwIfAborted();
    const handle = await remote.commands.run(command, {
      cwd: ROOT,
      background: true,
      timeoutMs: 120000,
      onStdout: onOutput,
      onStderr: onOutput,
    });
    const abort = () => {
      void handle.kill().catch(() => undefined);
    };
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    try {
      const result = await handle.wait();
      signal?.throwIfAborted();
      return {
        stdout: result.stdout.slice(-100000),
        stderr: result.stderr.slice(-100000),
        exitCode: result.exitCode,
      };
    } finally {
      signal?.removeEventListener("abort", abort);
    }
  }
  async ls(relative = ".") {
    const remote = await this.connect();
    await this.checkRemotePath(relative);
    return remote.files.list(sandboxPath(relative));
  }
  async find(pattern: string, relative = ".", signal?: AbortSignal) {
    await this.checkRemotePath(relative);
    return this.bash(
      `find ${quote(sandboxPath(relative))} -type f -name ${quote(pattern)} -print | head -n 500`,
      signal,
    );
  }
  async grep(pattern: string, relative = ".", signal?: AbortSignal) {
    await this.checkRemotePath(relative);
    return this.bash(
      `grep -rIn -m 100 -- ${quote(pattern)} ${quote(sandboxPath(relative))} | head -n 500`,
      signal,
    );
  }
  async publish(outputs: string[]) {
    return withWorkspaceLock(this.userId, () => this.publishLocked(outputs));
  }
  private async publishLocked(outputs: string[]) {
    const remote = await this.connect();
    const published: string[] = [];
    const conflicts: string[] = [];
    for (const relative of [...new Set(outputs)]) {
      if (relative === "skills" || relative.startsWith("skills/"))
        throw new Error("Use skill management tools to change skills.");
      await this.checkRemotePath(relative);
      const data = Buffer.from(
        await remote.files.read(sandboxPath(relative), { format: "bytes" }),
      );
      if (data.length > MAX_FILE_BYTES)
        throw new Error(`Output exceeds 20 MB: ${relative}`);
      const destination = await safeLocalPath(this.userId, relative);
      let current: string | undefined;
      try {
        current = hash(await readFile(destination));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
      if (current !== this.baseline[relative]) {
        const staged = path.join(
          workflowDirectory(this.userId),
          "conflicts",
          this.workflowId,
          relative,
        );
        await mkdir(path.dirname(staged), { recursive: true });
        await writeFile(staged, data);
        conflicts.push(relative);
        continue;
      }
      await mkdir(path.dirname(destination), { recursive: true });
      await safeLocalPath(this.userId, relative);
      const tmp = `${destination}.${randomUUID()}.tmp`;
      await writeFile(tmp, data);
      await rename(tmp, destination);
      this.baseline[relative] = hash(data);
      published.push(relative);
    }
    return { published, conflicts };
  }
  async pause() {
    if (this.remote) {
      await this.remote.betaPause();
      this.options.sandboxId = this.remote.sandboxId;
      this.remote = undefined;
      this.connecting = undefined;
    }
  }
  async kill() {
    if (this.remote) await this.remote.kill();
    else if (this.options.sandboxId && sandboxAvailable()) {
      const { Sandbox } = await import("e2b");
      await Sandbox.kill(this.options.sandboxId);
    }
    this.remote = undefined;
    this.connecting = undefined;
  }
}
/** Reject symlink ancestors, including an existing file, before host-side synchronization. */
async function safeLocalPath(userId: string, relative: string) {
  const root = userWorkspaceRoot(userId);
  const target = path.resolve(root, relative);
  if (target !== root && !target.startsWith(root + path.sep))
    throw new Error("Path escapes workspace.");
  const parts = path.relative(root, target).split(path.sep).filter(Boolean);
  let current = root;
  for (const part of ["", ...parts]) {
    current = part ? path.join(current, part) : current;
    try {
      if ((await lstat(current)).isSymbolicLink())
        throw new Error("Workspace symlinks cannot be synchronized.");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
  }
  return target;
}
