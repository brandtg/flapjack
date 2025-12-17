import type {
  FeatureFlag,
  FeatureFlagEventHandlers,
  FeatureFlagGroup,
} from "./types.js";
import type { QueryResult } from "pg";
import MurmurHash3 from "imurmurhash";

// Accepts either a Pool or a Client from 'pg'
interface Queryable {
  query: (text: string, params?: any[]) => Promise<QueryResult>;
}

const TABLE = "flapjack.feature_flag";

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
  "expires",
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
    expires: row.expires ? new Date(row.expires) : undefined,
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
  private eventHandlers?: FeatureFlagEventHandlers;

  /**
   * Creates a new FeatureFlagModel instance.
   *
   * @param db - A PostgreSQL Pool or Client instance that implements the Queryable interface
   * @param eventHandlers - Optional event handlers for feature flag events
   *
   * @example
   * ```typescript
   * const pool = new Pool({ connectionString: process.env.DATABASE_URL });
   * const model = new FeatureFlagModel(pool);
   * ```
   */
  constructor(db: Queryable, eventHandlers?: FeatureFlagEventHandlers) {
    this.db = db;
    this.eventHandlers = eventHandlers;
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
   * @param input.expires - Optional expiration date for the feature flag
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
    if ("expires" in input) {
      cols.push("expires");
      vals.push(input.expires ?? null);
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
   * Retrieves multiple feature flags by their names.
   *
   * @param names - Array of feature flag names to retrieve
   * @returns Array of feature flags found (may be shorter than input if some names don't exist)
   *
   * @example
   * ```typescript
   * const flags = await model.getManyByName(["feature1", "feature2", "feature3"]);
   * console.log(`Found ${flags.length} flags`);
   * ```
   */
  async getManyByName(names: string[]): Promise<FeatureFlag[]> {
    if (names.length === 0) return [];
    const sql = `SELECT ${COLUMNS.join(", ")} FROM ${TABLE} WHERE name = ANY($1)`;
    const res = await this.db.query(sql, [names]);
    return res.rows.map(mapRow);
  }

  /**
   * Retrieves multiple feature flags by their IDs.
   *
   * @param ids - Array of feature flag IDs to retrieve
   * @returns Array of feature flags found (may be shorter than input if some IDs don't exist)
   *
   * @example
   * ```typescript
   * const flags = await model.getMany([1, 2, 3]);
   * console.log(`Found ${flags.length} flags`);
   * ```
   */
  async getMany(ids: number[]): Promise<FeatureFlag[]> {
    if (ids.length === 0) return [];

    const sql = `SELECT ${COLUMNS.join(", ")} FROM ${TABLE} WHERE id = ANY($1)`;
    const res = await this.db.query(sql, [ids]);
    return res.rows.map(mapRow);
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
    if ("expires" in changes) {
      sets.push(`expires = $${sets.length + 1}`);
      vals.push(changes.expires ?? null);
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
   * Evaluates a feature flag for a user based on flag configuration.
   * This is a stateless helper that performs the actual flag evaluation logic.
   */
  async evaluateFlagForUser(
    flag: FeatureFlag,
    {
      user,
      roles,
      groups,
    }: {
      user?: string;
      roles?: string[];
      groups?: string[];
    },
  ): Promise<boolean> {
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

    // If the flag has expired, trigger event and return false
    if (
      this.eventHandlers?.onExpired &&
      flag &&
      flag.expires &&
      flag.expires <= new Date()
    ) {
      const expiredResult = await this.eventHandlers.onExpired({ flag });
      if (expiredResult !== undefined) {
        return expiredResult;
      }
    }

    return this.evaluateFlagForUser(flag, { user, roles, groups });
  }

  /**
   * Checks if multiple feature flags are active for a user based on configured rules.
   *
   * @param params - Parameters for flag evaluation
   * @param params.names - Optional array of feature flag names to check. If not provided, checks all flags.
   * @param params.user - Optional user ID
   * @param params.roles - Optional list of roles the user has
   * @param params.groups - Optional list of groups the user belongs to
   * @returns Record mapping flag names to their active status (true/false)
   *
   * @remarks
   * This method fetches all flags in a single query for efficiency.
   * If names is provided, only those flags are checked. Non-existent flags are marked as false.
   * If names is not provided, all flags in the database are checked.
   * Evaluation order for each flag (first match wins):
   * 1. Everyone override (if set to true/false, returns immediately)
   * 2. User ID is in the users list
   * 3. User belongs to any group in the groups list
   * 4. User has any role in the roles list
   * 5. User falls within the percentage rollout (based on consistent hashing)
   * 6. Default: returns false
   *
   * @example
   * ```typescript
   * // Check specific flags
   * const results = await model.areActiveForUser({
   *   names: ["feature1", "feature2", "feature3"],
   *   user: "user_123",
   *   roles: ["admin"],
   *   groups: ["beta_testers"],
   * });
   *
   * // Check all flags
   * const allResults = await model.areActiveForUser({
   *   user: "user_123",
   *   roles: ["admin"],
   *   groups: ["beta_testers"],
   * });
   *
   * if (results["feature1"]) {
   *   // Show feature1
   * }
   * if (results["feature2"]) {
   *   // Show feature2
   * }
   * ```
   */
  async areActiveForUser({
    names,
    user,
    roles,
    groups,
  }: {
    names?: string[];
    user?: string;
    roles?: string[];
    groups?: string[];
  }): Promise<Record<string, boolean>> {
    let flags: FeatureFlag[];
    let requestedNames: string[];

    if (names === undefined) {
      // If no names provided, get all flags
      flags = await this.list();
      requestedNames = flags.map((flag) => flag.name);
    } else {
      // If names provided, fetch only those flags
      flags = await this.getManyByName(names);
      requestedNames = names;
    }

    const flagMap = new Map(flags.map((flag) => [flag.name, flag]));
    const result: Record<string, boolean> = {};

    for (const name of requestedNames) {
      const flag = flagMap.get(name);

      if (!flag) {
        result[name] = false;
        continue;
      }

      // If the flag has expired, trigger event
      if (
        this.eventHandlers?.onExpired &&
        flag.expires &&
        flag.expires <= new Date()
      ) {
        const expiredResult = await this.eventHandlers.onExpired({ flag });
        if (expiredResult !== undefined) {
          result[name] = expiredResult;
          continue;
        }
      }

      result[name] = await this.evaluateFlagForUser(flag, {
        user,
        roles,
        groups,
      });
    }

    return result;
  }
}

const GROUP_TABLE = "flapjack.feature_flag_group";
const GROUP_MEMBER_TABLE = "flapjack.feature_flag_group_member";

const GROUP_COLUMNS = ["id", "name", "note", "created", "modified"] as const;

type CreateGroupInput = Omit<FeatureFlagGroup, "id" | "created" | "modified">;
type UpdateGroupChanges = Partial<
  Omit<FeatureFlagGroup, "id" | "created" | "modified">
>;
type UpdateAllChanges = Partial<
  Pick<FeatureFlag, "everyone" | "percent" | "roles" | "groups" | "users">
>;

function mapGroupRow(row: any): FeatureFlagGroup {
  return {
    id: row.id,
    name: row.name,
    note: row.note ?? undefined,
    created: new Date(row.created),
    modified: new Date(row.modified),
  };
}

/**
 * Model for managing feature flag groups stored in PostgreSQL.
 *
 * @example
 * ```typescript
 * import { Pool } from "pg";
 * import { FeatureFlagGroupModel } from "@brandtg/flapjack";
 *
 * const pool = new Pool({ connectionString: process.env.DATABASE_URL });
 * const groups = new FeatureFlagGroupModel(pool);
 * ```
 */
export class FeatureFlagGroupModel {
  private db: Queryable;

  /**
   * Creates a new FeatureFlagGroupModel instance.
   *
   * @param db - A PostgreSQL Pool or Client instance that implements the Queryable interface
   *
   * @example
   * ```typescript
   * const pool = new Pool({ connectionString: process.env.DATABASE_URL });
   * const model = new FeatureFlagGroupModel(pool);
   * ```
   */
  constructor(db: Queryable) {
    this.db = db;
  }

  /**
   * Creates a new feature flag group in the database.
   *
   * @param input - Feature flag group configuration
   * @param input.name - Unique name for the group (required)
   * @param input.note - Optional description of the group's purpose
   * @returns The created group with generated id, created, and modified timestamps
   *
   * @throws Will throw an error if a group with the same name already exists
   *
   * @example
   * ```typescript
   * const group = await model.create({
   *   name: "billing_redesign",
   *   note: "All flags related to the new billing flow",
   * });
   * ```
   */
  async create(input: CreateGroupInput): Promise<FeatureFlagGroup> {
    const cols: string[] = ["name"];
    const vals: any[] = [input.name];

    if ("note" in input) {
      cols.push("note");
      vals.push(input.note ?? null);
    }

    const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
    const sql = `INSERT INTO ${GROUP_TABLE} (${cols.join(", ")}) 
      VALUES (${placeholders}) 
      RETURNING ${GROUP_COLUMNS.join(", ")}`;
    const res = await this.db.query(sql, vals);
    return mapGroupRow(res.rows[0]);
  }

  /**
   * Retrieves a feature flag group by its ID.
   *
   * @param id - The group ID
   * @returns The group if found, null otherwise
   *
   * @example
   * ```typescript
   * const group = await model.getById(1);
   * if (group) {
   *   console.log(group.name);
   * }
   * ```
   */
  async getById(id: number): Promise<FeatureFlagGroup | null> {
    const sql = `SELECT ${GROUP_COLUMNS.join(", ")} FROM ${GROUP_TABLE} WHERE id = $1`;
    const res = await this.db.query(sql, [id]);
    return res.rows.length > 0 ? mapGroupRow(res.rows[0]) : null;
  }

  /**
   * Retrieves a feature flag group by its name.
   *
   * @param name - The group name
   * @returns The group if found, null otherwise
   *
   * @example
   * ```typescript
   * const group = await model.getByName("billing_redesign");
   * ```
   */
  async getByName(name: string): Promise<FeatureFlagGroup | null> {
    const sql = `SELECT ${GROUP_COLUMNS.join(", ")} FROM ${GROUP_TABLE} WHERE name = $1`;
    const res = await this.db.query(sql, [name]);
    return res.rows.length > 0 ? mapGroupRow(res.rows[0]) : null;
  }

  /**
   * Lists all feature flag groups.
   *
   * @returns Array of all groups
   *
   * @example
   * ```typescript
   * const groups = await model.list();
   * for (const group of groups) {
   *   console.log(group.name);
   * }
   * ```
   */
  async list(): Promise<FeatureFlagGroup[]> {
    const sql = `SELECT ${GROUP_COLUMNS.join(", ")} FROM ${GROUP_TABLE} ORDER BY created DESC`;
    const res = await this.db.query(sql);
    return res.rows.map(mapGroupRow);
  }

  /**
   * Updates a feature flag group.
   *
   * @param id - The group ID to update
   * @param changes - Fields to update
   * @returns The updated group if found, null otherwise
   *
   * @example
   * ```typescript
   * const updated = await model.update(1, {
   *   note: "Updated description",
   * });
   * ```
   */
  async update(
    id: number,
    changes: UpdateGroupChanges,
  ): Promise<FeatureFlagGroup | null> {
    const updates: string[] = [];
    const vals: any[] = [];
    let paramIdx = 1;

    if ("name" in changes) {
      updates.push(`name = $${paramIdx++}`);
      vals.push(changes.name);
    }
    if ("note" in changes) {
      updates.push(`note = $${paramIdx++}`);
      vals.push(changes.note ?? null);
    }

    if (updates.length === 0) {
      return this.getById(id);
    }

    vals.push(id);
    const sql = `UPDATE ${GROUP_TABLE} 
      SET ${updates.join(", ")} 
      WHERE id = $${paramIdx} 
      RETURNING ${GROUP_COLUMNS.join(", ")}`;
    const res = await this.db.query(sql, vals);
    return res.rows.length > 0 ? mapGroupRow(res.rows[0]) : null;
  }

  /**
   * Deletes a feature flag group and all its member relationships.
   *
   * @param id - The group ID to delete
   * @returns true if deleted, false if not found
   *
   * @example
   * ```typescript
   * const deleted = await model.delete(1);
   * ```
   */
  async delete(id: number): Promise<boolean> {
    const res = await this.db.query(
      `DELETE FROM ${GROUP_TABLE} WHERE id = $1`,
      [id],
    );
    return (res as any).rowCount > 0;
  }

  /**
   * Adds a feature flag to a group.
   *
   * @param groupId - The group ID
   * @param featureFlagId - The feature flag ID to add
   * @returns true if added successfully, false if already exists
   *
   * @throws Will throw an error if group or feature flag doesn't exist
   *
   * @example
   * ```typescript
   * await model.addFeatureFlag(1, 5);
   * ```
   */
  async addFeatureFlag(
    groupId: number,
    featureFlagId: number,
  ): Promise<boolean> {
    try {
      const sql = `INSERT INTO ${GROUP_MEMBER_TABLE} (group_id, feature_flag_id) 
        VALUES ($1, $2)`;
      await this.db.query(sql, [groupId, featureFlagId]);
      return true;
    } catch (err: any) {
      // If unique constraint violation, return false
      if (err.code === "23505") {
        return false;
      }
      throw err;
    }
  }

  /**
   * Removes a feature flag from a group.
   *
   * @param groupId - The group ID
   * @param featureFlagId - The feature flag ID to remove
   * @returns true if removed, false if relationship didn't exist
   *
   * @example
   * ```typescript
   * await model.removeFeatureFlag(1, 5);
   * ```
   */
  async removeFeatureFlag(
    groupId: number,
    featureFlagId: number,
  ): Promise<boolean> {
    const sql = `DELETE FROM ${GROUP_MEMBER_TABLE} 
      WHERE group_id = $1 AND feature_flag_id = $2`;
    const res = await this.db.query(sql, [groupId, featureFlagId]);
    return (res as any).rowCount > 0;
  }

  /**
   * Gets all feature flags in a group.
   *
   * @param groupId - The group ID
   * @returns Array of feature flags in the group
   *
   * @example
   * ```typescript
   * const flags = await model.getFeatureFlags(1);
   * for (const flag of flags) {
   *   console.log(flag.name);
   * }
   * ```
   */
  async getFeatureFlags(groupId: number): Promise<FeatureFlag[]> {
    const sql = `
      SELECT ${COLUMNS.map((c) => `f.${c}`).join(", ")}
      FROM ${TABLE} f
      INNER JOIN ${GROUP_MEMBER_TABLE} gm ON f.id = gm.feature_flag_id
      WHERE gm.group_id = $1
      ORDER BY f.created DESC
    `;
    const res = await this.db.query(sql, [groupId]);
    return res.rows.map(mapRow);
  }

  /**
   * Gets all groups that contain a specific feature flag.
   *
   * @param featureFlagId - The feature flag ID
   * @returns Array of groups containing the feature flag
   *
   * @example
   * ```typescript
   * const groups = await model.getGroupsForFeatureFlag(5);
   * ```
   */
  async getGroupsForFeatureFlag(
    featureFlagId: number,
  ): Promise<FeatureFlagGroup[]> {
    const sql = `
      SELECT ${GROUP_COLUMNS.map((c) => `g.${c}`).join(", ")}
      FROM ${GROUP_TABLE} g
      INNER JOIN ${GROUP_MEMBER_TABLE} gm ON g.id = gm.group_id
      WHERE gm.feature_flag_id = $1
      ORDER BY g.created DESC
    `;
    const res = await this.db.query(sql, [featureFlagId]);
    return res.rows.map(mapGroupRow);
  }

  /**
   * Updates all feature flags in a group with the same changes.
   *
   * @param groupId - The group ID
   * @param changes - Fields to update (only everyone, percent, roles, groups, users allowed)
   * @returns The number of feature flags updated
   *
   * @example
   * ```typescript
   * // Enable all flags in a group for everyone
   * const count = await model.updateAll(1, { everyone: true });
   *
   * // Set percentage rollout for all flags in a group
   * const count = await model.updateAll(1, { percent: 25 });
   *
   * // Add roles to all flags in a group
   * const count = await model.updateAll(1, { roles: ["admin", "beta"] });
   * ```
   */
  async updateAll(groupId: number, changes: UpdateAllChanges): Promise<number> {
    const updates: string[] = [];
    const vals: any[] = [];
    let paramIdx = 1;

    if ("everyone" in changes) {
      updates.push(`everyone = $${paramIdx++}`);
      vals.push(changes.everyone ?? null);
    }
    if ("percent" in changes) {
      updates.push(`percent = $${paramIdx++}`);
      vals.push(changes.percent ?? null);
    }
    if ("roles" in changes) {
      updates.push(`roles = $${paramIdx++}`);
      vals.push(changes.roles ?? null);
    }
    if ("groups" in changes) {
      updates.push(`groups = $${paramIdx++}`);
      vals.push(changes.groups ?? null);
    }
    if ("users" in changes) {
      updates.push(`users = $${paramIdx++}`);
      vals.push(changes.users ?? null);
    }

    if (updates.length === 0) {
      return 0;
    }

    vals.push(groupId);
    const sql = `
      UPDATE ${TABLE} 
      SET ${updates.join(", ")}
      WHERE id IN (
        SELECT feature_flag_id 
        FROM ${GROUP_MEMBER_TABLE}
        WHERE group_id = $${paramIdx}
      )
    `;
    const res = await this.db.query(sql, vals);
    return (res as any).rowCount;
  }
}
