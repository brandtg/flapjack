import { describe, expect, it, vi, beforeEach } from "vitest";
import { InMemoryCache, FeatureFlagCache, Cache } from "./cache.js";
import { FeatureFlagModel } from "./model.js";

describe("InMemoryCache", () => {
  let cache: InMemoryCache<string>;

  beforeEach(() => {
    cache = new InMemoryCache();
  });

  it("should store and retrieve values", () => {
    cache.set("key1", "value1");
    expect(cache.get("key1")).toBe("value1");
  });

  it("should return undefined for non-existent keys", () => {
    expect(cache.get("nonexistent")).toBeUndefined();
  });

  it("should expire entries after TTL", async () => {
    cache.set("key1", "value1", 0.1); // 100ms TTL
    expect(cache.get("key1")).toBe("value1");

    // Wait for expiration
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(cache.get("key1")).toBeUndefined();
  });

  it("should override default TTL when specified", async () => {
    const shortCache = new InMemoryCache();
    shortCache.set("key1", "value1", 0.2); // Override with 200ms TTL

    // Should still be there after default TTL
    await new Promise((resolve) => setTimeout(resolve, 75));
    expect(shortCache.get("key1")).toBe("value1");

    // Should be expired after override TTL
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(shortCache.get("key1")).toBeUndefined();
  });

  it("should delete entries", () => {
    cache.set("key1", "value1");
    expect(cache.get("key1")).toBe("value1");

    cache.delete("key1");
    expect(cache.get("key1")).toBeUndefined();
  });

  it("should clear expired entries", async () => {
    cache.set("key1", "value1", 0.1); // 100ms TTL
    cache.set("key2", "value2", 1); // 1 second TTL

    expect(cache.size()).toBe(2);

    // Wait for first key to expire
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Size should still be 2 (expired entries not cleaned yet)
    expect(cache.size()).toBe(2);

    // Access expired key should clean it up
    expect(cache.get("key1")).toBeUndefined();
    expect(cache.size()).toBe(1);

    // Manual cleanup should work too
    cache.clearExpired();
    expect(cache.size()).toBe(1);
    expect(cache.get("key2")).toBe("value2");
  });

  it("should clear all entries", () => {
    cache.set("key1", "value1");
    cache.set("key2", "value2");

    expect(cache.size()).toBe(2);

    cache.clear();
    expect(cache.size()).toBe(0);
    expect(cache.get("key1")).toBeUndefined();
    expect(cache.get("key2")).toBeUndefined();
  });
});

describe("FeatureFlagCache", () => {
  let mockModel: FeatureFlagModel;
  let cache: Cache<boolean>;
  let flagCache: FeatureFlagCache;

  beforeEach(() => {
    // Create mock model
    mockModel = {
      isActiveForUser: vi.fn(),
    } as any;

    // Create cache
    cache = new InMemoryCache();

    // Create flag cache
    flagCache = new FeatureFlagCache({
      model: mockModel,
      cache,
      ttl: 1,
    });
  });

  it("should call model on cache miss", async () => {
    const mockResult = true;
    vi.mocked(mockModel.isActiveForUser).mockResolvedValue(mockResult);

    const result = await flagCache.isActiveForUser({
      name: "test_flag",
      user: "user123",
    });

    expect(result).toBe(mockResult);
    expect(mockModel.isActiveForUser).toHaveBeenCalledWith({
      name: "test_flag",
      user: "user123",
    });
    expect(mockModel.isActiveForUser).toHaveBeenCalledTimes(1);
  });

  it("should return cached result on cache hit", async () => {
    const mockResult = true;
    vi.mocked(mockModel.isActiveForUser).mockResolvedValue(mockResult);

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
    expect(mockModel.isActiveForUser).toHaveBeenCalledTimes(1);
  });

  it("should generate different cache keys for different parameters", async () => {
    vi.mocked(mockModel.isActiveForUser).mockResolvedValue(true);

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
    expect(mockModel.isActiveForUser).toHaveBeenCalledTimes(8);
  });

  it("should generate same cache key for same parameters regardless of order", async () => {
    vi.mocked(mockModel.isActiveForUser).mockResolvedValue(true);

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
    expect(mockModel.isActiveForUser).toHaveBeenCalledTimes(1);
  });

  it("should handle undefined/null parameters consistently", async () => {
    vi.mocked(mockModel.isActiveForUser).mockResolvedValue(true);

    // Test various combinations of undefined parameters
    await flagCache.isActiveForUser({ name: "test_flag" });
    await flagCache.isActiveForUser({ name: "test_flag", user: undefined });
    await flagCache.isActiveForUser({ name: "test_flag", roles: undefined });
    await flagCache.isActiveForUser({ name: "test_flag", groups: undefined });

    // All should generate the same cache key
    expect(mockModel.isActiveForUser).toHaveBeenCalledTimes(1);
  });

  it("should cache false results as well as true results", async () => {
    vi.mocked(mockModel.isActiveForUser).mockResolvedValue(false);

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
    expect(mockModel.isActiveForUser).toHaveBeenCalledTimes(1);
  });

  it("should respect cache expiration", async () => {
    vi.mocked(mockModel.isActiveForUser).mockResolvedValue(true);

    const shortTtlCache = new FeatureFlagCache({
      model: mockModel,
      cache: new InMemoryCache(),
      ttl: 0.1,
    });

    // First call
    await shortTtlCache.isActiveForUser({ name: "test_flag", user: "user1" });

    // Second call within TTL
    await shortTtlCache.isActiveForUser({ name: "test_flag", user: "user1" });

    expect(mockModel.isActiveForUser).toHaveBeenCalledTimes(1);

    // Wait for cache expiration
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Third call after expiration
    await shortTtlCache.isActiveForUser({ name: "test_flag", user: "user1" });

    expect(mockModel.isActiveForUser).toHaveBeenCalledTimes(2);
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
