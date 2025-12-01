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
  // Create the flapjack_feature_flag_group table
  pgm.createTable("flapjack_feature_flag_group", {
    id: "id",
    name: { type: "text", notNull: true, unique: true },
    note: { type: "text" },
    created: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    modified: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now()"),
    },
  });

  // Create the flapjack_feature_flag_group_member relation table
  pgm.createTable("flapjack_feature_flag_group_member", {
    id: "id",
    group_id: {
      type: "integer",
      notNull: true,
      references: "flapjack_feature_flag_group",
      onDelete: "CASCADE",
    },
    feature_flag_id: {
      type: "integer",
      notNull: true,
      references: "flapjack_feature_flag",
      onDelete: "CASCADE",
    },
    created: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  // Add unique constraint on group_id and feature_flag_id
  pgm.addConstraint(
    "flapjack_feature_flag_group_member",
    "unique_group_feature_flag",
    {
      unique: ["group_id", "feature_flag_id"],
    },
  );

  // Create indexes for efficient lookups
  pgm.createIndex("flapjack_feature_flag_group_member", "group_id");
  pgm.createIndex("flapjack_feature_flag_group_member", "feature_flag_id");

  // Attach the modified timestamp trigger to the group table
  pgm.sql(`
    CREATE TRIGGER flapjack_feature_flag_group_set_modified
    BEFORE UPDATE ON flapjack_feature_flag_group
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
    DROP TRIGGER IF EXISTS flapjack_feature_flag_group_set_modified 
    ON flapjack_feature_flag_group;
  `);
  pgm.dropTable("flapjack_feature_flag_group_member");
  pgm.dropTable("flapjack_feature_flag_group");
};
