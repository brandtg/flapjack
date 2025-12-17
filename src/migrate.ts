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
}

/**
 * Run Flapjack database migrations.
 *
 * This function applies all pending migrations to create or update the
 * flapjack.feature_flag table in your PostgreSQL database. All tables,
 * including the migrations tracking table, are created in the flapjack schema.
 *
 * @param options - Migration configuration options
 * @param options.databaseUrl - PostgreSQL connection URL
 * @returns Promise that resolves when migrations are complete
 *
 * @throws Will throw an error if the database connection fails or migrations cannot be applied
 *
 * @example
 * ```typescript
 * import { runMigrations } from "@brandtg/flapjack";
 *
 * await runMigrations({
 *   databaseUrl: process.env.DATABASE_URL,
 * });
 * ```
 */
export async function runMigrations(options: MigrationOptions): Promise<void> {
  const { databaseUrl } = options;

  // Path to migrations directory (relative to dist in production)
  const migrationsDir = path.resolve(__dirname, "../migrations");

  const migrationConfig = {
    databaseUrl,
    dir: migrationsDir,
    direction: "up" as const,
    schema: "flapjack",
    migrationsTable: "pgmigrations",
    createSchema: true,
    verbose: false,
  };

  await runner(migrationConfig);
}
