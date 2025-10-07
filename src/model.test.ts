import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { FeatureFlagModel } from "./model.js";
import { runMigrations } from "./migrate.js";

const DB_CONFIG = {
  user: "flapjack",
  password: "flapjack",
  host: "localhost",
  port: 5432,
};

const TEST_DB_NAME = "flapjack_test";

let testPool: Pool;
let model: FeatureFlagModel;

describe("FeatureFlagModel", () => {
  beforeAll(async () => {
    // Create a connection to the default postgres database to set up our test database
    const setupPool = new Pool({
      ...DB_CONFIG,
      database: "postgres",
    });

    try {
      // Drop test database if it exists and create a fresh one
      await setupPool.query(`DROP DATABASE IF EXISTS ${TEST_DB_NAME}`);
      await setupPool.query(`CREATE DATABASE ${TEST_DB_NAME}`);
    } finally {
      await setupPool.end();
    }

    // Connect to the test database
    testPool = new Pool({
      ...DB_CONFIG,
      database: TEST_DB_NAME,
    });

    // Run the migrations to create the schema
    await runMigrations({
      databaseUrl: `postgres://${DB_CONFIG.user}:${DB_CONFIG.password}@${DB_CONFIG.host}:${DB_CONFIG.port}/${TEST_DB_NAME}`,
      migrationsTable: "pgmigrations",
    });

    model = new FeatureFlagModel(testPool);
  });

  afterAll(async () => {
    // Clean up: drop the test database
    await testPool.end();

    const cleanupPool = new Pool({
      ...DB_CONFIG,
      database: "postgres",
    });

    try {
      await cleanupPool.query(`DROP DATABASE IF EXISTS ${TEST_DB_NAME}`);
    } finally {
      await cleanupPool.end();
    }
  });

  describe("create", () => {
    it("should create a feature flag with minimal data", async () => {
      const input = { name: "test-flag-minimal" };
      const flag = await model.create(input);

      expect(flag.id).toBeTypeOf("number");
      expect(flag.name).toBe("test-flag-minimal");
      expect(flag.everyone).toBeUndefined();
      expect(flag.percent).toBeUndefined();
      expect(flag.roles).toBeUndefined();
      expect(flag.note).toBeUndefined();
      expect(flag.created).toBeInstanceOf(Date);
      expect(flag.modified).toBeInstanceOf(Date);
    });

    it("should create a feature flag with all properties", async () => {
      const input = {
        name: "test-flag-complete",
        everyone: true,
        percent: 25.5,
        roles: ["admin", "moderator"],
        groups: ["beta-users", "vip-customers"],
        users: ["user123", "user456"],
        note: "Test feature flag with all properties",
      };
      const flag = await model.create(input);

      expect(flag.id).toBeTypeOf("number");
      expect(flag.name).toBe("test-flag-complete");
      expect(flag.everyone).toBe(true);
      expect(flag.percent).toBe(25.5);
      expect(flag.roles).toEqual(["admin", "moderator"]);
      expect(flag.groups).toEqual(["beta-users", "vip-customers"]);
      expect(flag.users).toEqual(["user123", "user456"]);
      expect(flag.note).toBe("Test feature flag with all properties");
      expect(flag.created).toBeInstanceOf(Date);
      expect(flag.modified).toBeInstanceOf(Date);
    });
  });

  describe("getById", () => {
    it("should retrieve a feature flag by id", async () => {
      const created = await model.create({ name: "test-get-by-id" });
      const retrieved = await model.getById(created.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(created.id);
      expect(retrieved!.name).toBe("test-get-by-id");
    });

    it("should return null for non-existent id", async () => {
      const retrieved = await model.getById(99999);
      expect(retrieved).toBeNull();
    });
  });

  describe("getByName", () => {
    it("should retrieve a feature flag by name", async () => {
      const created = await model.create({ name: "test-get-by-name" });
      const retrieved = await model.getByName("test-get-by-name");

      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(created.id);
      expect(retrieved!.name).toBe("test-get-by-name");
    });

    it("should return null for non-existent name", async () => {
      const retrieved = await model.getByName("non-existent-flag");
      expect(retrieved).toBeNull();
    });
  });

  describe("list", () => {
    it("should return all feature flags ordered by id", async () => {
      // Clear any existing flags from previous tests
      const existingFlags = await model.list();
      for (const flag of existingFlags) {
        await model.delete(flag.id);
      }

      const flag1 = await model.create({ name: "list-test-1" });
      const flag2 = await model.create({ name: "list-test-2" });

      const allFlags = await model.list();

      expect(allFlags).toHaveLength(2);
      expect(allFlags[0].id).toBe(flag1.id);
      expect(allFlags[1].id).toBe(flag2.id);
      expect(allFlags[0].name).toBe("list-test-1");
      expect(allFlags[1].name).toBe("list-test-2");
    });
  });

  describe("update", () => {
    it("should update a feature flag", async () => {
      const created = await model.create({
        name: "test-update",
        everyone: false,
        percent: 10,
      });

      // Wait a small amount to ensure modified timestamp changes
      await new Promise((resolve) => setTimeout(resolve, 10));

      const updated = await model.update(created.id, {
        everyone: true,
        percent: 50,
        note: "Updated note",
      });

      expect(updated).not.toBeNull();
      expect(updated!.id).toBe(created.id);
      expect(updated!.name).toBe("test-update");
      expect(updated!.everyone).toBe(true);
      expect(updated!.percent).toBe(50);
      expect(updated!.note).toBe("Updated note");
      expect(updated!.modified.getTime()).toBeGreaterThan(
        created.modified.getTime(),
      );
    });

    it("should return the unchanged flag if no changes provided", async () => {
      const created = await model.create({ name: "test-no-update" });
      const result = await model.update(created.id, {});

      expect(result).not.toBeNull();
      expect(result!.id).toBe(created.id);
      expect(result!.name).toBe("test-no-update");
    });

    it("should return null for non-existent id", async () => {
      const result = await model.update(99999, { name: "new-name" });
      expect(result).toBeNull();
    });
  });

  describe("delete", () => {
    it("should delete a feature flag", async () => {
      const created = await model.create({ name: "test-delete" });
      const deleted = await model.delete(created.id);

      expect(deleted).toBe(true);

      const retrieved = await model.getById(created.id);
      expect(retrieved).toBeNull();
    });

    it("should return false for non-existent id", async () => {
      const deleted = await model.delete(99999);
      expect(deleted).toBe(false);
    });
  });

  describe("hashUserId", () => {
    it("should return consistent hash for same user id", async () => {
      const hash1 = await model.hashUserId("user123");
      const hash2 = await model.hashUserId("user123");

      expect(hash1).toBe(hash2);
      expect(typeof hash1).toBe("number");
    });

    it("should return different hashes for different user ids", async () => {
      const hash1 = await model.hashUserId("user123");
      const hash2 = await model.hashUserId("user456");

      expect(hash1).not.toBe(hash2);
    });
  });

  describe("isEnabledForUser", () => {
    it("should return false for non-existent flag", async () => {
      const enabled = await model.isEnabledForUser({
        flagName: "non-existent",
        userId: "user123",
      });
      expect(enabled).toBe(false);
    });

    it("should return true when everyone flag is enabled", async () => {
      await model.create({
        name: "everyone-flag",
        everyone: true,
      });

      const enabled = await model.isEnabledForUser({
        flagName: "everyone-flag",
        userId: "user123",
      });
      expect(enabled).toBe(true);
    });

    it("should return true for users with matching roles", async () => {
      await model.create({
        name: "role-flag",
        roles: ["admin", "moderator"],
      });

      const enabledAdmin = await model.isEnabledForUser({
        flagName: "role-flag",
        userId: "user123",
        roles: ["admin"],
      });
      const enabledMod = await model.isEnabledForUser({
        flagName: "role-flag",
        userId: "user456",
        roles: ["user", "moderator"],
      });
      const enabledNone = await model.isEnabledForUser({
        flagName: "role-flag",
        userId: "user789",
        roles: ["user"],
      });

      expect(enabledAdmin).toBe(true);
      expect(enabledMod).toBe(true);
      expect(enabledNone).toBe(false);
    });

    it("should respect percentage rollout consistently", async () => {
      await model.create({
        name: "percent-flag",
        percent: 50,
      });

      // Test the same user multiple times - should be consistent
      const results: boolean[] = [];
      for (let i = 0; i < 5; i++) {
        results.push(
          await model.isEnabledForUser({
            flagName: "percent-flag",
            userId: "user123",
          }),
        );
      }

      // All results should be the same (deterministic)
      const firstResult = results[0];
      expect(results.every((r) => r === firstResult)).toBe(true);

      // Test multiple different users to ensure some variance
      const userResults: boolean[] = [];
      for (let i = 0; i < 20; i++) {
        userResults.push(
          await model.isEnabledForUser({
            flagName: "percent-flag",
            userId: `user${i}`,
          }),
        );
      }

      // With 50% rollout and 20 users, we should have some enabled and some disabled
      const enabledCount = userResults.filter((r) => r).length;
      expect(enabledCount).toBeGreaterThan(0);
      expect(enabledCount).toBeLessThan(20);
    });

    it("should return false when no conditions are met", async () => {
      await model.create({
        name: "restricted-flag",
        everyone: false,
        roles: ["admin"],
        percent: 0,
      });

      const enabled = await model.isEnabledForUser({
        flagName: "restricted-flag",
        userId: "user123",
        roles: ["user"],
      });
      expect(enabled).toBe(false);
    });

    it("should return true for users with matching groups", async () => {
      await model.create({
        name: "group-flag",
        groups: ["beta-users", "vip-customers"],
      });

      const enabledBetaUser = await model.isEnabledForUser({
        flagName: "group-flag",
        userId: "user123",
        groups: ["beta-users"],
      });
      const enabledVipUser = await model.isEnabledForUser({
        flagName: "group-flag",
        userId: "user456",
        groups: ["regular-users", "vip-customers"],
      });
      const enabledNone = await model.isEnabledForUser({
        flagName: "group-flag",
        userId: "user789",
        groups: ["regular-users"],
      });

      expect(enabledBetaUser).toBe(true);
      expect(enabledVipUser).toBe(true);
      expect(enabledNone).toBe(false);
    });

    it("should handle users with no groups vs flags with groups", async () => {
      await model.create({
        name: "group-required-flag",
        groups: ["admin-group"],
      });

      const enabledNoGroups = await model.isEnabledForUser({
        flagName: "group-required-flag",
        userId: "user123",
        groups: [],
      });
      const enabledUndefinedGroups = await model.isEnabledForUser({
        flagName: "group-required-flag",
        userId: "user456",
      });

      expect(enabledNoGroups).toBe(false);
      expect(enabledUndefinedGroups).toBe(false);
    });

    it("should handle empty groups array like no groups", async () => {
      await model.create({
        name: "empty-groups-flag",
        groups: [],
      });

      const enabledWithGroups = await model.isEnabledForUser({
        flagName: "empty-groups-flag",
        userId: "user123",
        groups: ["some-group"],
      });

      expect(enabledWithGroups).toBe(false);
    });

    it("should work with roles and groups", async () => {
      await model.create({
        name: "context-flag",
        groups: ["beta-testers"],
        roles: ["admin"],
      });

      const enabledByGroup = await model.isEnabledForUser({
        flagName: "context-flag",
        userId: "user123",
        groups: ["beta-testers"],
        roles: ["user"],
      });

      const enabledByRole = await model.isEnabledForUser({
        flagName: "context-flag",
        userId: "user456",
        groups: ["regular"],
        roles: ["admin"],
      });

      const notEnabled = await model.isEnabledForUser({
        flagName: "context-flag",
        userId: "user789",
        groups: ["regular"],
        roles: ["user"],
      });

      expect(enabledByGroup).toBe(true);
      expect(enabledByRole).toBe(true);
      expect(notEnabled).toBe(false);
    });

    it("should prioritize evaluation order correctly with groups", async () => {
      // Test that everyone override still takes precedence over groups
      await model.create({
        name: "priority-test-flag",
        everyone: false,
        groups: ["beta-users"],
        roles: ["admin"],
        percent: 99.9,
      });

      const result = await model.isEnabledForUser({
        flagName: "priority-test-flag",
        userId: "user123",
        groups: ["beta-users"],
        roles: ["admin"],
      });

      expect(result).toBe(false); // everyone: false should override everything
    });

    it("should support groups alongside other settings", async () => {
      await model.create({
        name: "combined-flag",
        groups: ["beta-users"],
        roles: ["moderator"],
        users: ["special-user"],
      });

      const enabledByGroup = await model.isEnabledForUser({
        flagName: "combined-flag",
        userId: "user1",
        groups: ["beta-users"],
      });

      const enabledByRole = await model.isEnabledForUser({
        flagName: "combined-flag",
        userId: "user2",
        roles: ["moderator"],
      });

      const enabledByUserId = await model.isEnabledForUser({
        flagName: "combined-flag",
        userId: "special-user",
      });

      const notEnabled = await model.isEnabledForUser({
        flagName: "combined-flag",
        userId: "user3",
        groups: ["regular"],
        roles: ["user"],
      });

      expect(enabledByGroup).toBe(true);
      expect(enabledByRole).toBe(true);
      expect(enabledByUserId).toBe(true);
      expect(notEnabled).toBe(false);
    });

    it("should handle case sensitivity in group names", async () => {
      await model.create({
        name: "case-sensitive-flag",
        groups: ["Beta-Users"],
      });

      const enabledCorrectCase = await model.isEnabledForUser({
        flagName: "case-sensitive-flag",
        userId: "user123",
        groups: ["Beta-Users"],
      });

      const enabledWrongCase = await model.isEnabledForUser({
        flagName: "case-sensitive-flag",
        userId: "user456",
        groups: ["beta-users"],
      });

      expect(enabledCorrectCase).toBe(true);
      expect(enabledWrongCase).toBe(false);
    });

    it("should prioritize users over groups in evaluation", async () => {
      await model.create({
        name: "user-priority-flag",
        groups: ["restricted-group"],
        users: ["special-user"],
      });

      // User should be enabled even if they're not in the group
      const enabledUser = await model.isEnabledForUser({
        flagName: "user-priority-flag",
        userId: "special-user",
        groups: ["different-group"],
      });

      expect(enabledUser).toBe(true);
    });

    it("should prioritize groups over roles in evaluation", async () => {
      await model.create({
        name: "group-priority-flag",
        groups: ["beta-users"],
        roles: ["admin"],
      });

      // User with group but no role should be enabled
      const enabledByGroup = await model.isEnabledForUser({
        flagName: "group-priority-flag",
        userId: "user123",
        groups: ["beta-users"],
        roles: ["user"], // Not admin
      });

      expect(enabledByGroup).toBe(true);
    });
  });
});
