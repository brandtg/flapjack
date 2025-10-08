import { FeatureFlagModel } from "model.js";

export interface Cache {
  // TODO Are these the right types? Also need ttl support
  get(key: string): any;
  set(key: string, value: any): void;
  delete(key: string): void;
}

const DEFAULT_TTL = 60 * 5; // 5 minutes

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
    ttl: number;
  }) {
    this.model = model;
    this.cache = cache;
    this.ttl = ttl;
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
    // TODO Implement caching logic
    return this.model.isActiveForUser({ name, user, roles, groups });
  }
}
