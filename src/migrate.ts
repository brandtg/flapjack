import { runner } from "node-pg-migrate";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface MigrationOptions {
  databaseUrl: string;
  migrationsTable?: string;
  schema?: string;
}

/**
 * Run Flapjack database migrations
 *
 * @param options Migration configuration options
 * @param options.databaseUrl PostgreSQL connection URL
 * @param options.migrationsTable Name of the migrations tracking table (default: 'pgmigrations')
 * @param options.schema Schema name to create tables in (optional)
 * @returns Promise that resolves when migrations are complete
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
