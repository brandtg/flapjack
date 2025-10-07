/**
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
export const shorthands = undefined;

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const up = (pgm) => {
  // Create the flapjack_feature_flag table
  pgm.createTable("flapjack_feature_flag", {
    id: "id",
    name: { type: "text", notNull: true, unique: true },
    everyone: { type: "boolean" },
    percent: {
      type: "numeric(3,1)",
      check: "percent >= 0 AND percent <= 99.9",
    },
    roles: { type: "text[]", default: pgm.func("'{}'::text[]") },
    groups: { type: "text[]", default: pgm.func("'{}'::text[]") },
    users: { type: "text[]", default: pgm.func("'{}'::text[]") },
    note: { type: "text" },
    created: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    modified: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
  });

  // Create a trigger to update the modified timestamp on row update
  pgm.sql(`
    CREATE OR REPLACE FUNCTION flapjack_set_modified_timestamp()
    RETURNS trigger AS $$
    BEGIN
    NEW.modified = now();
    RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  // Attach the trigger to the flapjack_feature_flag table
  pgm.sql(`
    CREATE TRIGGER flapjack_feature_flag_set_modified
    BEFORE UPDATE ON flapjack_feature_flag
    FOR EACH ROW
    EXECUTE FUNCTION flapjack_set_modified_timestamp();
  `);
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.sql(`
    DROP TRIGGER IF EXISTS flapjack_feature_flag_set_modified 
    ON flapjack_feature_flag;
  `);
  pgm.sql(`DROP FUNCTION IF EXISTS flapjack_set_modified_timestamp;`);
  pgm.dropTable("flapjack_feature_flag");
};
