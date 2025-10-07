# GitHub Actions Workflows

This directory contains automated workflows for Flapjack CI/CD.

## Workflows

### `ci.yml` - Continuous Integration

Runs on every pull request and push to main branch.

**Jobs:**

1. **Test & Lint** (Matrix: Node.js 18, 20, 22)
   - Spins up PostgreSQL 16 service container
   - Checks code formatting with Prettier
   - Runs ESLint for code quality
   - Performs TypeScript type checking
   - Builds the project
   - Runs all unit and integration tests
   - Runs smoke tests for CLI

2. **Package Validation**
   - Verifies no test files are included in the package
   - Verifies no source files are included in the package
   - Reports final package size

**Requirements:**

- PostgreSQL service container (automatically provisioned)
- No external secrets required

### `release.yml` - NPM Publishing

Runs automatically when a new GitHub release is published.

**Jobs:**

1. **Publish to NPM**
   - Runs all prepublishOnly checks (lint, test, build)
   - Publishes to NPM with provenance
   - Uses scoped package access (public)

**Requirements:**

- `NPM_TOKEN` secret must be configured in repository settings
  - Go to Settings → Secrets and variables → Actions
  - Create new repository secret named `NPM_TOKEN`
  - Value should be your NPM access token with publish permissions

**Usage:**

1. Update version in `package.json`
2. Create a new GitHub release with a tag (e.g., `v0.1.1`)
3. Workflow automatically publishes to NPM

### `dependabot.yml` - Dependency Updates

Automatically creates pull requests for dependency updates.

**Configuration:**

- **NPM dependencies**: Weekly updates on Mondays
  - Groups development dependencies (minor + patch updates)
  - Groups production dependencies (patch updates only)
  - Maximum 5 open PRs at once
- **GitHub Actions**: Weekly updates on Mondays

**Labels:**

- `dependencies` - All dependency updates
- `automated` - NPM dependency updates
- `github-actions` - GitHub Actions updates

## Local Testing

You can run the same checks locally before pushing:

```bash
# 1. Format check
npx prettier --check .

# 2. Linting
npm run lint

# 3. Type checking
npm run typecheck

# 4. Build
npm run build

# 5. Tests
npm test

# 6. Package validation
npm pack --dry-run
```

Or run all at once:

```bash
npm run prepublishOnly
```

## Troubleshooting

### CI Failing on PostgreSQL Connection

The CI uses a PostgreSQL service container with these credentials:

- User: `flapjack`
- Password: `flapjack`
- Database: `flapjack`
- Host: `localhost`
- Port: `5432`

If tests fail, check that `DATABASE_URL` environment variable is set correctly in the workflow.

### NPM Publish Failing

Common issues:

1. **Missing NPM_TOKEN**: Add token to repository secrets
2. **Version already exists**: Bump version in `package.json`
3. **Scope access**: Ensure you have access to `@brandtg` scope on NPM
4. **Two-factor auth**: Use an automation token, not a user token

### Prettier Failures

If formatting fails, run locally to fix:

```bash
npx prettier --write .
```

Then commit the formatting changes.
