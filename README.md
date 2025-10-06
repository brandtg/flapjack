# Flapjack

A simple feature flags library with PostgreSQL integration.

## WIP

```bash
# Create an environment file
cat <<EOF > .env
DATABASE_URL=postgres://flapjack:flapjack@localhost:5432/flapjack_dev
EOF
```

```bash
# Create a new migration
npx node-pg-migrate create migration_name
```

```bash
# Start postgres
docker compose up -d

# Run migrations
npx dotenv-cli -e .env -- node-pg-migrate up

# Reset the database
docker compose down -v
```

```sql
-- Setup the database and user
CREATE DATABASE flapjack_test;
CREATE USER flapjack WITH PASSWORD 'flapjack';
GRANT ALL PRIVILEGES ON DATABASE flapjack_test TO flapjack;

-- Reset the database
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
```
