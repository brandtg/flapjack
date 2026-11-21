# Flapjack

[![CI](https://github.com/brandtg/flapjack/actions/workflows/ci.yml/badge.svg)](https://github.com/brandtg/flapjack/actions/workflows/ci.yml)
[![npm version](https://badge.fury.io/js/@brandtg%2Fflapjack.svg)](https://www.npmjs.com/package/@brandtg/flapjack)
[![License](https://img.shields.io/badge/License-BSD_3--Clause-blue.svg)](https://opensource.org/licenses/BSD-3-Clause)

A simple feature flags library with PostgreSQL integration, inspired by [django-waffle](https://github.com/django-waffle/django-waffle).

## Features

- **Multiple targeting strategies**: Enable features for specific users, roles, groups, or percentage rollouts
- **External subject targeting**: Assign flags (or flag groups) to external subjects like tenants or org IDs
- **Consistent hashing**: Deterministic user bucketing for A/B testing and experimentation
- **PostgreSQL-backed**: Reliable, transactional flag storage with your existing database
- **CLI included**: Manage feature flags from the command line
- **TypeScript-first**: Full type safety with comprehensive TypeScript definitions
- **Battle-tested**: Comprehensive test suite with 218 tests
- **Time-limited flags**: Expiration dates with an `onExpired` event handler (grace period / metrics)

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
  // Optional: time-limit the flag (ISO date; evaluated must pass to stay active)
  // expires: new Date("2026-12-31T00:00:00Z"),
});

// Check if a feature flag is active for a user
const active = await featureFlag.isActiveForUser({
  name: "enable_new_checkout_20250101_gbrandt",
  user: "1234",
});

// Assign a flag to an external subject ID (for example, a tenant)
await featureFlags.addSubject(flag.id, "tenant:acme");

// Check if active for a broader context that includes external subject IDs
const activeForTenant = await featureFlags.isActiveForContext({
  name: "enable_new_checkout_20250101_gbrandt",
  user: "1234",
  subjects: ["tenant:acme"],
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
3. **External Subject Match** (`subjects: [...]`): If any provided subject matches a direct flag subject or a flag-group subject, returns `true`
4. **Group Membership** (`groups: [...]`): If the user belongs to any specified group, returns `true`
5. **Role Membership** (`roles: [...]`): If the user has any specified role, returns `true`
6. **Percentage Rollout** (`percent: 0-99.9`): Uses consistent hashing to deterministically bucket users (integer buckets 0-99; 99.9 passes every bucket — for an explicit 100% rollout use `everyone: true`)
7. **Default**: Returns `false` if no conditions are met

## External Subject Targeting

Use subjects when identity/group membership is managed outside Flapjack (for example, tenant IDs from another system).

```typescript
const groupModel = new FeatureFlagGroupModel(pool);
const flagModel = new FeatureFlagModel(pool);

const rolloutGroup = await groupModel.create({
  name: "checkout_rollout",
});

const checkoutFlag = await flagModel.create({
  name: "enable_checkout_v2",
});

await groupModel.addFeatureFlag(rolloutGroup.id, checkoutFlag.id);

// Attach external subject to all flags in this feature flag group
await groupModel.addSubject(rolloutGroup.id, "tenant:acme");

// You can also attach a subject directly to a single flag
await flagModel.addSubject(checkoutFlag.id, "tenant:beta");

const isActive = await flagModel.isActiveForContext({
  name: "enable_checkout_v2",
  user: "user_123",
  subjects: ["tenant:acme"],
});
```

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

## Expiration and `onExpired` Handlers

A flag can carry an `expires` date. When an expired flag is evaluated, the flag is treated as **inactive** — this is the strict default, even if no `onExpired` handler is set.

You can attach an `onExpired` event handler to the model (or cached wrapper). The handler is fired whenever an expired flag is evaluated; if it returns a boolean, that value is used as the result (e.g. a grace period after expiry). If it returns `undefined` (or no handler is set), the flag evaluates as inactive.

```typescript
import { FeatureFlagModel } from "@brandtg/flapjack";

const flagModel = new FeatureFlagModel(pool, {
  onExpired: async ({ flag }) => {
    // e.g. emit a usage metric / alert that an expired flag is still in use
    await metrics.record("flag.expired_used", { flag: flag.name });
    // return true to keep the flag active for a short grace period after expiry
    return flag.expires && flag.expires > new Date(Date.now() - 24 * 60 * 60 * 1000);
  },
});

// Create a flag that expires in 7 days
await flagModel.create({
  name: "temporary_experiment",
  expires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
});

// Update an existing flag to expire in 24 hours
await flagModel.update(flagId, { expires: new Date(Date.now() + 24 * 60 * 60 * 1000) });
```

The CLI also supports `--expires` (ISO 8601) on `create` and `update`, and `--clear-expires` on `update` to remove the expiration date:

```bash
flapjack create --name temporary_experiment --expires 2026-12-01T00:00:00Z
flapjack update 1 --expires 2026-12-01T00:00:00Z
flapjack update 1 --clear-expires
```

In the cached path, the wrapper stores the flag's expiry alongside its cached boolean and re-fires `onExpired` on every evaluation of a flag whose stored expiry has passed — so side effects keep firing even for cached results.

## Organizing Flags with Tags

Tags are freeform labels for organizing flags without encoding that information in
the flag name. They do **not** affect evaluation — they are purely organizational
metadata. A common use is associating a release version with a flag, which can then
be bumped via a database update without any code change.

```typescript
// Tag a flag with a release version (and any other labels)
await featureFlags.create({
  name: "checkout_v2",
  tags: ["release:1.5.0", "checkout"],
});

// Find every flag shipping in a given release
const flags = await featureFlags.listByTag("release:1.5.0");

// Bump the release version later — no code change required
await featureFlags.update(flag.id, { tags: ["release:1.6.0", "checkout"] });
```

The equivalent CLI commands:

```bash
flapjack create --name checkout_v2 --tags release:1.5.0 checkout
flapjack list-by-tag release:1.5.0
flapjack update <id> --tags release:1.6.0 checkout
flapjack update <id> --clear-tags
```

## Performance Considerations

⚠️ **Important**: Without caching, Flapjack queries the database on every `isActiveForUser()` call. For high-traffic applications, use the built-in caching layer:

### Built-in Caching Layer

Flapjack includes a high-performance caching layer with TTL support. The built-in `InMemoryCache` is additionally bounded: at most `maxSize` entries (default `10_000`, via `new InMemoryCache({ maxSize })`) are held before the least-recently-used entries are evicted (with expired entries dropped first). A long-running process can therefore hold at most that many entries, and you can raise or lower the bound to match your workload.

```typescript
import { Pool } from "pg";
import {
  FeatureFlagModel,
  FeatureFlagCache,
  InMemoryCache,
  type CachedFlagResult,
} from "@brandtg/flapjack";

// Set up the database model
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Create cached feature flags instance
const featureFlags = new FeatureFlagCache({
  model: new FeatureFlagModel(pool),
  cache: new InMemoryCache<CachedFlagResult>({ maxSize: 10_000 }), // result + expiry; 10k-entry LRU bound
  ttl: 300, // Set TTL to 5 minutes (300 seconds)
});

// Use exactly the same as the model, but with automatic caching
const isActive = await featureFlags.isActiveForUser({
  name: "new_feature",
  user: "user_123",
  roles: ["admin"],
  groups: ["beta_testers"],
});
```

### Cache Key Generation

The cache automatically generates deterministic keys using MurmurHash3 of the flag name and user parameters:

```typescript
// These calls generate the same cache key:
await featureFlags.isActiveForUser({
  name: "test",
  roles: ["admin", "user"],
  groups: ["beta", "alpha"],
});

await featureFlags.isActiveForUser({
  name: "test",
  roles: ["user", "admin"], // Different order
  groups: ["alpha", "beta"], // Different order
});
```

### Custom Cache Implementation

You can implement your own cache (Redis, Memcached, etc.) by implementing the `Cache` interface:

```typescript
import type { Cache, CachedFlagResult } from "@brandtg/flapjack";

class RedisCache implements Cache<CachedFlagResult> {
  private redis: RedisClient;

  constructor(redis: RedisClient) {
    this.redis = redis;
  }

  get(key: string): Promise<CachedFlagResult | undefined> {
    const value = this.redis.get(key);
    return value ? JSON.parse(value) : undefined;
  }

  set(key: string, value: CachedFlagResult, ttl?: number): Promise<void> {
    const serialized = JSON.stringify(value);
    if (ttl) {
      this.redis.setex(key, ttl, serialized);
    } else {
      this.redis.set(key, serialized);
    }
  }

  delete(key: string): Promise<void> {
    this.redis.del(key);
  }
}

// Use your custom cache
const featureFlags = new FeatureFlagCache({
  model,
  cache: new RedisCache(redisClient),
  ttl: 300,
});
```

> **Note on cache entries:** a cached entry stores the boolean result **and** the flag's expiry (epoch milliseconds) — not the whole flag. On a cache hit, if the stored expiry says the flag may be expired, the cache layer fetches the flag fresh and fires `onExpired` with it — so side effects like usage metrics keep firing for expired flags without a database round trip on the non-expired path. A flag modified within the TTL keeps serving its cached result until the TTL expires.

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

// Gradual rollout: start at 5%, increase over time
await featureFlags.update(flagId, { percent: 5 });
// ... monitor metrics ...
await featureFlags.update(flagId, { percent: 25 });
// ... monitor metrics ...
await featureFlags.update(flagId, { percent: 50 });
// ... monitor metrics ...
// Reach the end of the percentage path: for a true 100% rollout use everyone: true
// (percent: 100 is rejected by the database constraint — 99.9 is the effective max)
await featureFlags.update(flagId, { everyone: true });
```

### How User Bucketing Works

- Uses **MurmurHash3** for consistent, deterministic hashing
- Same user ID always maps to the same bucket (integer buckets 0-99, `hash % 100`)
- Changing the user ID will change bucket assignment
- Distribution is uniform across the user base
- A `percent` of 99.9 passes every bucket; for an explicit 100% rollout, use `everyone: true` (`percent: 100` is rejected by the database constraint)

## API Reference

### FeatureFlagModel

#### `create(input: CreateInput): Promise<FeatureFlag>`

Creates a new feature flag.

#### `getById(id: number, options?: { includeArchived?: boolean }): Promise<FeatureFlag | null>`

Retrieves a feature flag by its ID. Archived flags are excluded unless `includeArchived` is `true`.

#### `getByName(name: string, options?: { includeArchived?: boolean }): Promise<FeatureFlag | null>`

Retrieves a feature flag by its name. Archived flags are excluded unless `includeArchived` is `true`.

#### `list(options?: { includeArchived?: boolean }): Promise<FeatureFlag[]>`

Lists all feature flags, ordered by ID. Archived flags are excluded unless `includeArchived` is `true`.

#### `listByTag(tag: string, options?: { includeArchived?: boolean }): Promise<FeatureFlag[]>`

Lists all feature flags carrying the given tag (exact match), ordered by ID. Archived flags are excluded unless `includeArchived` is `true`.

#### `update(id: number, changes: UpdateChanges): Promise<FeatureFlag | null>`

Updates a feature flag. Returns the updated flag or null if not found.

#### `delete(id: number): Promise<boolean>`

Permanently deletes a feature flag and all its relationships. Returns true if deleted, false if not found. To hide a flag while keeping its history, use `archive` instead.

#### `archive(id: number): Promise<FeatureFlag | null>`

Archives (hides) a feature flag while keeping the row for historical/audit purposes. Archived flags are excluded from normal reads and evaluate as inactive, but remain retrievable via `{ includeArchived: true }`. Returns the archived flag, or null if it does not exist or is already archived.

Archiving is **irreversible** (there is no `unarchive`) and the `archived` timestamp is immutable once set. The flag's name stays reserved permanently — a new flag cannot reuse it; create a new flag with a different name instead. The same `archive(id)` / `includeArchived` semantics apply to `FeatureFlagGroupModel`.

#### `FeatureFlagModel(db, eventHandlers?)` — event handlers

Construct with an optional `FeatureFlagEventHandlers` object. The `onExpired` handler is called whenever an expired flag is evaluated; see [Expiration and `onExpired` Handlers](#expiration-and-onexpired-handlers).

`FeatureFlagEventHandlers` has one handler:

- `onExpired?: ExpiredFeatureFlagEventHandler` — `({ flag }: { flag: FeatureFlag }) => Promise<boolean | undefined>`. Called for any expired flag. Return `true`/`false` to force the result (grace period / hard stop); return `undefined` to treat the flag as inactive. Exported from the package root as `ExpiredFeatureFlagEventHandler` (type-only).

```typescript
import { FeatureFlagModel } from "@brandtg/flapjack";
import type { FeatureFlagEventHandlers } from "@brandtg/flapjack";

const model = new FeatureFlagModel(pool, {
  onExpired: async ({ flag }) => { /* return true/false/undefined */ },
});
```

#### `isActiveForContext(params): Promise<boolean>`

Checks if a feature flag is active for a context (user + external subjects). Accepts `user`, `roles`, `groups` and `subjects` (external subject IDs — direct flag or flag-group match).

#### `areActiveForUser(params): Promise<Record<string, boolean>>`

Checks multiple flags (or all of them if `names` is omitted) for a user. Accepts `user`, `roles`, `groups` and `subjects`.

#### `areActiveForContext(params): Promise<Record<string, boolean>>`

Checks multiple flags (or all of them if `names` is omitted) for a context. Accepts `user`, `roles`, `groups` and `subjects`.

#### `getManyByName(names: string[], options?): Promise<FeatureFlag[]>`

Retrieves multiple feature flags by name (may be shorter than the input if some names don't exist).

#### `getMany(ids: number[], options?): Promise<FeatureFlag[]>`

Retrieves multiple feature flags by ID (may be shorter than the input if some IDs don't exist).

#### `getFeatureFlagsForSubject(subject: string, options?): Promise<FeatureFlag[]>`

Gets all feature flags directly associated with an external subject identifier.

#### `getSubjects(id: number): Promise<string[]>`

Returns all external subject identifiers attached to a feature flag.

#### `getLastModified(): Promise<number>`

Returns the latest `modified` timestamp across all feature flags, in milliseconds since epoch. Returns -1 if the table is empty.

#### `updateAll(groupId: number, changes): Promise<number>`

Updates all feature flags in a group with the same changes (only `everyone`, `percent`, `roles`, `groups`, `users` are allowed). Returns the number of flags updated.

#### `getGroupsForSubject(subject: string, options?): Promise<FeatureFlagGroup[]>`

Returns all feature flag groups directly associated with an external subject identifier.

#### `isActiveForUser(params): Promise<boolean>`

Checks if a feature flag is active for a user based on the evaluation rules. Accepts the same `subjects` parameter as `isActiveForContext` (external subjects) and forwards it.

#### `hashUserId(userId: string): number` (pure helper) / `FeatureFlagModel.hashUserId(userId: string): Promise<number>`

Pure, database-free helper that returns the hash value used for percentage bucketing. Exported from the package root (`import { hashUserId } from "@brandtg/flapjack"`); `FeatureFlagModel.hashUserId` is a thin async wrapper kept for existing callers. Useful for debugging rollout distributions.

## CLI Usage

Flapjack includes a CLI for managing feature flags:

```bash
# Set your database URL
export DATABASE_URL="postgresql://user:pass@localhost/dbname"

# Create a flag
flapjack create --name my_feature --roles admin --note "Admin-only feature"

# Create a flag with an expiration date
flapjack create --name temporary --expires 2026-12-01T00:00:00Z

# List all flags
flapjack list

# Include archived (hidden) flags in any read command
flapjack list --include-archived
flapjack get-by-name my_feature --include-archived

# List flags carrying a tag (e.g. a release version)
flapjack list-by-tag release:1.5.0

# Get a specific flag
flapjack get-by-name my_feature

# Check if active for a user
flapjack is-active my_feature --user user123 --roles admin

# Check if multiple flags are active for a user
flapjack are-active --names my_feature other_feature --user user123 --roles admin

# Pass external subjects to the User commands (same as is-active-context/are-active-context)
flapjack is-active my_feature --subjects tenant:acme
flapjack are-active --names my_feature other_feature --subjects tenant:acme

# Check if active for context (with external subject IDs)
flapjack is-active-context my_feature --user user123 --subjects tenant:acme

# Check multiple flags for context
flapjack are-active-context --names my_feature other_feature --subjects tenant:acme

# Update a flag
flapjack update 1 --percent 50 --everyone false

# Clear specific fields
flapjack update 1 --clear-roles --clear-percent

# Set / clear an expiration date
flapjack update 1 --expires 2026-12-01T00:00:00Z
flapjack update 1 --clear-expires

# Delete a flag (permanent — destroys all metadata)
flapjack delete 1

# Archive a flag (hide it but keep its history; irreversible)
flapjack archive 1

# Add/remove/list subject mappings on a flag
flapjack add-subject 1 tenant:acme
flapjack remove-subject 1 tenant:acme
flapjack list-subjects 1
flapjack list-by-subject tenant:acme

# Feature flag groups
flapjack group-create --name checkout_rollout --note "Checkout launch cohort"
flapjack group-list
flapjack group-get 1
flapjack group-get-by-name checkout_rollout
flapjack group-update 1 --note "Updated"
flapjack group-delete 1
flapjack group-archive 1

# Group membership
flapjack group-add-flag 1 10
flapjack group-remove-flag 1 10
flapjack group-list-flags 1
flapjack group-list-for-flag 10

# Bulk update all flags in a group
flapjack group-update-all 1 --percent 25 --roles admin

# Group-level subject mappings
flapjack group-add-subject 1 tenant:acme
flapjack group-remove-subject 1 tenant:acme
flapjack group-list-subjects 1
flapjack group-list-by-subject tenant:acme

# Debug user bucketing (pure — works without a database)
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
3. Percentage rollout (5% → 25% → 50% → 99.9%)
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
// Remove feature flag checks from code, then either:
//   - delete to remove it entirely, or
//   - archive to hide it while keeping its history for audit
await featureFlags.archive(flagId);
// (archive is irreversible and the name stays reserved permanently)
```

### Expiration and Grace Periods

Flags can carry an `expires` date. Expired flags evaluate as **inactive** by default. Attach an `onExpired` handler to the model to (a) emit metrics/alerts when an expired flag is still in use and (b) opt into a grace period by returning a boolean from the handler:

```typescript
const flagModel = new FeatureFlagModel(pool, {
  onExpired: async ({ flag }) => {
    // fire metrics/alert; return true for a short grace period after expiry
    return flag.expires && flag.expires > new Date(Date.now() - 24 * 60 * 60 * 1000);
  },
});
```

Clear the expiration date with `model.update(id, { expires: null })` or `flapjack update 1 --clear-expires`.

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
2. Check the evaluation rules with `flapjack is-active` (evaluation order: everyone -> users -> subjects -> groups -> roles -> percent -> default)
3. Verify user/role/group matching is case-sensitive

### Percentage Rollout Not Working

Debug user bucketing:

```bash
# Check which bucket a user falls into (pure — works without a database)
flapjack hash-user user_123
# Output: { userId: "user_123", hash: 1234567, bucket: 67 }

# If bucket is 67 and percent is 50, user is NOT in rollout
# If bucket is 67 and percent is 75, user IS in rollout
```

## Development

### Setup

Install dependencies

```bash
npm install
```

Create an environment file (the script writes `DATABASE_URL=postgres://flapjack:flapjack@localhost:5477/flapjack_dev` to `.env` — or copy the committed `.env.example` yourself):

```bash
npm run dev:env
```

Start the PostgreSQL database. The dev stack publishes host port `5477` by default; override with `FLAPJACK_PORT` if 5477 is taken:

```bash
npm run dev:docker:up
# or: FLAPJACK_PORT=5540 npm run dev:docker:up
```

Run database migrations:

```bash
npm run dev:migrate
```

### Running Tests

```bash
npm run test
```

The test suite drops and recreates `flapjack_test` / `flapjack_cli_test` databases, so it never reads `DATABASE_URL`. It connects to the dev DB at `localhost:${FLAPJACK_TEST_PORT:-5477}` (the same port `docker-compose.yml` publishes). If you run the stack on a non-default port, set `FLAPJACK_TEST_PORT` accordingly — e.g. `FLAPJACK_TEST_PORT=5540 npm test`.

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

1. **Login to npm** (one-time setup):

   ```bash
   npm login
   ```

   This will prompt for your username, password, email, and 2FA code.

2. **Verify your login**:

   ```bash
   npm whoami
   ```

3. **Update the version** in `package.json`:

   ```bash
   # For a patch release (0.1.0 -> 0.1.1)
   npm version patch

   # For a minor release (0.1.0 -> 0.2.0)
   npm version minor

   # For a major release (0.1.0 -> 1.0.0)
   npm version major
   ```

   This automatically creates a git commit and tag.

4. **Run pre-publish checks** (linting, tests, and build):

   ```bash
   npm run prepublishOnly
   ```

5. **Publish to npm**:

   ```bash
   npm publish --access public
   ```

   You'll be prompted for your 2FA code. For a dry run to see what would be published:

   ```bash
   npm publish --access public --dry-run
   ```

6. **Push the version tag to GitHub**:

   ```bash
   git push && git push --tags
   ```

7. **Optional: Create a GitHub release** for the new version at https://github.com/brandtg/flapjack/releases/new

#### Publishing a Beta Version

For pre-release versions:

```bash
# Update to a pre-release version
npm version prerelease --preid=beta

# Publish with beta tag
npm publish --access public --tag beta
```

Users can install beta versions with:

```bash
npm install @brandtg/flapjack@beta
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the BSD 3-Clause License - see the [LICENSE](LICENSE) file for details.

This project is inspired by [django-waffle](https://github.com/django-waffle/django-waffle).
