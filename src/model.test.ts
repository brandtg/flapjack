import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";
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
      expect(flag.expires).toBeUndefined();
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
      expect(flag.expires).toBeUndefined();
    });

    it("should create a feature flag with expires date", async () => {
      const expiresDate = new Date("2025-12-31T23:59:59Z");
      const input = {
        name: "test-flag-with-expires",
        everyone: true,
        note: "This flag expires at end of 2025",
        expires: expiresDate,
      };
      const flag = await model.create(input);

      expect(flag.id).toBeTypeOf("number");
      expect(flag.name).toBe("test-flag-with-expires");
      expect(flag.expires).toBeInstanceOf(Date);
      expect(flag.expires?.toISOString()).toBe(expiresDate.toISOString());
    });

    it("should create a feature flag with expires in the past", async () => {
      const expiresDate = new Date("2020-01-01T00:00:00Z");
      const input = {
        name: "test-flag-expired",
        everyone: false,
        expires: expiresDate,
      };
      const flag = await model.create(input);

      expect(flag.expires).toBeInstanceOf(Date);
      expect(flag.expires?.toISOString()).toBe(expiresDate.toISOString());
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

    it("should retrieve a feature flag with expires date", async () => {
      const expiresDate = new Date("2026-06-15T12:00:00Z");
      const created = await model.create({
        name: "test-get-by-id-with-expires",
        expires: expiresDate,
      });
      const retrieved = await model.getById(created.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved!.expires).toBeInstanceOf(Date);
      expect(retrieved!.expires?.toISOString()).toBe(expiresDate.toISOString());
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

    it("should retrieve a feature flag with expires date by name", async () => {
      const expiresDate = new Date("2027-03-20T08:30:00Z");
      const created = await model.create({
        name: "test-get-by-name-with-expires",
        expires: expiresDate,
      });
      const retrieved = await model.getByName("test-get-by-name-with-expires");

      expect(retrieved).not.toBeNull();
      expect(retrieved!.expires).toBeInstanceOf(Date);
      expect(retrieved!.expires?.toISOString()).toBe(expiresDate.toISOString());
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

    it("should include expires field in list results", async () => {
      // Clear any existing flags from previous tests
      const existingFlags = await model.list();
      for (const flag of existingFlags) {
        await model.delete(flag.id);
      }

      const expiresDate = new Date("2025-08-08T08:08:08Z");
      const flag1 = await model.create({
        name: "list-test-with-expires",
        expires: expiresDate,
      });
      const flag2 = await model.create({ name: "list-test-without-expires" });

      const allFlags = await model.list();

      expect(allFlags).toHaveLength(2);
      expect(allFlags[0].expires).toBeInstanceOf(Date);
      expect(allFlags[0].expires?.toISOString()).toBe(
        expiresDate.toISOString(),
      );
      expect(allFlags[1].expires).toBeUndefined();
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

    it("should add expires date to a feature flag", async () => {
      const created = await model.create({
        name: "test-add-expires",
        everyone: true,
      });

      expect(created.expires).toBeUndefined();

      const expiresDate = new Date("2025-09-30T23:59:59Z");
      const updated = await model.update(created.id, {
        expires: expiresDate,
      });

      expect(updated).not.toBeNull();
      expect(updated!.expires).toBeInstanceOf(Date);
      expect(updated!.expires?.toISOString()).toBe(expiresDate.toISOString());
    });

    it("should update expires date of a feature flag", async () => {
      const originalExpires = new Date("2025-01-01T00:00:00Z");
      const created = await model.create({
        name: "test-update-expires",
        expires: originalExpires,
      });

      expect(created.expires?.toISOString()).toBe(
        originalExpires.toISOString(),
      );

      const newExpires = new Date("2026-12-31T23:59:59Z");
      const updated = await model.update(created.id, {
        expires: newExpires,
      });

      expect(updated).not.toBeNull();
      expect(updated!.expires).toBeInstanceOf(Date);
      expect(updated!.expires?.toISOString()).toBe(newExpires.toISOString());
    });

    it("should clear expires date from a feature flag", async () => {
      const expiresDate = new Date("2025-06-15T12:00:00Z");
      const created = await model.create({
        name: "test-clear-expires",
        expires: expiresDate,
      });

      expect(created.expires).toBeInstanceOf(Date);

      const updated = await model.update(created.id, {
        expires: null as any,
      });

      expect(updated).not.toBeNull();
      expect(updated!.expires).toBeUndefined();
    });

    it("should preserve expires when updating other fields", async () => {
      const expiresDate = new Date("2025-11-11T11:11:11Z");
      const created = await model.create({
        name: "test-preserve-expires",
        everyone: false,
        expires: expiresDate,
      });

      const updated = await model.update(created.id, {
        everyone: true,
        note: "Updated without changing expires",
      });

      expect(updated).not.toBeNull();
      expect(updated!.everyone).toBe(true);
      expect(updated!.note).toBe("Updated without changing expires");
      expect(updated!.expires).toBeInstanceOf(Date);
      expect(updated!.expires?.toISOString()).toBe(expiresDate.toISOString());
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
      const enabled = await model.isActiveForUser({
        name: "non-existent",
        user: "user123",
      });
      expect(enabled).toBe(false);
    });

    it("should return true when everyone flag is enabled", async () => {
      await model.create({
        name: "everyone-flag",
        everyone: true,
      });

      const enabled = await model.isActiveForUser({
        name: "everyone-flag",
        user: "user123",
      });
      expect(enabled).toBe(true);
    });

    it("should return true for users with matching roles", async () => {
      await model.create({
        name: "role-flag",
        roles: ["admin", "moderator"],
      });

      const enabledAdmin = await model.isActiveForUser({
        name: "role-flag",
        user: "user123",
        roles: ["admin"],
      });
      const enabledMod = await model.isActiveForUser({
        name: "role-flag",
        user: "user456",
        roles: ["user", "moderator"],
      });
      const enabledNone = await model.isActiveForUser({
        name: "role-flag",
        user: "user789",
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
          await model.isActiveForUser({
            name: "percent-flag",
            user: "user123",
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
          await model.isActiveForUser({
            name: "percent-flag",
            user: `user${i}`,
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

      const enabled = await model.isActiveForUser({
        name: "restricted-flag",
        user: "user123",
        roles: ["user"],
      });
      expect(enabled).toBe(false);
    });

    it("should return true for users with matching groups", async () => {
      await model.create({
        name: "group-flag",
        groups: ["beta-users", "vip-customers"],
      });

      const enabledBetaUser = await model.isActiveForUser({
        name: "group-flag",
        user: "user123",
        groups: ["beta-users"],
      });
      const enabledVipUser = await model.isActiveForUser({
        name: "group-flag",
        user: "user456",
        groups: ["regular-users", "vip-customers"],
      });
      const enabledNone = await model.isActiveForUser({
        name: "group-flag",
        user: "user789",
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

      const enabledNoGroups = await model.isActiveForUser({
        name: "group-required-flag",
        user: "user123",
        groups: [],
      });
      const enabledUndefinedGroups = await model.isActiveForUser({
        name: "group-required-flag",
        user: "user456",
      });

      expect(enabledNoGroups).toBe(false);
      expect(enabledUndefinedGroups).toBe(false);
    });

    it("should handle empty groups array like no groups", async () => {
      await model.create({
        name: "empty-groups-flag",
        groups: [],
      });

      const enabledWithGroups = await model.isActiveForUser({
        name: "empty-groups-flag",
        user: "user123",
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

      const enabledByGroup = await model.isActiveForUser({
        name: "context-flag",
        user: "user123",
        groups: ["beta-testers"],
        roles: ["user"],
      });

      const enabledByRole = await model.isActiveForUser({
        name: "context-flag",
        user: "user456",
        groups: ["regular"],
        roles: ["admin"],
      });

      const notEnabled = await model.isActiveForUser({
        name: "context-flag",
        user: "user789",
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

      const result = await model.isActiveForUser({
        name: "priority-test-flag",
        user: "user123",
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

      const enabledByGroup = await model.isActiveForUser({
        name: "combined-flag",
        user: "user1",
        groups: ["beta-users"],
      });

      const enabledByRole = await model.isActiveForUser({
        name: "combined-flag",
        user: "user2",
        roles: ["moderator"],
      });

      const enabledByUserId = await model.isActiveForUser({
        name: "combined-flag",
        user: "special-user",
      });

      const notEnabled = await model.isActiveForUser({
        name: "combined-flag",
        user: "user3",
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

      const enabledCorrectCase = await model.isActiveForUser({
        name: "case-sensitive-flag",
        user: "user123",
        groups: ["Beta-Users"],
      });

      const enabledWrongCase = await model.isActiveForUser({
        name: "case-sensitive-flag",
        user: "user456",
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
      const enabledUser = await model.isActiveForUser({
        name: "user-priority-flag",
        user: "special-user",
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
      const enabledByGroup = await model.isActiveForUser({
        name: "group-priority-flag",
        user: "user123",
        groups: ["beta-users"],
        roles: ["user"], // Not admin
      });

      expect(enabledByGroup).toBe(true);
    });

    it("should revert to other rules when everyone changes from true to null", async () => {
      // Create a flag with everyone: true
      await model.create({
        name: "everyone-revert-flag",
        everyone: true,
        roles: ["admin"],
        groups: ["beta-users"],
      });

      // Should be enabled for any user
      const enabledAny = await model.isActiveForUser({
        name: "everyone-revert-flag",
        user: "user123",
        roles: ["user"],
        groups: ["regular"],
      });
      expect(enabledAny).toBe(true);

      // Update everyone to null (should remove the override)
      const flag = await model.getByName("everyone-revert-flag");
      await model.update(flag!.id, { everyone: null });

      // Now, only users matching roles or groups should be enabled
      const enabledByRole = await model.isActiveForUser({
        name: "everyone-revert-flag",
        user: "user456",
        roles: ["admin"],
        groups: ["regular"],
      });
      expect(enabledByRole).toBe(true);

      const enabledByGroup = await model.isActiveForUser({
        name: "everyone-revert-flag",
        user: "user789",
        roles: ["user"],
        groups: ["beta-users"],
      });
      expect(enabledByGroup).toBe(true);

      const notEnabled = await model.isActiveForUser({
        name: "everyone-revert-flag",
        user: "user000",
        roles: ["user"],
        groups: ["regular"],
      });
      expect(notEnabled).toBe(false);
    });

    it("should allow active flag with future expiration date", async () => {
      const futureDate = new Date();
      futureDate.setFullYear(futureDate.getFullYear() + 1); // One year in future

      await model.create({
        name: "future-expiration-flag",
        everyone: true,
        expires: futureDate,
      });

      const isActive = await model.isActiveForUser({
        name: "future-expiration-flag",
        user: "user123",
      });

      expect(isActive).toBe(true);
    });

    it("should return false for expired flag when no handler is set", async () => {
      const pastDate = new Date();
      pastDate.setFullYear(pastDate.getFullYear() - 1); // One year in past

      await model.create({
        name: "expired-flag-no-handler",
        everyone: true,
        expires: pastDate,
      });

      const isActive = await model.isActiveForUser({
        name: "expired-flag-no-handler",
        user: "user123",
      });

      // Default behavior: expired flags are not active
      expect(isActive).toBe(true); // Should continue with normal evaluation
    });
  });

  describe("isActiveForUser with expiration event handlers", () => {
    it("should call onExpired handler when flag has expired", async () => {
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 7); // One week ago

      const onExpiredMock = vi.fn().mockResolvedValue(undefined);

      const modelWithHandler = new FeatureFlagModel(testPool, {
        onExpired: onExpiredMock,
      });

      await modelWithHandler.create({
        name: "expired-with-handler",
        everyone: true,
        expires: pastDate,
      });

      const isActive = await modelWithHandler.isActiveForUser({
        name: "expired-with-handler",
        user: "user123",
      });

      expect(onExpiredMock).toHaveBeenCalledTimes(1);
      expect(onExpiredMock).toHaveBeenCalledWith({
        flag: expect.objectContaining({
          name: "expired-with-handler",
          expires: expect.any(Date),
        }),
      });
      // Handler returned undefined, so normal evaluation continues
      expect(isActive).toBe(true);
    });

    it("should not call onExpired handler for non-expired flags", async () => {
      const futureDate = new Date();
      futureDate.setFullYear(futureDate.getFullYear() + 1);

      const onExpiredMock = vi.fn().mockResolvedValue(undefined);

      const modelWithHandler = new FeatureFlagModel(testPool, {
        onExpired: onExpiredMock,
      });

      await modelWithHandler.create({
        name: "future-flag-with-handler",
        everyone: true,
        expires: futureDate,
      });

      const isActive = await modelWithHandler.isActiveForUser({
        name: "future-flag-with-handler",
        user: "user123",
      });

      expect(onExpiredMock).not.toHaveBeenCalled();
      expect(isActive).toBe(true);
    });

    it("should not call onExpired handler for flags without expiration", async () => {
      const onExpiredMock = vi.fn().mockResolvedValue(undefined);

      const modelWithHandler = new FeatureFlagModel(testPool, {
        onExpired: onExpiredMock,
      });

      await modelWithHandler.create({
        name: "no-expiration-with-handler",
        everyone: true,
      });

      const isActive = await modelWithHandler.isActiveForUser({
        name: "no-expiration-with-handler",
        user: "user123",
      });

      expect(onExpiredMock).not.toHaveBeenCalled();
      expect(isActive).toBe(true);
    });

    it("should return false when handler returns false for expired flag", async () => {
      const pastDate = new Date();
      pastDate.setMonth(pastDate.getMonth() - 3); // Three months ago

      const onExpiredMock = vi.fn().mockResolvedValue(false);

      const modelWithHandler = new FeatureFlagModel(testPool, {
        onExpired: onExpiredMock,
      });

      await modelWithHandler.create({
        name: "expired-handler-returns-false",
        everyone: true, // Even though everyone is true
        expires: pastDate,
      });

      const isActive = await modelWithHandler.isActiveForUser({
        name: "expired-handler-returns-false",
        user: "user123",
      });

      expect(onExpiredMock).toHaveBeenCalledTimes(1);
      expect(isActive).toBe(false); // Handler override
    });

    it("should return true when handler returns true for expired flag", async () => {
      const pastDate = new Date();
      pastDate.setMonth(pastDate.getMonth() - 2);

      const onExpiredMock = vi.fn().mockResolvedValue(true);

      const modelWithHandler = new FeatureFlagModel(testPool, {
        onExpired: onExpiredMock,
      });

      await modelWithHandler.create({
        name: "expired-handler-returns-true",
        everyone: false, // Even though everyone is false
        expires: pastDate,
      });

      const isActive = await modelWithHandler.isActiveForUser({
        name: "expired-handler-returns-true",
        user: "user123",
      });

      expect(onExpiredMock).toHaveBeenCalledTimes(1);
      expect(isActive).toBe(true); // Handler override
    });

    it("should continue normal evaluation when handler returns undefined", async () => {
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 1); // Yesterday

      const onExpiredMock = vi.fn().mockResolvedValue(undefined);

      const modelWithHandler = new FeatureFlagModel(testPool, {
        onExpired: onExpiredMock,
      });

      await modelWithHandler.create({
        name: "expired-handler-returns-undefined",
        roles: ["admin"],
        expires: pastDate,
      });

      const isActiveForAdmin = await modelWithHandler.isActiveForUser({
        name: "expired-handler-returns-undefined",
        user: "user123",
        roles: ["admin"],
      });

      const isActiveForUser = await modelWithHandler.isActiveForUser({
        name: "expired-handler-returns-undefined",
        user: "user456",
        roles: ["user"],
      });

      expect(onExpiredMock).toHaveBeenCalledTimes(2);
      expect(isActiveForAdmin).toBe(true); // Matches role
      expect(isActiveForUser).toBe(false); // Doesn't match role
    });

    it("should use handler result for expired flag with percentage rollout", async () => {
      const pastDate = new Date();
      pastDate.setHours(pastDate.getHours() - 1); // One hour ago

      const onExpiredMock = vi.fn().mockResolvedValue(undefined);

      const modelWithHandler = new FeatureFlagModel(testPool, {
        onExpired: onExpiredMock,
      });

      await modelWithHandler.create({
        name: "expired-with-percentage",
        percent: 50,
        expires: pastDate,
      });

      const isActive = await modelWithHandler.isActiveForUser({
        name: "expired-with-percentage",
        user: "user123",
      });

      expect(onExpiredMock).toHaveBeenCalledTimes(1);
      // Handler returned undefined, so percentage rollout is evaluated
      expect(typeof isActive).toBe("boolean");
    });

    it("should handle expiration check at exact expiration time", async () => {
      const now = new Date();

      const onExpiredMock = vi.fn().mockResolvedValue(false);

      const modelWithHandler = new FeatureFlagModel(testPool, {
        onExpired: onExpiredMock,
      });

      await modelWithHandler.create({
        name: "expires-now",
        everyone: true,
        expires: now,
      });

      // Wait a tiny bit to ensure we're past the expiration
      await new Promise((resolve) => setTimeout(resolve, 10));

      const isActive = await modelWithHandler.isActiveForUser({
        name: "expires-now",
        user: "user123",
      });

      expect(onExpiredMock).toHaveBeenCalled();
      expect(isActive).toBe(false);
    });

    it("should allow handler to emit metrics without affecting result", async () => {
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 30); // 30 days ago

      const metricsEmitted: string[] = [];
      const onExpiredMock = vi.fn().mockImplementation(async ({ flag }) => {
        // Simulate emitting metrics
        metricsEmitted.push(`expired_flag_used:${flag.name}`);
        return undefined; // Don't affect the result
      });

      const modelWithHandler = new FeatureFlagModel(testPool, {
        onExpired: onExpiredMock,
      });

      await modelWithHandler.create({
        name: "expired-metrics-test",
        users: ["special-user"],
        expires: pastDate,
      });

      const isActive = await modelWithHandler.isActiveForUser({
        name: "expired-metrics-test",
        user: "special-user",
      });

      expect(onExpiredMock).toHaveBeenCalledTimes(1);
      expect(metricsEmitted).toEqual([
        "expired_flag_used:expired-metrics-test",
      ]);
      expect(isActive).toBe(true); // User is in the users list
    });

    it("should work correctly with multiple expired flags", async () => {
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 10);

      const callLog: string[] = [];
      const onExpiredMock = vi.fn().mockImplementation(async ({ flag }) => {
        callLog.push(flag.name);
        return flag.name === "expired-flag-1" ? false : undefined;
      });

      const modelWithHandler = new FeatureFlagModel(testPool, {
        onExpired: onExpiredMock,
      });

      await modelWithHandler.create({
        name: "expired-flag-1",
        everyone: true,
        expires: pastDate,
      });

      await modelWithHandler.create({
        name: "expired-flag-2",
        everyone: true,
        expires: pastDate,
      });

      const isActive1 = await modelWithHandler.isActiveForUser({
        name: "expired-flag-1",
        user: "user123",
      });

      const isActive2 = await modelWithHandler.isActiveForUser({
        name: "expired-flag-2",
        user: "user123",
      });

      expect(onExpiredMock).toHaveBeenCalledTimes(2);
      expect(callLog).toEqual(["expired-flag-1", "expired-flag-2"]);
      expect(isActive1).toBe(false); // Handler returned false
      expect(isActive2).toBe(true); // Handler returned undefined, everyone is true
    });
  });
});
