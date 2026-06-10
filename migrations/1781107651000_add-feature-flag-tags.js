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
  pgm.addColumn(
    { schema: "flapjack", name: "feature_flag" },
    {
      tags: {
        type: "text[]",
        default: pgm.func("'{}'::text[]"),
      },
    },
  );

  // GIN index for efficient lookups by tag (e.g. WHERE $1 = ANY(tags))
  pgm.createIndex({ schema: "flapjack", name: "feature_flag" }, "tags", {
    method: "gin",
  });
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropIndex({ schema: "flapjack", name: "feature_flag" }, "tags", {
    method: "gin",
  });
  pgm.dropColumn({ schema: "flapjack", name: "feature_flag" }, "tags");
};
