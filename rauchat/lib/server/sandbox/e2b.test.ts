import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
const remoteFiles = new Map<string, Uint8Array | string>();
const remote = {
  sandboxId: "remote-test",
  files: {
    write: vi.fn(async (p: string, data: ArrayBuffer | string) => {
      remoteFiles.set(
        p,
        typeof data === "string" ? data : new Uint8Array(data),
      );
    }),
    read: vi.fn(async (p: string, options?: { format: string }) => {
      const value = remoteFiles.get(p);
      if (value === undefined) throw new Error(`Missing ${p}`);
      return options?.format === "bytes"
        ? Buffer.from(value)
        : Buffer.from(value).toString();
    }),
    list: vi.fn(async () => []),
  },
  commands: {
    run: vi.fn(async () => ({ exitCode: 0, stdout: "", stderr: "" })),
  },
  betaPause: vi.fn(async () => true),
  kill: vi.fn(async () => true),
};
vi.mock("e2b", () => ({
  Sandbox: {
    create: vi.fn(async () => remote),
    connect: vi.fn(async () => remote),
    kill: vi.fn(async () => true),
  },
}));
let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "sandbox-tests-"));
  vi.stubEnv("RAUCHAT_WORKSPACE", root);
  vi.stubEnv("E2B_API_KEY", "test-key");
  vi.resetModules();
  remoteFiles.clear();
  remote.commands.run.mockResolvedValue({
    exitCode: 0,
    stdout: "",
    stderr: "",
  });
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});
async function local(relative: string, data: string) {
  const target = path.join(root, "users", "user_a", relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, data);
}
describe("E2B workspace boundary", () => {
  it("seeds user files and selected current skills without credentials or revision history", async () => {
    await local("input.txt", "input");
    await local(".env", "secret");
    await local("skills/selected/current/SKILL.md", "current");
    await local("skills/selected/revisions/r1/SKILL.md", "history");
    await local("skills/unselected/current/SKILL.md", "other");
    const { WorkflowSandbox } = await import("./e2b");
    const box = new WorkflowSandbox("user_a", "run", {
      skillIds: ["selected"],
    });
    await box.ls();
    expect([...remoteFiles.keys()]).toEqual([
      "/home/user/workspace/input.txt",
      "/home/user/workspace/skills/selected/current/SKILL.md",
    ]);
  });
  it("rejects traversal, symlink escapes, and skill writes", async () => {
    const { WorkflowSandbox, sandboxPath } = await import("./e2b");
    expect(() => sandboxPath("../secret")).toThrow();
    expect(() => sandboxPath("/etc/passwd")).toThrow();
    const box = new WorkflowSandbox("user_a", "run");
    await expect(box.write("skills/x/SKILL.md", "changed")).rejects.toThrow(
      /skill management/,
    );
    await box.ls();
    remote.commands.run.mockResolvedValue({
      exitCode: 1,
      stdout: "",
      stderr: "escaped",
    });
    await expect(box.read("link")).rejects.toThrow(/escapes/);
  });
  it("publishes declared outputs and stages files changed since seeding", async () => {
    await local("input.txt", "original");
    const { WorkflowSandbox } = await import("./e2b");
    const box = new WorkflowSandbox("user_a", "run");
    await box.ls();
    remoteFiles.set("/home/user/workspace/input.txt", "agent change");
    remoteFiles.set("/home/user/workspace/output.txt", "new artifact");
    await local("input.txt", "concurrent change");
    expect(await box.publish(["input.txt", "output.txt"])).toEqual({
      published: ["output.txt"],
      conflicts: ["input.txt"],
    });
    expect(
      await readFile(path.join(root, "users/user_a/input.txt"), "utf8"),
    ).toBe("concurrent change");
    expect(
      await readFile(
        path.join(root, "workflows/user_a/conflicts/run/input.txt"),
        "utf8",
      ),
    ).toBe("agent change");
  });
  it("serializes competing workflow publication so only one writer wins", async () => {
    await local("input.txt", "original");
    const { WorkflowSandbox } = await import("./e2b");
    const a = new WorkflowSandbox("user_a", "a");
    const b = new WorkflowSandbox("user_a", "b");
    await a.ls();
    await b.ls();
    remoteFiles.set("/home/user/workspace/input.txt", "replacement");
    const results = await Promise.all([
      a.publish(["input.txt"]),
      b.publish(["input.txt"]),
    ]);
    expect(results.filter((r) => r.published.length)).toHaveLength(1);
    expect(results.filter((r) => r.conflicts.length)).toHaveLength(1);
  });
  it("rejects host symlink destinations", async () => {
    const { WorkflowSandbox } = await import("./e2b");
    const box = new WorkflowSandbox("user_a", "run");
    await box.ls();
    await mkdir(path.join(root, "users/user_a"), { recursive: true });
    await symlink(root, path.join(root, "users/user_a/link"));
    remoteFiles.set("/home/user/workspace/link/out.txt", "no");
    await expect(box.publish(["link/out.txt"])).rejects.toThrow(/symlinks/);
  });
  it("uses a workflow's frozen skill files after the live skill changes", async () => {
    await local("skills/selected/current/SKILL.md", "updated instructions");
    const { WorkflowSandbox } = await import("./e2b");
    const box = new WorkflowSandbox("user_a", "run", {
      skillIds: ["selected"],
      skillSnapshots: [
        {
          id: "selected",
          name: "Selected",
          description: "test",
          revision: 1,
          files: {
            "SKILL.md": "frozen instructions",
            "scripts/check.py": "print('checked')",
          },
        },
      ],
    });
    await box.ls();
    expect(
      remoteFiles.get("/home/user/workspace/skills/selected/current/SKILL.md"),
    ).toBe("frozen instructions");
    expect(
      remoteFiles.get(
        "/home/user/workspace/skills/selected/current/scripts/check.py",
      ),
    ).toBe("print('checked')");
  });
});
