import { FeatureFlagModel } from "./model.js";
import MurmurHash3 from "imurmurhash";

export interface Cache {
  get(key: string): any;
  set(key: string, value: any, ttl?: number): void;
  delete(key: string): void;
}

interface CacheEntry<T> {
  value: T;
  expiresAt?: number;
}

const DEFAULT_TTL = 60 * 5; // 5 minutes

/**
 * Simple in-memory cache with TTL support.
 */
export class InMemoryCache implements Cache {
  private cache = new Map<string, CacheEntry<any>>();

  get(key: string): any {
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

  set(key: string, value: any, ttl?: number): void {
    const expiresAt = ttl !== undefined ? Date.now() + ttl * 1000 : undefined;
    this.cache.set(key, { value, expiresAt });
  }

  delete(key: string): void {
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
  private cache: Cache;
  private ttl: number;

  constructor({
    model,
    cache,
    ttl = DEFAULT_TTL,
  }: {
    model: FeatureFlagModel;
    cache: Cache;
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
  }: {
    name: string;
    user?: string;
    roles?: string[];
    groups?: string[];
  }): string {
    // Create a consistent string representation of the parameters
    const keyParts = [
      name,
      user || "",
      (roles || []).sort().join(","),
      (groups || []).sort().join(","),
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
    // Generate cache key
    const cacheKey = this.generateCacheKey({ name, user, roles, groups });

    // Try to get from cache first
    const cachedResult = this.cache.get(cacheKey);
    if (cachedResult !== undefined) {
      return cachedResult;
    }

    // Cache miss, get from model
    const result = await this.model.isActiveForUser({
      name,
      user,
      roles,
      groups,
    });

    // Store in cache with TTL
    this.cache.set(cacheKey, result, this.ttl);

    return result;
  }
}
