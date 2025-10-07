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

export class FeatureFlagModel {
  private db: Queryable;

  constructor(db: Queryable) {
    this.db = db;
  }

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

  async getById(id: number): Promise<FeatureFlag | null> {
    const sql = `SELECT ${COLUMNS.join(", ")} FROM ${TABLE} WHERE id = $1`;
    const res = await this.db.query(sql, [id]);
    if (res.rows.length === 0) return null;
    return mapRow(res.rows[0]);
  }

  async getByName(name: string): Promise<FeatureFlag | null> {
    const sql = `SELECT ${COLUMNS.join(", ")} FROM ${TABLE} WHERE name = $1`;
    const res = await this.db.query(sql, [name]);
    if (res.rows.length === 0) return null;
    return mapRow(res.rows[0]);
  }

  async list(): Promise<FeatureFlag[]> {
    const sql = `SELECT ${COLUMNS.join(", ")} FROM ${TABLE} ORDER BY id`;
    const res = await this.db.query(sql);
    return res.rows.map(mapRow);
  }

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

  async hashUserId(userId: string): Promise<number> {
    return MurmurHash3(userId).result();
  }

  async isEnabledForUser({
    flagName,
    userId,
    roles,
    groups,
  }: {
    flagName: string;
    userId?: string;
    roles?: string[];
    groups?: string[];
  }): Promise<boolean> {
    const flag = await this.getByName(flagName);

    // No such flag
    if (!flag) {
      return false;
    }

    // Everyone Override: If everyone is true or false, return that value immediately
    if (flag.everyone !== undefined) {
      return flag.everyone;
    }

    // User-Specific Check: If user ID is in the users array, return true
    if (userId && flag.users && flag.users.includes(userId)) {
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
    if (userId && flag.percent && flag.percent > 0) {
      const userHash = await this.hashUserId(userId);
      const bucket = userHash % 100;
      if (bucket < flag.percent) {
        return true;
      }
    }

    // Default: Return false
    return false;
  }
}
