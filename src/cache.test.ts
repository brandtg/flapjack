import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  InMemoryCache,
  FeatureFlagCache,
  Cache,
  CachedFlagResult,
} from "./cache.js";
import { FeatureFlagModel } from "./model.js";
import type { FeatureFlag } from "./types.js";

describe("InMemoryCache", () => {
  let cache: InMemoryCache<string>;

  beforeEach(() => {
    cache = new InMemoryCache<string>();
  });

  it("should store and retrieve values", async () => {
    await cache.set("key1", "value1");
    expect(await cache.get("key1")).toBe("value1");
  });

  it("should return undefined for non-existent keys", async () => {
    expect(await cache.get("nonexistent")).toBeUndefined();
  });

  it("should expire entries after TTL", async () => {
    await cache.set("key1", "value1", 0.1); // 100ms TTL
    expect(await cache.get("key1")).toBe("value1");

    // Wait for expiration
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(await cache.get("key1")).toBeUndefined();
  });

  it("should delete entries", async () => {
    await cache.set("key1", "value1");
    expect(await cache.get("key1")).toBe("value1");

    cache.delete("key1");
    expect(await cache.get("key1")).toBeUndefined();
  });

  it("should clear expired entries", async () => {
    await cache.set("key1", "value1", 0.1); // 100ms TTL
    await cache.set("key2", "value2", 1); // 1 second TTL

    expect(cache.size()).toBe(2);

    // Wait for first key to expire
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Size should still be 2 (expired entries not cleaned yet)
    expect(cache.size()).toBe(2);

    // Access expired key should clean it up
    expect(await cache.get("key1")).toBeUndefined();
    expect(cache.size()).toBe(1);

    // Manual cleanup should work too
    cache.clearExpired();
    expect(cache.size()).toBe(1);
    expect(await cache.get("key2")).toBe("value2");
  });

  it("should clear all entries", async () => {
    await cache.set("key1", "value1");
    await cache.set("key2", "value2");

    expect(cache.size()).toBe(2);

    cache.clear();
    expect(cache.size()).toBe(0);
    expect(await cache.get("key1")).toBeUndefined();
    expect(await cache.get("key2")).toBeUndefined();
  });
});

describe("FeatureFlagCache", () => {
  let mockModel: FeatureFlagModel;
  let cache: Cache<CachedFlagResult>;
  let flagCache: FeatureFlagCache;

  beforeEach(() => {
    // Create mock model
    mockModel = {
      isActiveForContext: vi.fn(),
      getByName: vi.fn().mockResolvedValue(null),
      fireExpiredHandler: vi.fn().mockResolvedValue(undefined),
    } as any;

    // Create cache
    cache = new InMemoryCache<CachedFlagResult>();

    // Create flag cache
    flagCache = new FeatureFlagCache({
      model: mockModel,
      cache,
      ttl: 1,
    });
  });

  it("should call model on cache miss", async () => {
    const mockResult = true;
    vi.mocked(mockModel.isActiveForContext).mockResolvedValue(mockResult);

    const result = await flagCache.isActiveForUser({
      name: "test_flag",
      user: "user123",
    });

    expect(result).toBe(mockResult);
    expect(mockModel.isActiveForContext).toHaveBeenCalledWith({
      name: "test_flag",
      user: "user123",
    });
    expect(mockModel.isActiveForContext).toHaveBeenCalledTimes(1);
  });

  it("should return cached result on cache hit", async () => {
    const mockResult = true;
    vi.mocked(mockModel.isActiveForContext).mockResolvedValue(mockResult);

    // First call should hit the model
    const result1 = await flagCache.isActiveForUser({
      name: "test_flag",
      user: "user123",
    });

    // Second call should hit the cache
    const result2 = await flagCache.isActiveForUser({
      name: "test_flag",
      user: "user123",
    });

    expect(result1).toBe(mockResult);
    expect(result2).toBe(mockResult);
    expect(mockModel.isActiveForContext).toHaveBeenCalledTimes(1);
  });

  it("should generate different cache keys for different parameters", async () => {
    vi.mocked(mockModel.isActiveForContext).mockResolvedValue(true);

    // Different user
    await flagCache.isActiveForUser({ name: "test_flag", user: "user1" });
    await flagCache.isActiveForUser({ name: "test_flag", user: "user2" });

    // Different flag name
    await flagCache.isActiveForUser({ name: "flag1", user: "user1" });
    await flagCache.isActiveForUser({ name: "flag2", user: "user1" });

    // Different roles
    await flagCache.isActiveForUser({
      name: "test_flag",
      user: "user1",
      roles: ["admin"],
    });
    await flagCache.isActiveForUser({
      name: "test_flag",
      user: "user1",
      roles: ["user"],
    });

    // Different groups
    await flagCache.isActiveForUser({
      name: "test_flag",
      user: "user1",
      groups: ["beta"],
    });
    await flagCache.isActiveForUser({
      name: "test_flag",
      user: "user1",
      groups: ["alpha"],
    });

    // Each call should be a cache miss
    expect(mockModel.isActiveForContext).toHaveBeenCalledTimes(8);
  });

  it("should generate same cache key for same parameters regardless of order", async () => {
    vi.mocked(mockModel.isActiveForContext).mockResolvedValue(true);

    // Same parameters but different order
    await flagCache.isActiveForUser({
      name: "test_flag",
      user: "user1",
      roles: ["admin", "user"],
      groups: ["beta", "alpha"],
    });

    await flagCache.isActiveForUser({
      name: "test_flag",
      user: "user1",
      roles: ["user", "admin"], // Different order
      groups: ["alpha", "beta"], // Different order
    });

    // Should only call model once (second call hits cache)
    expect(mockModel.isActiveForContext).toHaveBeenCalledTimes(1);
  });

  it("should handle undefined/null parameters consistently", async () => {
    vi.mocked(mockModel.isActiveForContext).mockResolvedValue(true);

    // Test various combinations of undefined parameters
    await flagCache.isActiveForUser({ name: "test_flag" });
    await flagCache.isActiveForUser({ name: "test_flag", user: undefined });
    await flagCache.isActiveForUser({ name: "test_flag", roles: undefined });
    await flagCache.isActiveForUser({ name: "test_flag", groups: undefined });

    // All should generate the same cache key
    expect(mockModel.isActiveForContext).toHaveBeenCalledTimes(1);
  });

  it("should cache false results as well as true results", async () => {
    vi.mocked(mockModel.isActiveForContext).mockResolvedValue(false);

    const result1 = await flagCache.isActiveForUser({
      name: "test_flag",
      user: "user1",
    });
    const result2 = await flagCache.isActiveForUser({
      name: "test_flag",
      user: "user1",
    });

    expect(result1).toBe(false);
    expect(result2).toBe(false);
    expect(mockModel.isActiveForContext).toHaveBeenCalledTimes(1);
  });

  it("should respect cache expiration", async () => {
    vi.mocked(mockModel.isActiveForContext).mockResolvedValue(true);

    const shortTtlCache = new FeatureFlagCache({
      model: mockModel,
      cache: new InMemoryCache<CachedFlagResult>(),
      ttl: 0.1,
    });

    // First call
    await shortTtlCache.isActiveForUser({ name: "test_flag", user: "user1" });

    // Second call within TTL
    await shortTtlCache.isActiveForUser({ name: "test_flag", user: "user1" });

    expect(mockModel.isActiveForContext).toHaveBeenCalledTimes(1);

    // Wait for cache expiration
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Third call after expiration
    await shortTtlCache.isActiveForUser({ name: "test_flag", user: "user1" });

    expect(mockModel.isActiveForContext).toHaveBeenCalledTimes(2);
  });

  it("should include subjects in cache key generation", async () => {
    vi.mocked(mockModel.isActiveForContext).mockResolvedValue(true);

    await flagCache.isActiveForContext({
      name: "subject-flag",
      subjects: ["tenant:acme"],
    });
    await flagCache.isActiveForContext({
      name: "subject-flag",
      subjects: ["tenant:beta"],
    });

    expect(mockModel.isActiveForContext).toHaveBeenCalledTimes(2);
  });

  it("should fire onExpired on cache hit for an expired flag", async () => {
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 1);
    const flagSnapshot: FeatureFlag = {
      id: 1,
      name: "test_flag",
      everyone: true,
      created: new Date(),
      modified: new Date(),
      expires: pastDate,
    };

    vi.mocked(mockModel.isActiveForContext).mockResolvedValue(false);
    // One getByName on the miss path (to store the expiry), then one on the hit path
    vi.mocked(mockModel.getByName).mockResolvedValue(flagSnapshot);

    // First call (miss) — the miss path stores the expiry from the snapshot
    const result1 = await flagCache.isActiveForUser({ name: "test_flag", user: "user123" });
    expect(result1).toBe(false);
    // The model itself fired the handler on the miss — we must not double-fire here
    expect(mockModel.fireExpiredHandler).not.toHaveBeenCalled();

    // Second call (hit) — stored expiry is in the past, so we re-read the flag
    // fresh and fire the handler via the shared model helper
    const result2 = await flagCache.isActiveForUser({ name: "test_flag", user: "user123" });
    expect(result2).toBe(false);
    expect(mockModel.isActiveForContext).toHaveBeenCalledTimes(1);
    expect(mockModel.getByName).toHaveBeenCalledTimes(2);
    expect(mockModel.fireExpiredHandler).toHaveBeenCalledTimes(1);
    expect(mockModel.fireExpiredHandler).toHaveBeenCalledWith(flagSnapshot);
  });

  it("should re-fire onExpired on every cache hit, not just the first", async () => {
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 1);
    const flagSnapshot: FeatureFlag = {
      id: 1,
      name: "test_flag",
      everyone: true,
      created: new Date(),
      modified: new Date(),
      expires: pastDate,
    };

    vi.mocked(mockModel.isActiveForContext).mockResolvedValue(false);
    vi.mocked(mockModel.getByName).mockResolvedValue(flagSnapshot);

    await flagCache.isActiveForUser({ name: "test_flag", user: "user123" });
    await flagCache.isActiveForUser({ name: "test_flag", user: "user123" });
    await flagCache.isActiveForUser({ name: "test_flag", user: "user123" });

    expect(mockModel.isActiveForContext).toHaveBeenCalledTimes(1);
    expect(mockModel.fireExpiredHandler).toHaveBeenCalledTimes(2);
  });

  it("should ignore the handler's return value on cache hit", async () => {
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 1);
    const flagSnapshot: FeatureFlag = {
      id: 1,
      name: "test_flag",
      everyone: true,
      created: new Date(),
      modified: new Date(),
      expires: pastDate,
    };

    vi.mocked(mockModel.isActiveForContext).mockResolvedValue(false);
    vi.mocked(mockModel.getByName).mockResolvedValue(flagSnapshot);
    // Handler returns true (override) — the cached result must still stand
    vi.mocked(mockModel.fireExpiredHandler).mockResolvedValue(true as any);

    await flagCache.isActiveForUser({ name: "test_flag", user: "user123" });
    const result2 = await flagCache.isActiveForUser({ name: "test_flag", user: "user123" });

    expect(result2).toBe(false);
  });

  it("should not fetch the flag or fire onExpired on a cache hit for a future-expiry flag", async () => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 30);
    const flagSnapshot: FeatureFlag = {
      id: 1,
      name: "test_flag",
      everyone: true,
      created: new Date(),
      modified: new Date(),
      expires: futureDate,
    };

    vi.mocked(mockModel.isActiveForContext).mockResolvedValue(true);
    vi.mocked(mockModel.getByName).mockResolvedValue(flagSnapshot);

    // Two calls — both hit the cache after the first miss; the second must not
    // read the flag or fire the handler (stored expiry is in the future)
    await flagCache.isActiveForUser({ name: "test_flag", user: "user123" });
    const result2 = await flagCache.isActiveForUser({ name: "test_flag", user: "user123" });

    expect(result2).toBe(true);
    expect(mockModel.getByName).toHaveBeenCalledTimes(1); // miss path only
    expect(mockModel.fireExpiredHandler).not.toHaveBeenCalled();
  });

  it("should not fire onExpired on a cache hit when the flag no longer exists", async () => {
    vi.mocked(mockModel.isActiveForContext).mockResolvedValue(false);
    // Miss path: flag is null — the entry stores a null expiry, making later hits cheap
    vi.mocked(mockModel.getByName).mockResolvedValue(null);

    await flagCache.isActiveForUser({ name: "missing_flag", user: "user123" });
    await flagCache.isActiveForUser({ name: "missing_flag", user: "user123" });

    expect(mockModel.fireExpiredHandler).not.toHaveBeenCalled();
  });

  it("should use the fresh flag from the DB on a cache hit even if the stored expiry says expired", async () => {
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 1);
    // Stored snapshot says expired; the fresh flag from the DB is now non-expired
    const staleSnapshot = {
      id: 1,
      name: "test_flag",
      everyone: true,
      created: new Date(),
      modified: new Date(),
      expires: pastDate,
    } as FeatureFlag;
    const freshSnapshot = {
      id: 1,
      name: "test_flag",
      everyone: true,
      created: new Date(),
      modified: new Date(),
      expires: new Date(pastDate.getTime() + 60_000), // extended past now
    } as FeatureFlag;

    vi.mocked(mockModel.isActiveForContext).mockResolvedValue(false);
    // Miss path returns the stale snapshot; hit path returns the fresh one
    vi.mocked(mockModel.getByName)
      .mockResolvedValueOnce(staleSnapshot)
      .mockResolvedValue(freshSnapshot);

    await flagCache.isActiveForUser({ name: "test_flag", user: "user123" });
    const result2 = await flagCache.isActiveForUser({ name: "test_flag", user: "user123" });

    expect(result2).toBe(false); // cached result stands
    // The stored expiry was in the past, so the hit re-read the flag fresh
    expect(mockModel.getByName).toHaveBeenCalledTimes(2);
    // The fresh flag is non-expired, so the shared helper no-ops — it still
    // receives the fresh snapshot, and its return value is ignored
    expect(mockModel.fireExpiredHandler).toHaveBeenCalledWith(freshSnapshot);
  });

  it("should return legacy boolean entries from the cache as-is", async () => {
    // Simulate a cache holding entries written by the old version: bare booleans
    let storedValue: any = true;
    const legacyCache: Cache<any> = {
      get: async () => storedValue,
      set: async () => {},
      delete: async () => {},
    };
    const legacyFlagCache = new FeatureFlagCache({
      model: mockModel,
      cache: legacyCache,
      ttl: 1,
    });

    const result1 = await legacyFlagCache.isActiveForUser({
      name: "test_flag",
      user: "user1",
    });
    expect(result1).toBe(true);
    expect(mockModel.isActiveForContext).not.toHaveBeenCalled();

    // Falsy cached value must survive too
    storedValue = false;
    const result2 = await legacyFlagCache.isActiveForUser({
      name: "test_flag",
      user: "user1",
    });
    expect(result2).toBe(false);
  });

  it("should use custom TTL when provided", () => {
    const customTtlCache = new FeatureFlagCache({
      model: mockModel,
      cache,
      ttl: 300, // 5 minutes
    });

    expect(customTtlCache).toBeInstanceOf(FeatureFlagCache);
  });
});
