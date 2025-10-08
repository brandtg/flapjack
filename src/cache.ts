import { FeatureFlagModel } from "model.js";

export interface Cache {
  // TODO Are these the right types?
  get(key: string): any;
  set(key: string, value: any): void;
  delete(key: string): void;
}

export class FeatureFlagCache {
  private model: FeatureFlagModel;
  private cache: Cache;

  constructor(model: FeatureFlagModel, cache: Cache) {
    this.model = model;
    this.cache = cache;
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
