# Flapjack

[![CI](https://github.com/brandtg/flapjack/actions/workflows/ci.yml/badge.svg)](https://github.com/brandtg/flapjack/actions/workflows/ci.yml)
[![npm version](https://badge.fury.io/js/@brandtg%2Fflapjack.svg)](https://www.npmjs.com/package/@brandtg/flapjack)
[![License](https://img.shields.io/badge/License-BSD_3--Clause-blue.svg)](https://opensource.org/licenses/BSD-3-Clause)

A simple feature flags library with PostgreSQL integration, inspired by [django-waffle](https://github.com/django-waffle/django-waffle).

## Features

- **Multiple targeting strategies**: Enable features for specific users, roles, groups, or percentage rollouts
- **Consistent hashing**: Deterministic user bucketing for A/B testing and experimentation
- **PostgreSQL-backed**: Reliable, transactional flag storage with your existing database
- **CLI included**: Manage feature flags from the command line
- **TypeScript-first**: Full type safety with comprehensive TypeScript definitions
- **Battle-tested**: Comprehensive test suite with 31+ tests

## Requirements

- Node.js >= 18.0.0
- PostgreSQL >= 10.0

## Installation

Install the library

```bash
npm install @brandtg/flapjack
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

## How Feature Flag Evaluation Works

When checking if a feature flag is active for a user, Flapjack evaluates rules in the following order:

1. **Everyone Override** (`everyone: true/false`): If set, immediately returns this value, ignoring all other rules
2. **User List** (`users: [...]`): If the user ID is in this list, returns `true`
3. **Group Membership** (`groups: [...]`): If the user belongs to any specified group, returns `true`
4. **Role Membership** (`roles: [...]`): If the user has any specified role, returns `true`
5. **Percentage Rollout** (`percent: 0-99.9`): Uses consistent hashing to deterministically bucket users
6. **Default**: Returns `false` if no conditions are met

### Example Evaluation

```typescript
// Flag configured with multiple rules
await featureFlags.create({
  name: "new_feature",
  roles: ["admin"],
  groups: ["beta_testers"],
  percent: 25,
});

// Admin user: ✓ enabled (matches role)
await featureFlags.isActiveForUser({
  name: "new_feature",
  user: "user_123",
  roles: ["admin"],
});

// Beta tester: ✓ enabled (matches group)
await featureFlags.isActiveForUser({
  name: "new_feature",
  user: "user_456",
  groups: ["beta_testers"],
});

// Regular user: ? maybe (depends on hash bucket)
await featureFlags.isActiveForUser({
  name: "new_feature",
  user: "user_789",
  roles: ["user"],
});
```

## Performance Considerations

⚠️ **Important**: Flapjack queries the database on every `isActiveForUser()` call. For high-traffic applications, consider:

### Recommended Caching Strategy

```typescript
import { Pool } from "pg";
import { FeatureFlagModel } from "@brandtg/flapjack";

// Simple in-memory cache with TTL
class CachedFeatureFlags {
  private model: FeatureFlagModel;
  private cache = new Map<string, { flag: any; expires: number }>();
  private ttlMs = 60000; // 1 minute

  constructor(pool: Pool) {
    this.model = new FeatureFlagModel(pool);
  }

  async isActiveForUser(params: {
    name: string;
    user?: string;
    roles?: string[];
    groups?: string[];
  }): Promise<boolean> {
    const now = Date.now();
    const cached = this.cache.get(params.name);

    // Use cached flag if still valid
    if (cached && cached.expires > now) {
      // Re-evaluate with cached flag data
      return this.evaluateLocally(cached.flag, params);
    }

    // Cache miss or expired - fetch from DB
    return await this.model.isActiveForUser(params);
  }

  private evaluateLocally(flag: any, params: any): boolean {
    // Implement evaluation logic locally to avoid DB queries
    // See model.ts isActiveForUser() for reference
    // ...
  }
}
```

### Database Connection Pooling

Always use connection pooling in production:

```typescript
import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20, // Maximum pool size
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

const featureFlags = new FeatureFlagModel(pool);
```

### Performance Tips

- **Cache flag configurations** at the application level with a reasonable TTL (30-60 seconds)
- **Batch flag checks** when possible to reduce round trips
- **Use database indexes**: The default migration includes an index on `name` field
- **Monitor query performance**: Feature flag checks should be <10ms in most cases
- **Consider read replicas** for extremely high-traffic scenarios

## Experimentation and A/B Testing

Flapjack's percentage rollout feature enables experimentation and A/B testing:

```typescript
// Create an experiment: 50% of users see the new feature
await featureFlags.create({
  name: "checkout_redesign_experiment",
  percent: 50,
  note: "A/B test: new checkout flow vs. old",
});

// Users are consistently bucketed - same result every time
const isInExperiment = await featureFlags.isActiveForUser({
  name: "checkout_redesign_experiment",
  user: "user_123",
});

// Gradual rollout: Start at 5%, increase to 100% over time
await featureFlags.update(flagId, { percent: 5 });
// ... monitor metrics ...
await featureFlags.update(flagId, { percent: 25 });
// ... monitor metrics ...
await featureFlags.update(flagId, { percent: 100 });
```

### How User Bucketing Works

- Uses **MurmurHash3** for consistent, deterministic hashing
- Same user ID always maps to the same bucket (0-99)
- Changing the user ID will change bucket assignment
- Distribution is uniform across the user base

## API Reference

### FeatureFlagModel

#### `create(input: CreateInput): Promise<FeatureFlag>`

Creates a new feature flag.

#### `getById(id: number): Promise<FeatureFlag | null>`

Retrieves a feature flag by its ID.

#### `getByName(name: string): Promise<FeatureFlag | null>`

Retrieves a feature flag by its name.

#### `list(): Promise<FeatureFlag[]>`

Lists all feature flags, ordered by ID.

#### `update(id: number, changes: UpdateChanges): Promise<FeatureFlag | null>`

Updates a feature flag. Returns the updated flag or null if not found.

#### `delete(id: number): Promise<boolean>`

Deletes a feature flag. Returns true if deleted, false if not found.

#### `isActiveForUser(params): Promise<boolean>`

Checks if a feature flag is active for a user based on the evaluation rules.

#### `hashUserId(userId: string): Promise<number>`

Returns the hash value used for percentage bucketing. Useful for debugging rollout distributions.

## CLI Usage

Flapjack includes a CLI for managing feature flags:

```bash
# Set your database URL
export DATABASE_URL="postgresql://user:pass@localhost/dbname"

# Create a flag
flapjack create --name my_feature --roles admin --note "Admin-only feature"

# List all flags
flapjack list

# Get a specific flag
flapjack get-by-name my_feature

# Check if active for a user
flapjack is-active my_feature --user user123 --roles admin

# Update a flag
flapjack update 1 --percent 50 --everyone false

# Clear specific fields
flapjack update 1 --clear-roles --clear-percent

# Delete a flag
flapjack delete 1

# Debug user bucketing
flapjack hash-user user123
```

## Best Practices

### Naming Conventions

Use descriptive names that include context:

```typescript
// Good: Includes feature, date, and owner
"enable_new_checkout_20250101_gbrandt";
"experiment_ai_suggestions_20250115_team_growth";

// Avoid: Too generic
"new_feature";
"test_flag";
```

### Gradual Rollouts

Always roll out features gradually:

1. Start with internal users/roles (e.g., `roles: ["admin", "staff"]`)
2. Expand to beta testers (e.g., `groups: ["beta_testers"]`)
3. Percentage rollout (5% → 25% → 50% → 100%)
4. Enable for everyone (e.g., `everyone: true`)
5. After stable, remove the flag from code and database

### Flag Lifecycle Management

```typescript
// 1. Development: Admin only
await featureFlags.create({
  name: "new_feature_20250101",
  roles: ["admin"],
  note: "New feature in development",
});

// 2. Beta Testing
await featureFlags.update(flagId, {
  groups: ["beta_testers"],
});

// 3. Gradual Rollout
await featureFlags.update(flagId, { percent: 10 });
// Monitor, then increase...

// 4. Full Launch
await featureFlags.update(flagId, { everyone: true });

// 5. Cleanup (after feature is stable)
// Remove feature flag checks from code
await featureFlags.delete(flagId);
```

### Error Handling

```typescript
try {
  const isActive = await featureFlags.isActiveForUser({
    name: "my_feature",
    user: "user_123",
  });

  if (isActive) {
    // Show new feature
  } else {
    // Show old feature
  }
} catch (error) {
  // On error, fail closed (disable feature) or open (enable feature)
  // depending on your risk tolerance
  console.error("Feature flag check failed:", error);
  const isActive = false; // Fail closed - safer default
}
```

## Troubleshooting

### Database Connection Issues

```typescript
// Verify connection before using feature flags
import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

try {
  await pool.query("SELECT 1");
  console.log("Database connection successful");
} catch (error) {
  console.error("Database connection failed:", error);
}
```

### Flag Not Found

If `isActiveForUser()` returns false unexpectedly:

1. Verify the flag exists: `flapjack get-by-name your_flag_name`
2. Check the evaluation rules with `flapjack is-active`
3. Verify user/role/group matching is case-sensitive

### Percentage Rollout Not Working

Debug user bucketing:

```bash
# Check which bucket a user falls into
flapjack hash-user user_123
# Output: { userId: "user_123", hash: 1234567, bucket: 67 }

# If bucket is 67 and percent is 50, user is NOT in rollout
# If bucket is 67 and percent is 75, user IS in rollout
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

### Running Tests

```bash
npm test
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
   npm publish --public
   ```

   For a dry run to see what would be published:

   ```bash
   npm publish --public --dry-run
   ```

3. **Publishing a beta version**:
   ```bash
   npm publish --tag beta
   ```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the BSD 3-Clause License - see the [LICENSE](LICENSE) file for details.

This project is inspired by [django-waffle](https://github.com/django-waffle/django-waffle).
