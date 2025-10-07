# Migration Integration

This document describes how to integrate Flapjack's database migrations with applications that use `node-pg-migrate`.

## Overview

Flapjack includes database migrations that create the necessary tables and functions for feature flag management. The library provides a simple `runMigrations` function that integrates seamlessly with your existing `node-pg-migrate` workflow, using the same migrations tracking table as your application.

## Migration Files

Flapjack includes the following migrations:

- `migrations/1759720355601_create-feature-flag.js` - Creates the core feature flag table and associated triggers

These migrations are written using `node-pg-migrate` syntax and will be tracked in your application's existing migrations table.

## Integration (Recommended Approach)

### Simple Function Call

The easiest way to integrate Flapjack migrations is to use the exported `runMigrations` function in your application's migration script.

#### Example usage in your application's `migrate.js`:

```javascript
import { runMigrations } from 'flapjack';

async function migrate() {
  try {
    console.log('Running Flapjack migrations...');
    
    await runMigrations({ 
      databaseUrl: process.env.DATABASE_URL,
      migrationsTable: 'pgmigrations' // Use your app's migration table name
    });
    
    console.log('Flapjack migrations completed successfully!');
  } catch (error) {
    console.error('Migration failed:', error.message);
    process.exit(1);
  }
}

migrate();
```

#### With schema support:

```javascript
import { runMigrations } from 'flapjack';

await runMigrations({
  databaseUrl: process.env.DATABASE_URL,
  migrationsTable: 'pgmigrations',
  schema: 'myapp' // Creates tables as myapp.flapjack_feature_flag
});
```

### Function Signature

```typescript
interface MigrationOptions {
  databaseUrl: string;
  migrationsTable?: string; // Default: 'pgmigrations'
  schema?: string;          // Optional schema name
}

function runMigrations(options: MigrationOptions): Promise<void>
```

### Integration with Existing Migration Workflow

If you have an existing migration script that uses `node-pg-migrate` directly, you can integrate Flapjack migrations like this:

```javascript
import { runner } from 'node-pg-migrate';
import { runMigrations } from 'flapjack';

async function runAllMigrations() {
  const databaseUrl = process.env.DATABASE_URL;
  const migrationsTable = 'pgmigrations';
  
  // Run application migrations
  await runner({
    databaseUrl,
    dir: './migrations',
    direction: 'up',
    migrationsTable
  });
  
  // Run Flapjack migrations (they'll be added to the same tracking table)
  await runMigrations({ 
    databaseUrl, 
    migrationsTable 
  });
}
```

## Deployment Integration

### Example deployment script:

```bash
#!/bin/bash
set -e

echo "Running database migrations..."
node migrate.js

echo "Starting application..."
npm start
```

### Docker integration:

```dockerfile
# In your Dockerfile
COPY migrate.js .
RUN npm install flapjack

# In your entrypoint or startup script
CMD ["sh", "-c", "node migrate.js && npm start"]
```

## Benefits of This Approach

1. **Seamless Integration**: Flapjack migrations are tracked alongside your application migrations
2. **No Manual Steps**: No need to copy files or manage separate migration processes  
3. **Version Safety**: Migration state is automatically managed by `node-pg-migrate`
4. **Simple API**: Just one function call with standard connection parameters
5. **Schema Support**: Works with custom schemas and migration table names

## Migration Behavior

- Flapjack migrations are **idempotent** - safe to run multiple times
- They use the **same tracking table** as your application migrations
- Migration timestamps ensure **proper ordering** with your existing migrations
- **Already applied migrations are skipped** automatically

## Best Practices

### Version Management

1. **Pin Flapjack versions** in your `package.json` to control when new migrations are introduced
2. **Test in development** before deploying migration changes to production
3. **Review migration logs** to ensure successful completion

### Error Handling

```javascript
import { runMigrations } from 'flapjack';

async function migrate() {
  try {
    await runMigrations({ 
      databaseUrl: process.env.DATABASE_URL 
    });
  } catch (error) {
    console.error('Flapjack migration failed:', error.message);
    // Handle error appropriately for your deployment strategy
    throw error;
  }
}
```

### Testing Migrations

Test your migration integration in development:

```bash
# Reset database
dropdb myapp_test && createdb myapp_test

# Run your migration script
node migrate.js

# Verify Flapjack tables exist
psql myapp_test -c "\dt flapjack*"
psql myapp_test -c "SELECT * FROM pgmigrations WHERE name LIKE '%flapjack%';"
```

## Troubleshooting

### Common Issues

1. **Connection errors**: Verify your `DATABASE_URL` is correct and accessible
2. **Permission errors**: Ensure database user has CREATE TABLE and CREATE FUNCTION privileges
3. **Schema conflicts**: If using custom schemas, ensure they exist before running migrations

### Debugging

Enable verbose logging to see migration progress:

```javascript
// Temporarily modify the function or check migration table directly
console.log('Running Flapjack migrations...');
await runMigrations({ databaseUrl });
console.log('Flapjack migrations completed');
```

Check migration status:

```sql
-- See all applied migrations
SELECT * FROM pgmigrations ORDER BY run_on;

-- Check for Flapjack-specific migrations
SELECT * FROM pgmigrations WHERE name LIKE '%flapjack%' OR name LIKE '%feature-flag%';
```

This integration approach provides the simplest possible experience for consuming applications while ensuring proper migration management and compatibility with existing `node-pg-migrate` workflows.
