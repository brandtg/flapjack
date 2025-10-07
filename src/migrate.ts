import { runner } from "node-pg-migrate";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Configuration options for running Flapjack database migrations.
 */
export interface MigrationOptions {
  /** PostgreSQL connection URL (e.g., "postgresql://user:pass@localhost/dbname") */
  databaseUrl: string;
  /** Name of the migrations tracking table (default: 'pgmigrations') */
  migrationsTable?: string;
  /** Schema name to create tables in (optional) */
  schema?: string;
}

/**
 * Run Flapjack database migrations.
 *
 * This function applies all pending migrations to create or update the
 * flapjack_feature_flag table in your PostgreSQL database.
 *
 * @param options - Migration configuration options
 * @param options.databaseUrl - PostgreSQL connection URL
 * @param options.migrationsTable - Name of the migrations tracking table (default: 'pgmigrations')
 * @param options.schema - Schema name to create tables in (optional)
 * @returns Promise that resolves when migrations are complete
 *
 * @throws Will throw an error if the database connection fails or migrations cannot be applied
 *
 * @example
 * ```typescript
 * import { runMigrations } from "@brandtg/flapjack";
 *
 * // Basic usage
 * await runMigrations({
 *   databaseUrl: process.env.DATABASE_URL,
 * });
 *
 * // With custom migrations table
 * await runMigrations({
 *   databaseUrl: process.env.DATABASE_URL,
 *   migrationsTable: "my_migrations",
 * });
 *
 * // With custom schema
 * await runMigrations({
 *   databaseUrl: process.env.DATABASE_URL,
 *   schema: "feature_flags",
 * });
 * ```
 */
export async function runMigrations(options: MigrationOptions): Promise<void> {
  const { databaseUrl, migrationsTable = "pgmigrations", schema } = options;

  // Path to migrations directory (relative to dist in production)
  const migrationsDir = path.resolve(__dirname, "../migrations");

  const migrationConfig = {
    databaseUrl,
    dir: migrationsDir,
    direction: "up" as const,
    migrationsTable,
    ...(schema && { schema }),
    verbose: false,
  };

  await runner(migrationConfig);
}
