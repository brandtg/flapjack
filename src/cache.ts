import { FeatureFlagModel } from "./model.js";
import MurmurHash3 from "imurmurhash";

export interface Cache<T> {
  get(key: string): Promise<T | undefined>;
  set(key: string, value: T, ttl?: number): Promise<void>;
  delete(key: string): Promise<void>;
}

/**
 * Shape of a cached evaluation: the boolean the model returned plus the flag's
 * expiry at the time of the miss (epoch milliseconds, JSON-safe). Only the
 * expiry is stored — not the whole flag — so entries stay small. On a cache
 * hit, if the stored expiry says the flag may be expired, the cache layer
 * fetches the flag fresh and fires `onExpired` with it.
 */
export interface CachedFlagResult {
  result: boolean;
  flagExpires: number | null;
}

interface CacheEntry<T> {
  value: T;
  expiresAt?: number;
}

const DEFAULT_TTL = 60 * 5; // 5 minutes

/**
 * Simple in-memory cache with TTL support.
 */
export class InMemoryCache<T> implements Cache<T> {
  private cache = new Map<string, CacheEntry<T>>();

  async get(key: string): Promise<T | undefined> {
    const entry = this.cache.get(key);
    if (!entry) {
      return undefined;
    }

    const now = Date.now();
    if (entry.expiresAt !== undefined && now >= entry.expiresAt) {
      // Entry has expired, remove it
      this.cache.delete(key);
      return undefined;
    }

    return entry.value;
  }

  async set(key: string, value: T, ttl?: number): Promise<void> {
    const expiresAt = ttl !== undefined ? Date.now() + ttl * 1000 : undefined;
    this.cache.set(key, { value, expiresAt });
  }

  async delete(key: string): Promise<void> {
    this.cache.delete(key);
  }

  /**
   * Clear all expired entries from the cache.
   */
  clearExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (entry.expiresAt !== undefined && now >= entry.expiresAt) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Get the current size of the cache (including expired entries).
   */
  size(): number {
    return this.cache.size;
  }

  /**
   * Clear all entries from the cache.
   */
  clear(): void {
    this.cache.clear();
  }
}

export class FeatureFlagCache {
  private model: FeatureFlagModel;
  private cache: Cache<CachedFlagResult>;
  private ttl: number;

  constructor({
    model,
    cache,
    ttl = DEFAULT_TTL,
  }: {
    model: FeatureFlagModel;
    cache: Cache<CachedFlagResult>;
    ttl?: number;
  }) {
    this.model = model;
    this.cache = cache;
    this.ttl = ttl;
  }

  /**
   * Generates a cache key using murmur3 hash of the flag name and parameters.
   */
  private generateCacheKey({
    name,
    user,
    roles,
    groups,
    subjects,
  }: {
    name: string;
    user?: string;
    roles?: string[];
    groups?: string[];
    subjects?: string[];
  }): string {
    // Create a consistent string representation of the parameters
    const keyParts = [
      name,
      user || "",
      (roles || []).sort().join(","),
      (groups || []).sort().join(","),
      (subjects || []).sort().join(","),
    ];
    const keyString = keyParts.join("|");

    // Generate murmur3 hash
    const hash = MurmurHash3(keyString).result();
    return `flag:${hash}`;
  }

  async isActiveForUser({
    name,
    user,
    roles,
    groups,
  }: {
    name: string;
    user?: string;
    roles?: string[];
    groups?: string[];
  }): Promise<boolean> {
    return this.isActiveForContext({
      name,
      user,
      roles,
      groups,
    });
  }

  async isActiveForContext({
    name,
    user,
    roles,
    groups,
    subjects,
  }: {
    name: string;
    user?: string;
    roles?: string[];
    groups?: string[];
    subjects?: string[];
  }): Promise<boolean> {
    // Generate cache key
    const cacheKey = this.generateCacheKey({
      name,
      user,
      roles,
      groups,
      subjects,
    });

    // Try to get from cache first
    const rawEntry = await this.cache.get(cacheKey);
    if (rawEntry !== undefined) {
      // Legacy entries written by the previous version are bare booleans;
      // accept them so an existing deploy cache keeps working without a nuke.
      const entry: CachedFlagResult =
        typeof rawEntry === "boolean"
          ? { result: rawEntry, flagExpires: null }
          : (rawEntry as CachedFlagResult);

      // Re-fire onExpired on every evaluation (including cache hits) so
      // metrics/alerts keep firing for expired-flag usage. Only fetch the flag
      // if the stored expiry suggests it may be expired; the fresh flag is then
      // handed to the shared model helper, which no-ops for non-expired flags.
      // Legacy (boolean) entries carry no expiry, so nothing is fetched — the
      // original cache miss already fired the handler for those.
      // The cached result stands — the handler's return value is ignored here.
      if (entry.flagExpires !== null && entry.flagExpires <= Date.now()) {
        const flag = await this.model.getByName(name);
        if (flag) {
          await this.model.fireExpiredHandler(flag);
        }
      }
      return entry.result;
    }

    // Cache miss, get from model
    const result = await this.model.isActiveForContext({
      name,
      user,
      roles,
      groups,
      subjects,
    });

    // Store the result and the flag's expiry (one extra indexed read on the
    // miss path) so cache hits can cheaply check whether the flag may be expired
    const flag = await this.model.getByName(name);
    await this.cache.set(
      cacheKey,
      { result, flagExpires: flag?.expires?.getTime() ?? null },
      this.ttl,
    );

    return result;
  }
}
