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
  // Add a nullable archived timestamp to the core data models. When set, the
  // record is considered archived (hidden) but kept for historical/audit
  // purposes. Archiving is irreversible and the name remains reserved forever
  // (the existing UNIQUE(name) constraint is intentionally left unchanged).
  pgm.addColumn(
    { schema: "flapjack", name: "feature_flag" },
    { archived: { type: "timestamptz" } },
  );
  pgm.addColumn(
    { schema: "flapjack", name: "feature_flag_group" },
    { archived: { type: "timestamptz" } },
  );
};

/**
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 * @param run {() => void | undefined}
 * @returns {Promise<void> | void}
 */
export const down = (pgm) => {
  pgm.dropColumn({ schema: "flapjack", name: "feature_flag" }, "archived");
  pgm.dropColumn(
    { schema: "flapjack", name: "feature_flag_group" },
    "archived",
  );
};
