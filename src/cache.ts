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
 * Default maximum number of entries a cache will hold before evicting the
 * least-recently-used entries. Callers that see many distinct flag/user
 * combinations (or very long-running processes) can raise or lower this via
 * `new InMemoryCache({ maxSize })`.
 */
export const DEFAULT_MAX_SIZE = 10_000;

/**
 * Simple in-memory cache with TTL support.
 *
 * Bounds its memory two ways: entries expire lazily on `get()`, and the map
 * is capped at `maxSize` entries (default 10_000) with LRU eviction when a
 * `set` would push it past the bound — expired entries are dropped first,
 * then the least-recently-used entries. No timers, so nothing holds the
 * event loop open.
 */
export class InMemoryCache<T> implements Cache<T> {
  private cache = new Map<string, CacheEntry<T>>();
  private maxSize: number;

  constructor(options?: { maxSize?: number }) {
    const maxSize = options?.maxSize ?? DEFAULT_MAX_SIZE;
    if (!Number.isInteger(maxSize) || maxSize < 1) {
      throw new Error("maxSize must be a positive integer");
    }
    this.maxSize = maxSize;
  }

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

    // Hit: refresh recency (iterate oldest-first in the Map, so delete +
    // re-insert keeps least-recently-used first)
    this.cache.delete(key);
    this.cache.set(key, entry);

    return entry.value;
  }

  async set(key: string, value: T, ttl?: number): Promise<void> {
    // Re-inserting moves the key to most-recently-used
    this.cache.delete(key);
    const expiresAt = ttl !== undefined ? Date.now() + ttl * 1000 : undefined;
    this.cache.set(key, { value, expiresAt });
    this.enforceBound();
  }

  /**
   * Evict expired entries first, then least-recently-used entries, until the
   * cache holds at most `maxSize` entries.
   */
  private enforceBound(): void {
    if (this.cache.size <= this.maxSize) return;

    const now = Date.now();
    const expiredKeys: string[] = [];
    for (const [key, entry] of this.cache) {
      if (entry.expiresAt !== undefined && now >= entry.expiresAt) {
        expiredKeys.push(key);
      }
    }
    for (const key of expiredKeys) {
      this.cache.delete(key);
    }

    // Map iteration is oldest-first (least-recently-used first) — delete
    // from the front until the cache is within the bound
    for (const key of this.cache.keys()) {
      if (this.cache.size <= this.maxSize) break;
      this.cache.delete(key);
    }
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
      [...(roles || [])].sort().join(","),
      [...(groups || [])].sort().join(","),
      [...(subjects || [])].sort().join(","),
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
