# SQLite Support Design Document

## Overview

This document outlines the design and implementation plan for extending Flapjack to support SQLite alongside the existing PostgreSQL support. The goal is to maintain the same user-facing API while providing a database-agnostic backend that can work with either PostgreSQL or SQLite.

## Background

Currently, Flapjack is tightly coupled to PostgreSQL with:
- PostgreSQL-specific data types (arrays, timestamptz, numeric)
- PostgreSQL-specific SQL syntax and functions
- node-pg-migrate for schema management
- pg library for database connections

## Goals

1. **API Compatibility**: Maintain the existing `FeatureFlagModel` interface
2. **Database Abstraction**: Support both PostgreSQL and SQLite backends
3. **Type Safety**: Preserve TypeScript type safety across both databases
4. **Migration Strategy**: Provide clear migration paths for existing users
5. **Performance**: Ensure SQLite performance is competitive for typical use cases

## Architecture Changes

### 1. Database Abstraction Layer

Create an abstract database interface that both PostgreSQL and SQLite implementations will follow:

```typescript
interface DatabaseAdapter {
  query(sql: string, params?: any[]): Promise<QueryResult>;
  close(): Promise<void>;
}

interface QueryResult {
  rows: any[];
  rowCount?: number;
}
```

### 2. Model Refactoring

Refactor `FeatureFlagModel` to accept a `DatabaseAdapter` instead of directly using the `pg` `Queryable` interface:

```typescript
export class FeatureFlagModel {
  private db: DatabaseAdapter;
  
  constructor(db: DatabaseAdapter) {
    this.db = db;
  }
  // ... rest of implementation
}
```

### 3. Database-Specific Adapters

#### PostgreSQL Adapter
```typescript
export class PostgreSQLAdapter implements DatabaseAdapter {
  constructor(private client: Pool | Client) {}
  
  async query(sql: string, params?: any[]): Promise<QueryResult> {
    const result = await this.client.query(sql, params);
    return {
      rows: result.rows,
      rowCount: result.rowCount || 0
    };
  }
}
```

#### SQLite Adapter
```typescript
export class SQLiteAdapter implements DatabaseAdapter {
  constructor(private db: Database) {} // better-sqlite3 or similar
  
  async query(sql: string, params?: any[]): Promise<QueryResult> {
    // Implementation details for SQLite
  }
}
```

## Schema Differences and Adaptations

### Data Type Mapping

| PostgreSQL Type | SQLite Equivalent | Notes |
|----------------|-------------------|--------|
| `SERIAL` | `INTEGER PRIMARY KEY AUTOINCREMENT` | Auto-incrementing ID |
| `TEXT` | `TEXT` | Direct mapping |
| `BOOLEAN` | `INTEGER` | 0/1 values, adapter handles conversion |
| `NUMERIC(3,1)` | `REAL` | Floating-point numbers |
| `TEXT[]` | `TEXT` | JSON-encoded arrays |
| `TIMESTAMPTZ` | `TEXT` | ISO 8601 strings, adapter handles Date conversion |

### SQLite Schema

```sql
CREATE TABLE flapjack_feature_flag (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  everyone INTEGER, -- 0, 1, or NULL
  percent REAL CHECK (percent >= 0 AND percent <= 99.9),
  roles TEXT DEFAULT '[]', -- JSON array as TEXT
  groups TEXT DEFAULT '[]', -- JSON array as TEXT  
  users TEXT DEFAULT '[]', -- JSON array as TEXT
  note TEXT,
  created TEXT NOT NULL DEFAULT (datetime('now')), -- ISO 8601
  modified TEXT NOT NULL DEFAULT (datetime('now')) -- ISO 8601
);

-- Trigger to update modified timestamp
CREATE TRIGGER flapjack_feature_flag_set_modified
AFTER UPDATE ON flapjack_feature_flag
FOR EACH ROW
BEGIN
  UPDATE flapjack_feature_flag 
  SET modified = datetime('now') 
  WHERE id = NEW.id;
END;
```

### Data Transformation Layer

The adapter will handle transformations between SQLite's simpler type system and the expected JavaScript types:

```typescript
class SQLiteAdapter {
  private transformRow(row: any): any {
    return {
      ...row,
      everyone: row.everyone === null ? null : Boolean(row.everyone),
      roles: row.roles ? JSON.parse(row.roles) : [],
      groups: row.groups ? JSON.parse(row.groups) : [],
      users: row.users ? JSON.parse(row.users) : [],
      created: new Date(row.created),
      modified: new Date(row.modified)
    };
  }

  private transformInput(input: any): any {
    return {
      ...input,
      everyone: input.everyone === null ? null : (input.everyone ? 1 : 0),
      roles: input.roles ? JSON.stringify(input.roles) : '[]',
      groups: input.groups ? JSON.stringify(input.groups) : '[]',
      users: input.users ? JSON.stringify(input.users) : '[]'
    };
  }
}
```

## Migration Strategy

### For New Users

Users will choose their database adapter at initialization:

```typescript
// PostgreSQL (existing)
import { Pool } from 'pg';
import { FeatureFlagModel, PostgreSQLAdapter } from '@brandtg/flapjack';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PostgreSQLAdapter(pool);
const model = new FeatureFlagModel(adapter);

// SQLite (new)
import Database from 'better-sqlite3';
import { FeatureFlagModel, SQLiteAdapter } from '@brandtg/flapjack';

const db = new Database('feature-flags.db');
const adapter = new SQLiteAdapter(db);
const model = new FeatureFlagModel(adapter);
```

### For Existing Users

Existing PostgreSQL users will need minimal changes:

```typescript
// Before
const model = new FeatureFlagModel(pool);

// After  
const adapter = new PostgreSQLAdapter(pool);
const model = new FeatureFlagModel(adapter);
```

We can provide a compatibility layer during a transition period:

```typescript
export class FeatureFlagModel {
  constructor(db: DatabaseAdapter | Pool | Client) {
    if (db instanceof DatabaseAdapter) {
      this.db = db;
    } else {
      // Legacy support - auto-wrap in PostgreSQLAdapter
      this.db = new PostgreSQLAdapter(db);
    }
  }
}
```

## Schema Management

### Current Approach (PostgreSQL)
- Uses `node-pg-migrate` with JavaScript migration files
- Provides `runMigrations()` function for automated setup

### SQLite Approach
Users will need to manually apply the SQLite schema since SQLite doesn't have the same migration ecosystem as PostgreSQL. We'll provide:

1. **Raw SQL schema file**: `migrations/sqlite/schema.sql`
2. **Helper function for SQLite setup**:

```typescript
export async function setupSQLiteSchema(db: Database): Promise<void> {
  const schema = readFileSync(path.join(__dirname, '../migrations/sqlite/schema.sql'), 'utf8');
  db.exec(schema);
}
```

3. **Documentation with examples** for common SQLite integration patterns

### Migration Files Structure
```
migrations/
├── postgresql/           # Existing node-pg-migrate files
│   └── 1759720355601_create-feature-flag.js
└── sqlite/
    ├── schema.sql       # Complete SQLite schema
    └── README.md        # Integration instructions
```

## Dependencies

### New Dependencies
- `better-sqlite3` (peer dependency): Fast, synchronous SQLite3 bindings
- Alternative: `sqlite3` (asynchronous, more widely used but slower)

### Dependency Strategy
- Make SQLite library a **peer dependency** to avoid bloating installations for PostgreSQL-only users
- Support multiple SQLite libraries through adapter pattern

## Implementation Plan

### Phase 1: Core Abstraction
1. Create `DatabaseAdapter` interface
2. Implement `PostgreSQLAdapter` 
3. Refactor `FeatureFlagModel` to use adapter pattern
4. Add backwards compatibility layer
5. Update tests to work with both adapters

### Phase 2: SQLite Support
1. Implement `SQLiteAdapter` with `better-sqlite3`
2. Create SQLite schema files
3. Add data transformation logic for type differences
4. Implement SQLite-specific optimizations

### Phase 3: Documentation and Examples
1. Update README with SQLite usage examples
2. Add migration guide for existing users
3. Create example projects for both databases
4. Add troubleshooting guides

### Phase 4: Advanced Features
1. Support for multiple SQLite libraries
2. Performance benchmarking and optimization
3. Connection pooling for SQLite (if needed)
4. Schema validation utilities

## Testing Strategy

### Unit Tests
- Test both adapters with the same test suite
- Mock database responses to test transformation logic
- Verify type safety across both implementations

### Integration Tests  
- Run full test suite against both PostgreSQL and SQLite
- Test data consistency between database types
- Performance benchmarking for common operations

### Test Database Setup
```typescript
// Test helper to run same tests against both DBs
describe.each([
  ['PostgreSQL', () => setupPostgreSQLTest()],
  ['SQLite', () => setupSQLiteTest()]
])('%s adapter', (dbName, setupFn) => {
  let model: FeatureFlagModel;
  
  beforeEach(async () => {
    model = await setupFn();
  });
  
  // Shared test cases...
});
```

## Performance Considerations

### SQLite Optimizations
- Use prepared statements for repeated queries
- Enable WAL mode for better concurrency: `PRAGMA journal_mode=WAL`
- Optimize JSON operations for array fields
- Consider indexing strategies for common query patterns

### Memory Usage
- SQLite keeps entire database in memory by default
- For large datasets, consider file-based SQLite databases
- Provide guidance on when to choose PostgreSQL vs SQLite

## Backwards Compatibility

### API Compatibility
- All existing `FeatureFlagModel` methods work identically
- Same return types and error handling
- Existing cache and CLI functionality unchanged

### Migration Path
1. **v1.x**: Current PostgreSQL-only version
2. **v2.0**: Introduce adapter pattern with backwards compatibility
3. **v2.1**: Add SQLite support
4. **v3.0**: Remove legacy constructor (breaking change)

## Documentation Updates

### New Sections Required
1. "Choosing a Database" comparison guide
2. SQLite setup and integration examples  
3. Migration guide from PostgreSQL to SQLite
4. Performance characteristics of each database
5. Troubleshooting common SQLite issues

### API Documentation
- Document database-specific considerations
- Add examples for both database types
- Update TypeScript definitions for new adapters

## Risks and Mitigation

### Risk: Type System Complexity
**Mitigation**: Comprehensive unit tests for data transformation, strict TypeScript interfaces

### Risk: Performance Differences  
**Mitigation**: Benchmark both implementations, provide clear guidance on database choice

### Risk: Feature Parity
**Mitigation**: Shared test suite ensures identical behavior, document any limitations

### Risk: Maintenance Overhead
**Mitigation**: Abstract common functionality, automated testing for both databases

## Future Considerations

### Additional Database Support
The adapter pattern makes it straightforward to add support for other databases:
- MySQL/MariaDB
- Microsoft SQL Server  
- Cloud databases (PlanetScale, Neon, etc.)

### Advanced SQLite Features
- Full-text search capabilities
- Custom SQLite extensions
- Multi-database transactions
- Backup and restore utilities

## Success Criteria

1. **Functional**: All existing PostgreSQL functionality works with SQLite
2. **Performance**: SQLite performance within 20% of PostgreSQL for typical workloads
3. **Usability**: Clear documentation and examples for SQLite setup
4. **Compatibility**: Existing users can upgrade without code changes
5. **Maintainability**: Shared test suite passes for both database backends