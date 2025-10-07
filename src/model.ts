import type { FeatureFlag } from "./types.js";
import type { QueryResult } from "pg";
import MurmurHash3 from "imurmurhash";

// Accepts either a Pool or a Client from 'pg'
interface Queryable {
  query: (text: string, params?: any[]) => Promise<QueryResult>;
}

const TABLE = "flapjack_feature_flag";

const COLUMNS = [
  "id",
  "name",
  "everyone",
  "percent",
  "roles",
  "groups",
  "users",
  "note",
  "created",
  "modified",
] as const;

type CreateInput = Omit<FeatureFlag, "id" | "created" | "modified">;
type UpdateChanges = Partial<Omit<FeatureFlag, "id" | "created" | "modified">>;

function mapRow(row: any): FeatureFlag {
  return {
    id: row.id,
    name: row.name,
    everyone: row.everyone ?? undefined,
    percent:
      row.percent === null || row.percent === undefined
        ? undefined
        : Number(row.percent),
    roles:
      row.roles && row.roles.length > 0 ? (row.roles as string[]) : undefined,
    groups:
      row.groups && row.groups.length > 0
        ? (row.groups as string[])
        : undefined,
    users:
      row.users && row.users.length > 0 ? (row.users as string[]) : undefined,
    note: row.note ?? undefined,
    created: new Date(row.created),
    modified: new Date(row.modified),
  };
}

/**
 * Model for managing feature flags stored in PostgreSQL.
 *
 * @example
 * ```typescript
 * import { Pool } from "pg";
 * import { FeatureFlagModel } from "@brandtg/flapjack";
 *
 * const pool = new Pool({ connectionString: process.env.DATABASE_URL });
 * const featureFlags = new FeatureFlagModel(pool);
 * ```
 */
export class FeatureFlagModel {
  private db: Queryable;

  /**
   * Creates a new FeatureFlagModel instance.
   *
   * @param db - A PostgreSQL Pool or Client instance that implements the Queryable interface
   *
   * @example
   * ```typescript
   * const pool = new Pool({ connectionString: process.env.DATABASE_URL });
   * const model = new FeatureFlagModel(pool);
   * ```
   */
  constructor(db: Queryable) {
    this.db = db;
  }

  /**
   * Creates a new feature flag in the database.
   *
   * @param input - Feature flag configuration
   * @param input.name - Unique name for the feature flag (required)
   * @param input.everyone - Optional boolean to enable/disable for everyone (overrides all other settings)
   * @param input.percent - Optional percentage rollout (0-99.9)
   * @param input.roles - Optional list of roles that have this flag enabled
   * @param input.groups - Optional list of user groups that have this flag enabled
   * @param input.users - Optional list of specific user IDs that have this flag enabled
   * @param input.note - Optional description of the flag's purpose
   * @returns The created feature flag with generated id, created, and modified timestamps
   *
   * @throws Will throw an error if a flag with the same name already exists
   *
   * @example
   * ```typescript
   * const flag = await model.create({
   *   name: "new_checkout_flow",
   *   roles: ["admin"],
   *   note: "New checkout redesign",
   * });
   * ```
   */
  async create(input: CreateInput): Promise<FeatureFlag> {
    const cols: string[] = ["name"];
    const vals: any[] = [input.name];

    if ("everyone" in input) {
      cols.push("everyone");
      vals.push(input.everyone ?? null);
    }
    if ("percent" in input) {
      cols.push("percent");
      vals.push(input.percent ?? null);
    }
    if ("roles" in input) {
      cols.push("roles");
      vals.push(input.roles ?? null);
    }
    if ("groups" in input) {
      cols.push("groups");
      vals.push(input.groups ?? null);
    }
    if ("users" in input) {
      cols.push("users");
      vals.push(input.users ?? null);
    }
    if ("note" in input) {
      cols.push("note");
      vals.push(input.note ?? null);
    }

    const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
    const sql = `INSERT INTO ${TABLE} (${cols.join(", ")}) VALUES (${placeholders}) RETURNING ${COLUMNS.join(", ")}`;
    const res = await this.db.query(sql, vals);
    return mapRow(res.rows[0]);
  }

  /**
   * Retrieves a feature flag by its ID.
   *
   * @param id - The unique identifier of the feature flag
   * @returns The feature flag if found, null otherwise
   *
   * @example
   * ```typescript
   * const flag = await model.getById(123);
   * if (flag) {
   *   console.log(`Flag ${flag.name} is configured`);
   * }
   * ```
   */
  async getById(id: number): Promise<FeatureFlag | null> {
    const sql = `SELECT ${COLUMNS.join(", ")} FROM ${TABLE} WHERE id = $1`;
    const res = await this.db.query(sql, [id]);
    if (res.rows.length === 0) return null;
    return mapRow(res.rows[0]);
  }

  /**
   * Retrieves a feature flag by its name.
   *
   * @param name - The unique name of the feature flag
   * @returns The feature flag if found, null otherwise
   *
   * @example
   * ```typescript
   * const flag = await model.getByName("new_checkout_flow");
   * if (flag) {
   *   console.log(`Flag is ${flag.everyone ? 'enabled' : 'disabled'} for everyone`);
   * }
   * ```
   */
  async getByName(name: string): Promise<FeatureFlag | null> {
    const sql = `SELECT ${COLUMNS.join(", ")} FROM ${TABLE} WHERE name = $1`;
    const res = await this.db.query(sql, [name]);
    if (res.rows.length === 0) return null;
    return mapRow(res.rows[0]);
  }

  /**
   * Retrieves all feature flags, ordered by ID.
   *
   * @returns Array of all feature flags in the database
   *
   * @example
   * ```typescript
   * const flags = await model.list();
   * console.log(`Total flags: ${flags.length}`);
   * flags.forEach(flag => {
   *   console.log(`${flag.name}: ${flag.everyone ?? 'conditional'}`);
   * });
   * ```
   */
  async list(): Promise<FeatureFlag[]> {
    const sql = `SELECT ${COLUMNS.join(", ")} FROM ${TABLE} ORDER BY id`;
    const res = await this.db.query(sql);
    return res.rows.map(mapRow);
  }

  /**
   * Updates an existing feature flag.
   *
   * @param id - The unique identifier of the feature flag to update
   * @param changes - Object containing the fields to update
   * @returns The updated feature flag if found, null otherwise
   *
   * @remarks
   * The modified timestamp is automatically updated by a database trigger.
   * Pass `null` for a field to clear it (e.g., `everyone: null` removes the override).
   * If no changes are provided, returns the flag unchanged.
   *
   * @example
   * ```typescript
   * // Gradually increase rollout percentage
   * await model.update(flagId, { percent: 25 });
   *
   * // Enable for everyone
   * await model.update(flagId, { everyone: true });
   *
   * // Remove everyone override, reverting to other rules
   * await model.update(flagId, { everyone: null });
   * ```
   */
  async update(
    id: number,
    changes: UpdateChanges,
  ): Promise<FeatureFlag | null> {
    const sets: string[] = [];
    const vals: any[] = [];

    if ("name" in changes) {
      sets.push(`name = $${sets.length + 1}`);
      vals.push(changes.name ?? null);
    }
    if ("everyone" in changes) {
      sets.push(`everyone = $${sets.length + 1}`);
      vals.push(changes.everyone ?? null);
    }
    if ("percent" in changes) {
      sets.push(`percent = $${sets.length + 1}`);
      vals.push(changes.percent ?? null);
    }
    if ("roles" in changes) {
      sets.push(`roles = $${sets.length + 1}`);
      vals.push(changes.roles ?? null);
    }
    if ("groups" in changes) {
      sets.push(`groups = $${sets.length + 1}`);
      vals.push(changes.groups ?? null);
    }
    if ("users" in changes) {
      sets.push(`users = $${sets.length + 1}`);
      vals.push(changes.users ?? null);
    }
    if ("note" in changes) {
      sets.push(`note = $${sets.length + 1}`);
      vals.push(changes.note ?? null);
    }

    if (sets.length === 0) {
      return this.getById(id);
    }

    const idParamIndex = sets.length + 1;
    vals.push(id);
    const sql = `UPDATE ${TABLE} SET ${sets.join(", ")} WHERE id = $${idParamIndex} RETURNING ${COLUMNS.join(", ")}`;
    const res = await this.db.query(sql, vals);
    if (res.rows.length === 0) return null;
    return mapRow(res.rows[0]);
  }

  /**
   * Deletes a feature flag from the database.
   *
   * @param id - The unique identifier of the feature flag to delete
   * @returns true if the flag was deleted, false if not found
   *
   * @example
   * ```typescript
   * const deleted = await model.delete(flagId);
   * if (deleted) {
   *   console.log("Flag successfully removed");
   * }
   * ```
   */
  async delete(id: number): Promise<boolean> {
    const res = await this.db.query(`DELETE FROM ${TABLE} WHERE id = $1`, [id]);
    return (res as any).rowCount > 0;
  }

  /**
   * Checks if a user belongs to any of the specified groups
   */
  private isActiveForGroups(
    userGroups: string[] = [],
    flagGroups: string[] = [],
  ): boolean {
    if (flagGroups.length === 0) return false;
    return flagGroups.some((group) => userGroups.includes(group));
  }

  /**
   * Computes the hash value for a user ID using MurmurHash3.
   *
   * @param userId - The user ID to hash
   * @returns The hash value used for percentage bucketing
   *
   * @remarks
   * This method is useful for debugging percentage rollouts.
   * The hash value is consistent for the same user ID.
   * The bucket is computed as `hash % 100`.
   *
   * @example
   * ```typescript
   * const hash = await model.hashUserId("user_123");
   * const bucket = hash % 100;
   * console.log(`User bucket: ${bucket}`);
   * // If bucket is 42 and percent is 50, user is in the rollout
   * ```
   */
  async hashUserId(userId: string): Promise<number> {
    return MurmurHash3(userId).result();
  }

  /**
   * Checks if a feature flag is active for a user based on configured rules.
   *
   * @param params - Parameters for flag evaluation
   * @param params.name - The name of the feature flag to check
   * @param params.user - Optional user ID
   * @param params.roles - Optional list of roles the user has
   * @param params.groups - Optional list of groups the user belongs to
   * @returns true if the flag is active for the user, false otherwise
   *
   * @remarks
   * Evaluation order (first match wins):
   * 1. Everyone override (if set to true/false, returns immediately)
   * 2. User ID is in the users list
   * 3. User belongs to any group in the groups list
   * 4. User has any role in the roles list
   * 5. User falls within the percentage rollout (based on consistent hashing)
   * 6. Default: returns false
   *
   * @example
   * ```typescript
   * // Check for admin user
   * const isActive = await model.isActiveForUser({
   *   name: "new_feature",
   *   user: "user_123",
   *   roles: ["admin"],
   *   groups: ["beta_testers"],
   * });
   *
   * if (isActive) {
   *   // Show new feature
   * } else {
   *   // Show old feature
   * }
   * ```
   */
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
    const flag = await this.getByName(name);

    // No such flag
    if (!flag) {
      return false;
    }

    // Everyone Override: If everyone is true or false, return that value immediately
    if (flag.everyone !== undefined && flag.everyone !== null) {
      return flag.everyone;
    }

    // User-Specific Check: If user ID is in the users array, return true
    if (user && flag.users && flag.users.includes(user)) {
      return true;
    }

    // Group Check: If any of the user's groups match any group in the groups array, return true
    if (groups && this.isActiveForGroups(groups, flag.groups)) {
      return true;
    }

    // Role Check: If any of the user's roles match any role in the roles array, return true
    if (flag.roles && roles) {
      for (const role of roles) {
        if (flag.roles.includes(role)) {
          return true;
        }
      }
    }

    // Percentage Check: If percentage rollout applies to this user, return rollout result
    if (user && flag.percent && flag.percent > 0) {
      const userHash = await this.hashUserId(user);
      const bucket = userHash % 100;
      if (bucket < flag.percent) {
        return true;
      }
    }

    // Default: Return false
    return false;
  }
}
