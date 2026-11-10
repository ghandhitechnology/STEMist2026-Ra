import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Skill } from "@/lib/types";

let workspace: string;

async function loadStore() {
  vi.resetModules();
  vi.stubEnv("RAUCHAT_WORKSPACE", workspace);
  return import("./skills");
}

beforeEach(async () => {
  workspace = await mkdtemp(path.join(tmpdir(), "rauchat-skills-"));
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(workspace, { recursive: true, force: true });
});

describe("skill packages", () => {
  it("migrates legacy JSON once and preserves identity and settings", async () => {
    const skillsDir = path.join(workspace, "users", "user_a", "skills");
    await mkdir(skillsDir, { recursive: true });
    const legacy: Skill = {
      id: "legacy-id",
      name: "Legacy skill",
      description: "Old storage",
      instructions: "Keep this procedure.",
      createdAt: 42,
      source: "generated",
      sourceDraftId: "draft-1",
      autoLoad: true,
      capabilities: { tools: ["web_search"], skills: ["dependency"] },
    };
    await writeFile(
      path.join(skillsDir, "legacy-id.json"),
      JSON.stringify(legacy),
      "utf8"
    );

    const store = await loadStore();
    const [first, concurrent] = await Promise.all([
      store.listSkills("user_a"),
      store.listSkills("user_a"),
    ]);
    const second = await store.listSkills("user_a");

    expect(first).toHaveLength(1);
    expect(concurrent).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(first[0]).toMatchObject({
      id: "legacy-id",
      source: "generated",
      sourceDraftId: "draft-1",
      autoLoad: true,
      capabilities: { tools: ["web_search"], skills: ["dependency"] },
      revision: 1,
      revisionCount: 1,
    });
    expect(
      await readFile(
        path.join(skillsDir, "legacy-id", "current", "SKILL.md"),
        "utf8"
      )
    ).toContain("Keep this procedure.");
  });

  it("creates and updates a package with scripts and references", async () => {
    const store = await loadStore();
    const created = await store.createSkill("user_a", {
      id: "package-one",
      name: "Package one",
      description: "Uses supporting files",
      instructions: "Read the reference before working.",
      files: {
        "scripts/check.sh": "#!/bin/sh\nexit 0\n",
        "references/guide.md": "# Guide\n",
      },
    });
    expect(created.files.map((file) => file.path)).toEqual([
      "references/guide.md",
      "scripts/check.sh",
      "SKILL.md",
    ]);

    const updated = await store.updateSkill("user_a", created.id, {
      instructions: "Use the revised process.",
      files: {
        "scripts/check.sh": "#!/bin/sh\nexit 1\n",
        "references/guide.md": null,
      },
    });
    expect(updated).toMatchObject({ revision: 2, revisionCount: 2 });
    expect(
      await store.readSkillPackageFile("user_a", created.id, "scripts/check.sh")
    ).toContain("exit 1");
    expect(
      await store.readSkillPackageFile("user_a", created.id, "references/guide.md")
    ).toBeNull();
  });

  it("rejects paths outside scripts and references and refuses symlinks", async () => {
    const store = await loadStore();
    await expect(
      store.createSkill("user_a", {
        name: "Unsafe",
        description: "Unsafe paths",
        instructions: "No.",
        files: { "scripts/../../escape.sh": "bad" },
      })
    ).rejects.toThrow(/unsafe package path/i);

    const skill = await store.createSkill("user_a", {
      id: "linked",
      name: "Linked",
      description: "Symlink check",
      instructions: "Read scripts.",
    });
    const scripts = path.join(
      workspace,
      "users",
      "user_a",
      "skills",
      skill.id,
      "current",
      "scripts"
    );
    await mkdir(scripts, { recursive: true });
    await symlink("/etc/hosts", path.join(scripts, "hosts"));
    await expect(store.getSkill("user_a", skill.id)).resolves.toBeNull();
  });

  it("restores every package file as a new revision", async () => {
    const store = await loadStore();
    const created = await store.createSkill("user_a", {
      name: "Restorable",
      description: "Revision test",
      instructions: "Version one.",
      files: { "scripts/run.sh": "one" },
    });
    await store.updateSkill("user_a", created.id, {
      instructions: "Version two.",
      files: {
        "scripts/run.sh": "two",
        "references/new.md": "new",
      },
    });

    const restored = await store.restoreSkillRevision("user_a", created.id, 1);
    expect(restored).toMatchObject({ instructions: "Version one.", revision: 3 });
    expect(
      await store.readSkillPackageFile("user_a", created.id, "scripts/run.sh")
    ).toBe("one");
    expect(
      await store.readSkillPackageFile("user_a", created.id, "references/new.md")
    ).toBeNull();
    expect((await store.listSkillRevisions("user_a", created.id))[0]).toMatchObject({
      revision: 3,
      reason: "restored",
      restoredFrom: 1,
    });
  });

  it("serializes concurrent updates into distinct revisions", async () => {
    const store = await loadStore();
    const created = await store.createSkill("user_a", {
      name: "Concurrent",
      description: "Revision lock",
      instructions: "Original.",
    });
    await Promise.all([
      store.updateSkill("user_a", created.id, { description: "First update" }),
      store.updateSkill("user_a", created.id, { instructions: "Second update" }),
    ]);
    const current = await store.getSkill("user_a", created.id);
    expect(current).toMatchObject({
      revision: 3,
      revisionCount: 3,
      description: "First update",
      instructions: "Second update",
    });
    expect((await store.listSkillRevisions("user_a", created.id)).map((item) => item.revision)).toEqual([
      3, 2, 1,
    ]);
  });

  it("deduplicates concurrent installs of the same generated draft", async () => {
    const store = await loadStore();
    const input = {
      name: "Learned skill",
      description: "Created from a reviewed draft",
      instructions: "Follow the learned procedure.",
      source: "generated" as const,
      sourceDraftId: "draft-shared",
    };
    const [first, second] = await Promise.all([
      store.createSkill("user_a", input),
      store.createSkill("user_a", input),
    ]);
    expect(first.id).toBe(second.id);
    expect(await store.listSkills("user_a")).toHaveLength(1);
  });

  it("scopes package reads and writes to one user", async () => {
    const store = await loadStore();
    await store.createSkill("user_a", {
      id: "shared-id",
      name: "User A",
      description: "Private to A",
      instructions: "A instructions.",
      files: { "references/private.md": "A only" },
    });
    await store.createSkill("user_b", {
      id: "shared-id",
      name: "User B",
      description: "Private to B",
      instructions: "B instructions.",
      files: { "references/private.md": "B only" },
    });
    expect(await store.readSkillPackageFile("user_a", "shared-id", "references/private.md"))
      .toBe("A only");
    expect(await store.readSkillPackageFile("user_b", "shared-id", "references/private.md"))
      .toBe("B only");
  });

  it("validates agent management actions and forces generated source", async () => {
    const store = await loadStore();
    const created = await store.manageSkillPackage("user_a", {
      action: "create",
      name: "Managed",
      description: "Agent-created package",
      instructions: "Use the managed process.",
      source: "manual",
      autoLoad: true,
    });
    expect(created.action).toBe("create");
    if (created.action !== "create") throw new Error("Expected a created skill.");
    expect(created.skill).toMatchObject({ source: "generated" });
    expect(created.skill.autoLoad).toBeUndefined();

    await expect(
      store.manageSkillPackage("user_a", {
        action: "unknown",
        id: created.skill.id,
      } as never)
    ).rejects.toThrow(/unknown skill management action/i);
    expect(await store.getSkill("user_a", created.skill.id)).not.toBeNull();

    await expect(
      store.manageSkillPackage("user_a", {
        action: "update",
        id: created.skill.id,
        files: { "scripts/../../outside.sh": "bad" },
      })
    ).rejects.toThrow(/unsafe package path/i);
    await expect(
      store.manageSkillPackage("user_a", {
        action: "update",
        id: created.skill.id,
        capabilities: { tools: ["unknown_tool"], skills: [] },
      } as never)
    ).rejects.toThrow(/unknown tool/i);
  });

  it("keeps immutable snapshots consistent after the live package changes", async () => {
    const store = await loadStore();
    const created = await store.createSkill("user_a", {
      name: "Snapshot",
      description: "Frozen package",
      instructions: "Version one.",
      files: { "scripts/check.py": "print('one')" },
    });
    const frozen = await store.snapshotSkillPackage("user_a", created.id, 1);
    await store.updateSkill("user_a", created.id, {
      instructions: "Version two.",
      files: { "scripts/check.py": "print('two')" },
    });
    expect(frozen?.files["SKILL.md"]).toContain("Version one.");
    expect(frozen?.files["scripts/check.py"]).toBe("print('one')");
    expect(
      (await store.snapshotSkillPackage("user_a", created.id, 1))?.files[
        "scripts/check.py"
      ]
    ).toBe("print('one')");
  });

  it("blocks the legacy workspace writer from changing skill packages", async () => {
    const store = await loadStore();
    const workspaceStore = await import("./workspace");
    const created = await store.createSkill("user_a", {
      name: "Protected",
      description: "Workspace write guard",
      instructions: "Keep revisions.",
    });
    await expect(
      workspaceStore.writeWorkspaceFile(
        "user_a",
        `skills/${created.id}/current/SKILL.md`,
        "bypass"
      )
    ).rejects.toThrow(/skill management/i);
    expect((await store.getSkill("user_a", created.id))?.instructions).toBe(
      "Keep revisions."
    );
  });
});
