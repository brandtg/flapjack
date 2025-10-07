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

### Publishing to NPM

Publishing is done manually to support 2FA authentication. See the main README.md for detailed publishing instructions including:

- Logging in with `npm login`
- Version management with `npm version`
- Publishing with `npm publish --access public`

### Prettier Failures

If formatting fails, run locally to fix:

```bash
npx prettier --write .
```

Then commit the formatting changes.
