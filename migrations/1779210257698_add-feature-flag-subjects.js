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
  pgm.createTable(
    { schema: "flapjack", name: "feature_flag_subject" },
    {
      id: "id",
      feature_flag_id: {
        type: "integer",
        notNull: true,
        references: { schema: "flapjack", name: "feature_flag" },
        onDelete: "CASCADE",
      },
      subject: { type: "text", notNull: true },
      created: {
        type: "timestamptz",
        notNull: true,
        default: pgm.func("now()"),
      },
    },
  );

  pgm.addConstraint(
    { schema: "flapjack", name: "feature_flag_subject" },
    "unique_feature_flag_subject",
    {
      unique: ["feature_flag_id", "subject"],
    },
  );

  pgm.createIndex(
    { schema: "flapjack", name: "feature_flag_subject" },
    "feature_flag_id",
  );
  pgm.createIndex(
    { schema: "flapjack", name: "feature_flag_subject" },
    "subject",
  );

  pgm.createTable(
    { schema: "flapjack", name: "feature_flag_group_subject" },
    {
      id: "id",
      feature_flag_group_id: {
        type: "integer",
        notNull: true,
        references: { schema: "flapjack", name: "feature_flag_group" },
        onDelete: "CASCADE",
      },
      subject: { type: "text", notNull: true },
      created: {
        type: "timestamptz",
        notNull: true,
        default: pgm.func("now()"),
      },
    },
  );

  pgm.addConstraint(
    { schema: "flapjack", name: "feature_flag_group_subject" },
    "unique_feature_flag_group_subject",
    {
      unique: ["feature_flag_group_id", "subject"],
    },
  );

  pgm.createIndex(
    { schema: "flapjack", name: "feature_flag_group_subject" },
    "feature_flag_group_id",
  );
  pgm.createIndex(
    { schema: "flapjack", name: "feature_flag_group_subject" },
    "subject",
  );
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropTable({ schema: "flapjack", name: "feature_flag_group_subject" });
  pgm.dropTable({ schema: "flapjack", name: "feature_flag_subject" });
};
