# Flapjack

A simple feature flags library with PostgreSQL integration.

## Installation

Install the library

```bash
npm install flapjack
```

Apply the migrations

```typescript
import { runMigrations } from "@brandtg/flapjack";

await runMigrations({
  // Connect to your PostgreSQL database
  databaseUrl: process.env.DATABASE_URL,
  // Use the same migrations table as your application
  migrationsTable: "pgmigrations",
});
```

## Usage

```typescript
import { Pool } from "pg";
import { FeatureFlagModel } from "@brandtg/flapjack";

// Connect to the database
const pool: Pool = getDatabasePool();
const featureFlags = new FeatureFlagModel(pool);

// Create a feature flag
// N.b. use a meaningful naming scheme like <feature>_<date>_<owner>
const flag = await featureFlags.create({
  name: "enable_new_checkout_20250101_gbrandt",
});

// Check if a feature flag is active for a user
const active = await featureFlag.isActiveForUser({
  name: "enable_new_checkout_20250101_gbrandt",
  user: "1234",
});

// Enable the feature flag for certain roles
await featureFlags.update(flag.id, {
  roles: ["admin", "staff"],
});

// Enable the feature flag for certain user groups
await featureFlags.update(flag.id, {
  groups: ["early_adopters"],
});

// Launch the flag to a certain percentage of users
await featureFlags.update(flag.id, {
  percent: 25,
});

// Launch the flag to everyone
await featureFlags.update(flag.id, {
  everyone: true,
});

// Disable the flag for everyone
await featureFlags.update(flag.id, {
  everyone: false,
});

// Move the flag back into normal state (other rules then apply)
await featureFlags.update(flag.id, {
  everyone: null,
});
```

## Development

### Setup

Create an environment file:

```bash
npm run dev:env
```

Start the PostgreSQL database:

```bash
npm run dev:docker:up
```

Run database migrations:

```bash
npm run dev:migrate
```

### Database Management

Create a new migration:

```bash
npm run create-migration -- migration_name
```

Reset the database:

```bash
npm run dev:docker:down
```

## Building and Publishing

### Development Build

To build the project for development and testing:

```bash
npm run build
```

This compiles TypeScript to JavaScript and generates type declaration files in the `dist/` directory.

### Creating a Development Package

To create a tarball package that can be installed manually in other projects:

```bash
npm run pack:dev
```

This will create a `flapjack-0.1.0.tgz` file that you can install in another project using:

```bash
npm install /path/to/flapjack-0.1.0.tgz
```

### Publishing to npm

Before publishing to npm, make sure your package is ready:

1. **Prepare for publishing** (runs linting, tests, and build):

   ```bash
   npm run prepublishOnly
   ```

2. **Publish to npm**:

   ```bash
   npm publish
   ```

   For a dry run to see what would be published:

   ```bash
   npm publish --dry-run
   ```

3. **Publishing a beta version**:
   ```bash
   npm publish --tag beta
   ```
