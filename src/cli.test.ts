import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { runMigrations } from "./migrate.js";

const execFileAsync = promisify(execFile);

const DB_CONFIG = {
  user: "flapjack",
  password: "flapjack",
  host: "localhost",
  port: 5432,
};

const TEST_DB_NAME = "flapjack_cli_test";
const TEST_DB_URL = `postgres://${DB_CONFIG.user}:${DB_CONFIG.password}@${DB_CONFIG.host}:${DB_CONFIG.port}/${TEST_DB_NAME}`;

async function runCli(args: string[], env: NodeJS.ProcessEnv = {}) {
  const cliPath = path.resolve(process.cwd(), "dist/cli.js");
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [cliPath, ...args],
      {
        env: { ...process.env, ...env },
      },
    );
    return { code: 0, stdout, stderr };
  } catch (err: any) {
    return {
      code: err?.code ?? 1,
      stdout: err?.stdout ?? "",
      stderr: err?.stderr ?? String(err),
    };
  }
}

let adminPool: Pool;

describe("CLI smoke", () => {
  beforeAll(async () => {
    const setupPool = new Pool({ ...DB_CONFIG, database: "postgres" });
    try {
      await setupPool.query(`DROP DATABASE IF EXISTS ${TEST_DB_NAME}`);
      await setupPool.query(`CREATE DATABASE ${TEST_DB_NAME}`);
    } finally {
      await setupPool.end();
    }

    adminPool = new Pool({ ...DB_CONFIG, database: TEST_DB_NAME });

    await runMigrations({
      databaseUrl: TEST_DB_URL,
    });
  });

  afterAll(async () => {
    await adminPool.end();
    const cleanupPool = new Pool({ ...DB_CONFIG, database: "postgres" });
    try {
      await cleanupPool.query(`DROP DATABASE IF EXISTS ${TEST_DB_NAME}`);
    } finally {
      await cleanupPool.end();
    }
  });

  it("prints help", async () => {
    const res = await runCli(["--help"], { DATABASE_URL: TEST_DB_URL });
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("Commands:");
    expect(res.stdout).toContain("flapjack create");
  });

  it("create/get/is-active/update/delete works", async () => {
    // create
    const createRes = await runCli(
      [
        "create",
        "--name",
        "cli-test-flag",
        "--roles",
        "admin",
        "--note",
        "created via cli smoke",
      ],
      { DATABASE_URL: TEST_DB_URL },
    );
    expect(createRes.code).toBe(0);
    const created = JSON.parse(createRes.stdout.trim());
    expect(created.name).toBe("cli-test-flag");

    // get-by-name
    const getByNameRes = await runCli(["get-by-name", "cli-test-flag"], {
      DATABASE_URL: TEST_DB_URL,
    });
    expect(getByNameRes.code).toBe(0);
    const fetched = JSON.parse(getByNameRes.stdout.trim());
    expect(fetched.id).toBe(created.id);

    // is-active by role
    const isActiveRes = await runCli(
      ["is-active", "cli-test-flag", "--roles", "admin"],
      {
        DATABASE_URL: TEST_DB_URL,
      },
    );
    expect(isActiveRes.code).toBe(0);
    const activePayload = JSON.parse(isActiveRes.stdout.trim());
    expect(activePayload.isActive).toBe(true);

    // update: clear roles, ensure inactive now
    const updateRes = await runCli(
      ["update", String(created.id), "--clear-roles"],
      { DATABASE_URL: TEST_DB_URL },
    );
    expect(updateRes.code).toBe(0);

    const isActiveRes2 = await runCli(
      ["is-active", "cli-test-flag", "--roles", "admin"],
      {
        DATABASE_URL: TEST_DB_URL,
      },
    );
    expect(isActiveRes2.code).toBe(0);
    const activePayload2 = JSON.parse(isActiveRes2.stdout.trim());
    expect(activePayload2.isActive).toBe(false);

    // delete
    const deleteRes = await runCli(["delete", String(created.id)], {
      DATABASE_URL: TEST_DB_URL,
    });
    expect(deleteRes.code).toBe(0);
    expect(deleteRes.stdout).toContain("deleted successfully");
  });

  it("handles expires field correctly", async () => {
    // Create with expires
    const expiresDate = "2026-12-31T23:59:59Z";
    const createRes = await runCli(
      [
        "create",
        "--name",
        "cli-test-expires-flag",
        "--everyone",
        "true",
        "--expires",
        expiresDate,
        "--note",
        "testing expires field",
      ],
      { DATABASE_URL: TEST_DB_URL },
    );
    expect(createRes.code).toBe(0);
    const created = JSON.parse(createRes.stdout.trim());
    expect(created.name).toBe("cli-test-expires-flag");
    expect(new Date(created.expires).toISOString()).toBe(
      new Date(expiresDate).toISOString(),
    );

    // Get and verify expires is present
    const getRes = await runCli(["get", String(created.id)], {
      DATABASE_URL: TEST_DB_URL,
    });
    expect(getRes.code).toBe(0);
    const fetched = JSON.parse(getRes.stdout.trim());
    expect(new Date(fetched.expires).toISOString()).toBe(
      new Date(expiresDate).toISOString(),
    );

    // Update expires to a new date
    const newExpiresDate = "2027-06-15T12:00:00Z";
    const updateRes = await runCli(
      ["update", String(created.id), "--expires", newExpiresDate],
      { DATABASE_URL: TEST_DB_URL },
    );
    expect(updateRes.code).toBe(0);
    const updated = JSON.parse(updateRes.stdout.trim());
    expect(new Date(updated.expires).toISOString()).toBe(
      new Date(newExpiresDate).toISOString(),
    );

    // Clear expires
    const clearRes = await runCli(
      ["update", String(created.id), "--clear-expires"],
      { DATABASE_URL: TEST_DB_URL },
    );
    expect(clearRes.code).toBe(0);
    const cleared = JSON.parse(clearRes.stdout.trim());
    expect(cleared.expires).toBeUndefined();

    // Clean up
    await runCli(["delete", String(created.id)], {
      DATABASE_URL: TEST_DB_URL,
    });
  });

  it("supports subject and group CLI workflows", async () => {
    const createRes = await runCli(
      [
        "create",
        "--name",
        "cli-subject-flag",
        "--roles",
        "admin",
        "--note",
        "subject flow",
      ],
      { DATABASE_URL: TEST_DB_URL },
    );
    expect(createRes.code).toBe(0);
    const flag = JSON.parse(createRes.stdout.trim());

    const addSubjectRes = await runCli(
      ["add-subject", String(flag.id), "tenant:acme"],
      { DATABASE_URL: TEST_DB_URL },
    );
    expect(addSubjectRes.code).toBe(0);
    expect(JSON.parse(addSubjectRes.stdout.trim()).added).toBe(true);

    const listSubjectsRes = await runCli(["list-subjects", String(flag.id)], {
      DATABASE_URL: TEST_DB_URL,
    });
    expect(listSubjectsRes.code).toBe(0);
    expect(JSON.parse(listSubjectsRes.stdout.trim()).subjects).toContain(
      "tenant:acme",
    );

    const isActiveContextRes = await runCli(
      [
        "is-active-context",
        "cli-subject-flag",
        "--subjects",
        "tenant:acme",
      ],
      { DATABASE_URL: TEST_DB_URL },
    );
    expect(isActiveContextRes.code).toBe(0);
    expect(JSON.parse(isActiveContextRes.stdout.trim()).isActive).toBe(true);

    const areActiveUserRes = await runCli(
      [
        "are-active",
        "--names",
        "cli-subject-flag",
        "--roles",
        "admin",
      ],
      { DATABASE_URL: TEST_DB_URL },
    );
    expect(areActiveUserRes.code).toBe(0);
    const areActiveUserPayload = JSON.parse(areActiveUserRes.stdout.trim());
    expect(areActiveUserPayload.results["cli-subject-flag"]).toBe(true);

    const areActiveContextRes = await runCli(
      [
        "are-active-context",
        "--names",
        "cli-subject-flag",
        "--subjects",
        "tenant:acme",
      ],
      { DATABASE_URL: TEST_DB_URL },
    );
    expect(areActiveContextRes.code).toBe(0);
    const areActiveContextPayload = JSON.parse(areActiveContextRes.stdout.trim());
    expect(areActiveContextPayload.results["cli-subject-flag"]).toBe(true);

    const listBySubjectRes = await runCli(["list-by-subject", "tenant:acme"], {
      DATABASE_URL: TEST_DB_URL,
    });
    expect(listBySubjectRes.code).toBe(0);
    const listBySubjectPayload = JSON.parse(listBySubjectRes.stdout.trim());
    expect(listBySubjectPayload.flags.map((f: any) => f.id)).toContain(flag.id);

    const groupCreateRes = await runCli(
      ["group-create", "--name", "cli-subject-group", "--note", "group flow"],
      { DATABASE_URL: TEST_DB_URL },
    );
    expect(groupCreateRes.code).toBe(0);
    const group = JSON.parse(groupCreateRes.stdout.trim());

    const groupAddFlagRes = await runCli(
      ["group-add-flag", String(group.id), String(flag.id)],
      { DATABASE_URL: TEST_DB_URL },
    );
    expect(groupAddFlagRes.code).toBe(0);
    expect(JSON.parse(groupAddFlagRes.stdout.trim()).added).toBe(true);

    const groupAddSubjectRes = await runCli(
      ["group-add-subject", String(group.id), "tenant:beta"],
      { DATABASE_URL: TEST_DB_URL },
    );
    expect(groupAddSubjectRes.code).toBe(0);
    expect(JSON.parse(groupAddSubjectRes.stdout.trim()).added).toBe(true);

    const groupListSubjectsRes = await runCli(
      ["group-list-subjects", String(group.id)],
      { DATABASE_URL: TEST_DB_URL },
    );
    expect(groupListSubjectsRes.code).toBe(0);
    expect(JSON.parse(groupListSubjectsRes.stdout.trim()).subjects).toContain(
      "tenant:beta",
    );

    const groupListBySubjectRes = await runCli(
      ["group-list-by-subject", "tenant:beta"],
      { DATABASE_URL: TEST_DB_URL },
    );
    expect(groupListBySubjectRes.code).toBe(0);
    const groupListBySubjectPayload = JSON.parse(groupListBySubjectRes.stdout.trim());
    expect(groupListBySubjectPayload.groups.map((g: any) => g.id)).toContain(
      group.id,
    );

    const groupListFlagsRes = await runCli(["group-list-flags", String(group.id)], {
      DATABASE_URL: TEST_DB_URL,
    });
    expect(groupListFlagsRes.code).toBe(0);
    expect(JSON.parse(groupListFlagsRes.stdout.trim()).flags.map((f: any) => f.id)).toContain(
      flag.id,
    );

    const groupListForFlagRes = await runCli(
      ["group-list-for-flag", String(flag.id)],
      { DATABASE_URL: TEST_DB_URL },
    );
    expect(groupListForFlagRes.code).toBe(0);
    expect(
      JSON.parse(groupListForFlagRes.stdout.trim()).groups.map((g: any) => g.id),
    ).toContain(group.id);

    const groupUpdateAllRes = await runCli(
      ["group-update-all", String(group.id), "--everyone", "false"],
      { DATABASE_URL: TEST_DB_URL },
    );
    expect(groupUpdateAllRes.code).toBe(0);
    expect(JSON.parse(groupUpdateAllRes.stdout.trim()).updatedCount).toBeGreaterThan(
      0,
    );

    const contextAfterUpdateRes = await runCli(
      [
        "is-active-context",
        "cli-subject-flag",
        "--subjects",
        "tenant:acme",
      ],
      { DATABASE_URL: TEST_DB_URL },
    );
    expect(contextAfterUpdateRes.code).toBe(0);
    expect(JSON.parse(contextAfterUpdateRes.stdout.trim()).isActive).toBe(false);

    const removeSubjectRes = await runCli(
      ["remove-subject", String(flag.id), "tenant:acme"],
      { DATABASE_URL: TEST_DB_URL },
    );
    expect(removeSubjectRes.code).toBe(0);
    expect(JSON.parse(removeSubjectRes.stdout.trim()).removed).toBe(true);

    const groupRemoveSubjectRes = await runCli(
      ["group-remove-subject", String(group.id), "tenant:beta"],
      { DATABASE_URL: TEST_DB_URL },
    );
    expect(groupRemoveSubjectRes.code).toBe(0);
    expect(JSON.parse(groupRemoveSubjectRes.stdout.trim()).removed).toBe(true);

    const groupRemoveFlagRes = await runCli(
      ["group-remove-flag", String(group.id), String(flag.id)],
      { DATABASE_URL: TEST_DB_URL },
    );
    expect(groupRemoveFlagRes.code).toBe(0);
    expect(JSON.parse(groupRemoveFlagRes.stdout.trim()).removed).toBe(true);

    const groupDeleteRes = await runCli(["group-delete", String(group.id)], {
      DATABASE_URL: TEST_DB_URL,
    });
    expect(groupDeleteRes.code).toBe(0);
  });
});
