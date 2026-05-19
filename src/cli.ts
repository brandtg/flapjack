#!/usr/bin/env node

import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { Pool } from "pg";
import { FeatureFlagModel, FeatureFlagGroupModel } from "./model.js";
import dotenv from "dotenv";

dotenv.config({ quiet: true });

function createDatabase() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Provide it in the environment or a .env file.",
    );
  }
  return new Pool({ connectionString });
}

const cli = yargs(hideBin(process.argv))
  .scriptName("flapjack")
  .usage("$0 <command> [options]")
  .help()
  .alias("help", "h")
  .version()
  .alias("version", "v")
  .demandCommand(1, "You need to specify a command")
  .strict();

// Common options for feature flag fields
const flagOptions = {
  name: {
    type: "string" as const,
    describe: "Feature flag name",
  },
  everyone: {
    type: "boolean" as const,
    describe: "Enable flag for everyone (overrides all other settings)",
  },
  percent: {
    type: "number" as const,
    describe: "Percentage rollout (0-99.9)",
  },
  roles: {
    type: "array" as const,
    describe: "List of roles that have this flag enabled",
  },
  groups: {
    type: "array" as const,
    describe: "List of user groups that have this flag enabled",
  },
  users: {
    type: "array" as const,
    describe: "List of specific user IDs that have this flag enabled",
  },
  note: {
    type: "string" as const,
    describe: "Description of where this flag is used and what it does",
  },
  expires: {
    type: "string" as const,
    describe: "Expiration date (ISO 8601 format)",
  },
};

// Create command
cli.command(
  "create",
  "Create a new feature flag",
  (yargs) => {
    return yargs
      .options({
        ...flagOptions,
      })
      .demandOption("name", "Feature flag name is required");
  },
  async (argv) => {
    const db = createDatabase();
    const model = new FeatureFlagModel(db);

    try {
      const input: any = { name: argv.name };

      if (argv.everyone !== undefined) input.everyone = argv.everyone;
      if (argv.percent !== undefined) input.percent = argv.percent;
      if (argv.roles !== undefined) input.roles = argv.roles as string[];
      if (argv.groups !== undefined) input.groups = argv.groups as string[];
      if (argv.users !== undefined) input.users = argv.users as string[];
      if (argv.note !== undefined) input.note = argv.note;
      if (argv.expires !== undefined) input.expires = new Date(argv.expires);

      const flag = await model.create(input);
      console.log(JSON.stringify(flag, null, 2));
    } catch (error) {
      console.error("Error creating feature flag:", error);
      process.exit(1);
    } finally {
      await db.end();
    }
  },
);

// Get by ID command
cli.command(
  "get <id>",
  "Get a feature flag by ID",
  (yargs) => {
    return yargs.positional("id", {
      type: "number",
      describe: "Feature flag ID",
    });
  },
  async (argv) => {
    const db = createDatabase();
    const model = new FeatureFlagModel(db);

    try {
      const flag = await model.getById(argv.id!);
      if (flag) {
        console.log(JSON.stringify(flag, null, 2));
      } else {
        console.log(`Feature flag with ID ${argv.id} not found`);
        process.exit(1);
      }
    } catch (error) {
      console.error("Error getting feature flag:", error);
      process.exit(1);
    } finally {
      await db.end();
    }
  },
);

// Get by name command
cli.command(
  "get-by-name <name>",
  "Get a feature flag by name",
  (yargs) => {
    return yargs.positional("name", {
      type: "string",
      describe: "Feature flag name",
    });
  },
  async (argv) => {
    const db = createDatabase();
    const model = new FeatureFlagModel(db);

    try {
      const flag = await model.getByName(argv.name!);
      if (flag) {
        console.log(JSON.stringify(flag, null, 2));
      } else {
        console.log(`Feature flag with name "${argv.name}" not found`);
        process.exit(1);
      }
    } catch (error) {
      console.error("Error getting feature flag:", error);
      process.exit(1);
    } finally {
      await db.end();
    }
  },
);

// List command
cli.command(
  "list",
  "List all feature flags",
  () => {},
  async () => {
    const db = createDatabase();
    const model = new FeatureFlagModel(db);

    try {
      const flags = await model.list();
      console.log(JSON.stringify(flags, null, 2));
    } catch (error) {
      console.error("Error listing feature flags:", error);
      process.exit(1);
    } finally {
      await db.end();
    }
  },
);

// Update command
cli.command(
  "update <id>",
  "Update a feature flag",
  (yargs) => {
    return yargs
      .positional("id", {
        type: "number",
        describe: "Feature flag ID",
      })
      .options({
        ...flagOptions,
        "clear-everyone": {
          type: "boolean" as const,
          describe: "Unset the everyone override (set to null)",
        },
        "clear-percent": {
          type: "boolean" as const,
          describe: "Unset percentage rollout",
        },
        "clear-roles": {
          type: "boolean" as const,
          describe: "Clear roles list",
        },
        "clear-groups": {
          type: "boolean" as const,
          describe: "Clear groups list",
        },
        "clear-users": {
          type: "boolean" as const,
          describe: "Clear users list",
        },
        "clear-note": {
          type: "boolean" as const,
          describe: "Clear the note",
        },
        "clear-expires": {
          type: "boolean" as const,
          describe: "Clear the expiration date",
        },
      });
  },
  async (argv) => {
    const db = createDatabase();
    const model = new FeatureFlagModel(db);

    try {
      const changes: any = {};

      if (argv.name !== undefined) changes.name = argv.name;

      // Everyone: clear flag takes precedence
      if ((argv as any).clearEveryone) changes.everyone = null;
      else if (argv.everyone !== undefined) changes.everyone = argv.everyone;

      // Percent: clear flag takes precedence
      if ((argv as any).clearPercent) changes.percent = null;
      else if (argv.percent !== undefined) changes.percent = argv.percent;

      // Roles: clear flag takes precedence
      if ((argv as any).clearRoles) changes.roles = null;
      else if (argv.roles !== undefined) changes.roles = argv.roles as string[];

      // Groups: clear flag takes precedence
      if ((argv as any).clearGroups) changes.groups = null;
      else if (argv.groups !== undefined)
        changes.groups = argv.groups as string[];

      // Users: clear flag takes precedence
      if ((argv as any).clearUsers) changes.users = null;
      else if (argv.users !== undefined) changes.users = argv.users as string[];

      // Note: clear flag takes precedence
      if ((argv as any).clearNote) changes.note = null;
      else if (argv.note !== undefined) changes.note = argv.note;

      // Expires: clear flag takes precedence
      if ((argv as any).clearExpires) changes.expires = null;
      else if (argv.expires !== undefined)
        changes.expires = new Date(argv.expires);

      const flag = await model.update(argv.id!, changes);
      if (flag) {
        console.log(JSON.stringify(flag, null, 2));
      } else {
        console.log(`Feature flag with ID ${argv.id} not found`);
        process.exit(1);
      }
    } catch (error) {
      console.error("Error updating feature flag:", error);
      process.exit(1);
    } finally {
      await db.end();
    }
  },
);

// Delete command
cli.command(
  "delete <id>",
  "Delete a feature flag",
  (yargs) => {
    return yargs.positional("id", {
      type: "number",
      describe: "Feature flag ID",
    });
  },
  async (argv) => {
    const db = createDatabase();
    const model = new FeatureFlagModel(db);

    try {
      const success = await model.delete(argv.id!);
      if (success) {
        console.log(`Feature flag with ID ${argv.id} deleted successfully`);
      } else {
        console.log(`Feature flag with ID ${argv.id} not found`);
        process.exit(1);
      }
    } catch (error) {
      console.error("Error deleting feature flag:", error);
      process.exit(1);
    } finally {
      await db.end();
    }
  },
);

// Check if active for user command
cli.command(
  "is-active <name>",
  "Check if a feature flag is active for a user",
  (yargs) => {
    return yargs
      .positional("name", {
        type: "string",
        describe: "Feature flag name",
      })
      .options({
        user: {
          type: "string",
          describe: "User ID",
        },
        roles: {
          type: "array",
          describe: "User roles",
        },
        groups: {
          type: "array",
          describe: "User groups",
        },
      });
  },
  async (argv) => {
    const db = createDatabase();
    const model = new FeatureFlagModel(db);

    try {
      const isActive = await model.isActiveForUser({
        name: argv.name!,
        user: argv.user,
        roles: argv.roles as string[],
        groups: argv.groups as string[],
      });

      console.log(
        JSON.stringify(
          {
            name: argv.name,
            isActive,
            user: argv.user,
            roles: argv.roles,
            groups: argv.groups,
          },
          null,
          2,
        ),
      );
    } catch (error) {
      console.error("Error checking feature flag:", error);
      process.exit(1);
    } finally {
      await db.end();
    }
  },
);

// Check multiple flags for user command
cli.command(
  "are-active",
  "Check if multiple feature flags are active for a user",
  (yargs) => {
    return yargs.options({
      names: {
        type: "array",
        describe: "Optional list of feature flag names (defaults to all flags)",
      },
      user: {
        type: "string",
        describe: "User ID",
      },
      roles: {
        type: "array",
        describe: "User roles",
      },
      groups: {
        type: "array",
        describe: "User groups",
      },
    });
  },
  async (argv) => {
    const db = createDatabase();
    const model = new FeatureFlagModel(db);

    try {
      const results = await model.areActiveForUser({
        names: argv.names as string[] | undefined,
        user: argv.user,
        roles: argv.roles as string[],
        groups: argv.groups as string[],
      });

      console.log(
        JSON.stringify(
          {
            names: argv.names,
            user: argv.user,
            roles: argv.roles,
            groups: argv.groups,
            results,
          },
          null,
          2,
        ),
      );
    } catch (error) {
      console.error("Error checking multiple feature flags:", error);
      process.exit(1);
    } finally {
      await db.end();
    }
  },
);

// Check if active for context command
cli.command(
  "is-active-context <name>",
  "Check if a feature flag is active for a context including subjects",
  (yargs) => {
    return yargs
      .positional("name", {
        type: "string",
        describe: "Feature flag name",
      })
      .options({
        user: {
          type: "string",
          describe: "User ID",
        },
        roles: {
          type: "array",
          describe: "User roles",
        },
        groups: {
          type: "array",
          describe: "User groups",
        },
        subjects: {
          type: "array",
          describe: "External subject IDs (for example tenant:acme)",
        },
      });
  },
  async (argv) => {
    const db = createDatabase();
    const model = new FeatureFlagModel(db);

    try {
      const isActive = await model.isActiveForContext({
        name: argv.name!,
        user: argv.user,
        roles: argv.roles as string[],
        groups: argv.groups as string[],
        subjects: argv.subjects as string[],
      });

      console.log(
        JSON.stringify(
          {
            name: argv.name,
            isActive,
            user: argv.user,
            roles: argv.roles,
            groups: argv.groups,
            subjects: argv.subjects,
          },
          null,
          2,
        ),
      );
    } catch (error) {
      console.error("Error checking feature flag context:", error);
      process.exit(1);
    } finally {
      await db.end();
    }
  },
);

// Add a subject to a feature flag
cli.command(
  "add-subject <id> <subject>",
  "Add an external subject ID to a feature flag",
  (yargs) => {
    return yargs
      .positional("id", {
        type: "number",
        describe: "Feature flag ID",
      })
      .positional("subject", {
        type: "string",
        describe: "External subject ID (for example tenant:acme)",
      });
  },
  async (argv) => {
    const db = createDatabase();
    const model = new FeatureFlagModel(db);

    try {
      const added = await model.addSubject(argv.id!, argv.subject!);
      console.log(
        JSON.stringify(
          {
            id: argv.id,
            subject: argv.subject,
            added,
          },
          null,
          2,
        ),
      );
    } catch (error) {
      console.error("Error adding subject:", error);
      process.exit(1);
    } finally {
      await db.end();
    }
  },
);

// Remove a subject from a feature flag
cli.command(
  "remove-subject <id> <subject>",
  "Remove an external subject ID from a feature flag",
  (yargs) => {
    return yargs
      .positional("id", {
        type: "number",
        describe: "Feature flag ID",
      })
      .positional("subject", {
        type: "string",
        describe: "External subject ID",
      });
  },
  async (argv) => {
    const db = createDatabase();
    const model = new FeatureFlagModel(db);

    try {
      const removed = await model.removeSubject(argv.id!, argv.subject!);
      console.log(
        JSON.stringify(
          {
            id: argv.id,
            subject: argv.subject,
            removed,
          },
          null,
          2,
        ),
      );
    } catch (error) {
      console.error("Error removing subject:", error);
      process.exit(1);
    } finally {
      await db.end();
    }
  },
);

// List subjects for a feature flag
cli.command(
  "list-subjects <id>",
  "List external subject IDs for a feature flag",
  (yargs) => {
    return yargs.positional("id", {
      type: "number",
      describe: "Feature flag ID",
    });
  },
  async (argv) => {
    const db = createDatabase();
    const model = new FeatureFlagModel(db);

    try {
      const subjects = await model.getSubjects(argv.id!);
      console.log(
        JSON.stringify(
          {
            id: argv.id,
            subjects,
          },
          null,
          2,
        ),
      );
    } catch (error) {
      console.error("Error listing subjects:", error);
      process.exit(1);
    } finally {
      await db.end();
    }
  },
);

// Check multiple flags for context command
cli.command(
  "are-active-context",
  "Check if multiple feature flags are active for a context including subjects",
  (yargs) => {
    return yargs.options({
      names: {
        type: "array",
        describe: "Optional list of feature flag names (defaults to all flags)",
      },
      user: {
        type: "string",
        describe: "User ID",
      },
      roles: {
        type: "array",
        describe: "User roles",
      },
      groups: {
        type: "array",
        describe: "User groups",
      },
      subjects: {
        type: "array",
        describe: "External subject IDs (for example tenant:acme)",
      },
    });
  },
  async (argv) => {
    const db = createDatabase();
    const model = new FeatureFlagModel(db);

    try {
      const results = await model.areActiveForContext({
        names: argv.names as string[] | undefined,
        user: argv.user,
        roles: argv.roles as string[],
        groups: argv.groups as string[],
        subjects: argv.subjects as string[],
      });

      console.log(
        JSON.stringify(
          {
            names: argv.names,
            user: argv.user,
            roles: argv.roles,
            groups: argv.groups,
            subjects: argv.subjects,
            results,
          },
          null,
          2,
        ),
      );
    } catch (error) {
      console.error("Error checking multiple feature flag contexts:", error);
      process.exit(1);
    } finally {
      await db.end();
    }
  },
);

// List flags that directly match a subject
cli.command(
  "list-by-subject <subject>",
  "List feature flags directly assigned to an external subject ID",
  (yargs) => {
    return yargs.positional("subject", {
      type: "string",
      describe: "External subject ID",
    });
  },
  async (argv) => {
    const db = createDatabase();
    const model = new FeatureFlagModel(db);

    try {
      const flags = await model.getFeatureFlagsForSubject(argv.subject!);
      console.log(
        JSON.stringify(
          {
            subject: argv.subject,
            flags,
          },
          null,
          2,
        ),
      );
    } catch (error) {
      console.error("Error listing flags by subject:", error);
      process.exit(1);
    } finally {
      await db.end();
    }
  },
);

// Create feature flag group command
cli.command(
  "group-create",
  "Create a feature flag group",
  (yargs) => {
    return yargs
      .options({
        name: {
          type: "string",
          describe: "Feature flag group name",
        },
        note: {
          type: "string",
          describe: "Feature flag group description",
        },
      })
      .demandOption("name", "Feature flag group name is required");
  },
  async (argv) => {
    const db = createDatabase();
    const model = new FeatureFlagGroupModel(db);

    try {
      const group = await model.create({
        name: argv.name!,
        note: argv.note,
      });
      console.log(JSON.stringify(group, null, 2));
    } catch (error) {
      console.error("Error creating feature flag group:", error);
      process.exit(1);
    } finally {
      await db.end();
    }
  },
);

// List feature flag groups command
cli.command(
  "group-list",
  "List all feature flag groups",
  () => {},
  async () => {
    const db = createDatabase();
    const model = new FeatureFlagGroupModel(db);

    try {
      const groups = await model.list();
      console.log(JSON.stringify(groups, null, 2));
    } catch (error) {
      console.error("Error listing feature flag groups:", error);
      process.exit(1);
    } finally {
      await db.end();
    }
  },
);

// Get feature flag group by ID command
cli.command(
  "group-get <id>",
  "Get a feature flag group by ID",
  (yargs) => {
    return yargs.positional("id", {
      type: "number",
      describe: "Feature flag group ID",
    });
  },
  async (argv) => {
    const db = createDatabase();
    const model = new FeatureFlagGroupModel(db);

    try {
      const group = await model.getById(argv.id!);
      if (!group) {
        console.log(`Feature flag group with ID ${argv.id} not found`);
        process.exit(1);
      }
      console.log(JSON.stringify(group, null, 2));
    } catch (error) {
      console.error("Error getting feature flag group:", error);
      process.exit(1);
    } finally {
      await db.end();
    }
  },
);

// Get feature flag group by name command
cli.command(
  "group-get-by-name <name>",
  "Get a feature flag group by name",
  (yargs) => {
    return yargs.positional("name", {
      type: "string",
      describe: "Feature flag group name",
    });
  },
  async (argv) => {
    const db = createDatabase();
    const model = new FeatureFlagGroupModel(db);

    try {
      const group = await model.getByName(argv.name!);
      if (!group) {
        console.log(`Feature flag group with name "${argv.name}" not found`);
        process.exit(1);
      }
      console.log(JSON.stringify(group, null, 2));
    } catch (error) {
      console.error("Error getting feature flag group by name:", error);
      process.exit(1);
    } finally {
      await db.end();
    }
  },
);

// Update feature flag group command
cli.command(
  "group-update <id>",
  "Update a feature flag group",
  (yargs) => {
    return yargs
      .positional("id", {
        type: "number",
        describe: "Feature flag group ID",
      })
      .options({
        name: {
          type: "string",
          describe: "Feature flag group name",
        },
        note: {
          type: "string",
          describe: "Feature flag group description",
        },
        "clear-note": {
          type: "boolean",
          describe: "Clear the group note",
        },
      });
  },
  async (argv) => {
    const db = createDatabase();
    const model = new FeatureFlagGroupModel(db);

    try {
      const changes: any = {};
      if (argv.name !== undefined) changes.name = argv.name;
      if ((argv as any).clearNote) changes.note = null;
      else if (argv.note !== undefined) changes.note = argv.note;

      const group = await model.update(argv.id!, changes);
      if (!group) {
        console.log(`Feature flag group with ID ${argv.id} not found`);
        process.exit(1);
      }
      console.log(JSON.stringify(group, null, 2));
    } catch (error) {
      console.error("Error updating feature flag group:", error);
      process.exit(1);
    } finally {
      await db.end();
    }
  },
);

// Delete feature flag group command
cli.command(
  "group-delete <id>",
  "Delete a feature flag group",
  (yargs) => {
    return yargs.positional("id", {
      type: "number",
      describe: "Feature flag group ID",
    });
  },
  async (argv) => {
    const db = createDatabase();
    const model = new FeatureFlagGroupModel(db);

    try {
      const deleted = await model.delete(argv.id!);
      if (!deleted) {
        console.log(`Feature flag group with ID ${argv.id} not found`);
        process.exit(1);
      }
      console.log(`Feature flag group with ID ${argv.id} deleted successfully`);
    } catch (error) {
      console.error("Error deleting feature flag group:", error);
      process.exit(1);
    } finally {
      await db.end();
    }
  },
);

// Add flag to feature flag group command
cli.command(
  "group-add-flag <groupId> <flagId>",
  "Add a feature flag to a group",
  (yargs) => {
    return yargs
      .positional("groupId", {
        type: "number",
        describe: "Feature flag group ID",
      })
      .positional("flagId", {
        type: "number",
        describe: "Feature flag ID",
      });
  },
  async (argv) => {
    const db = createDatabase();
    const model = new FeatureFlagGroupModel(db);

    try {
      const added = await model.addFeatureFlag(argv.groupId!, argv.flagId!);
      console.log(
        JSON.stringify(
          {
            groupId: argv.groupId,
            flagId: argv.flagId,
            added,
          },
          null,
          2,
        ),
      );
    } catch (error) {
      console.error("Error adding feature flag to group:", error);
      process.exit(1);
    } finally {
      await db.end();
    }
  },
);

// Remove flag from feature flag group command
cli.command(
  "group-remove-flag <groupId> <flagId>",
  "Remove a feature flag from a group",
  (yargs) => {
    return yargs
      .positional("groupId", {
        type: "number",
        describe: "Feature flag group ID",
      })
      .positional("flagId", {
        type: "number",
        describe: "Feature flag ID",
      });
  },
  async (argv) => {
    const db = createDatabase();
    const model = new FeatureFlagGroupModel(db);

    try {
      const removed = await model.removeFeatureFlag(
        argv.groupId!,
        argv.flagId!,
      );
      console.log(
        JSON.stringify(
          {
            groupId: argv.groupId,
            flagId: argv.flagId,
            removed,
          },
          null,
          2,
        ),
      );
    } catch (error) {
      console.error("Error removing feature flag from group:", error);
      process.exit(1);
    } finally {
      await db.end();
    }
  },
);

// List flags in feature flag group command
cli.command(
  "group-list-flags <groupId>",
  "List all feature flags in a group",
  (yargs) => {
    return yargs.positional("groupId", {
      type: "number",
      describe: "Feature flag group ID",
    });
  },
  async (argv) => {
    const db = createDatabase();
    const model = new FeatureFlagGroupModel(db);

    try {
      const flags = await model.getFeatureFlags(argv.groupId!);
      console.log(
        JSON.stringify(
          {
            groupId: argv.groupId,
            flags,
          },
          null,
          2,
        ),
      );
    } catch (error) {
      console.error("Error listing flags for group:", error);
      process.exit(1);
    } finally {
      await db.end();
    }
  },
);

// List groups for feature flag command
cli.command(
  "group-list-for-flag <flagId>",
  "List all groups that contain a feature flag",
  (yargs) => {
    return yargs.positional("flagId", {
      type: "number",
      describe: "Feature flag ID",
    });
  },
  async (argv) => {
    const db = createDatabase();
    const model = new FeatureFlagGroupModel(db);

    try {
      const groups = await model.getGroupsForFeatureFlag(argv.flagId!);
      console.log(
        JSON.stringify(
          {
            flagId: argv.flagId,
            groups,
          },
          null,
          2,
        ),
      );
    } catch (error) {
      console.error("Error listing groups for feature flag:", error);
      process.exit(1);
    } finally {
      await db.end();
    }
  },
);

// Bulk update flags in a group command
cli.command(
  "group-update-all <groupId>",
  "Update all feature flags in a group",
  (yargs) => {
    return yargs
      .positional("groupId", {
        type: "number",
        describe: "Feature flag group ID",
      })
      .options({
        everyone: {
          type: "boolean",
          describe: "Enable flag for everyone (overrides all other settings)",
        },
        percent: {
          type: "number",
          describe: "Percentage rollout (0-99.9)",
        },
        roles: {
          type: "array",
          describe: "List of roles that have this flag enabled",
        },
        groups: {
          type: "array",
          describe: "List of user groups that have this flag enabled",
        },
        users: {
          type: "array",
          describe: "List of specific user IDs that have this flag enabled",
        },
        "clear-everyone": {
          type: "boolean",
          describe: "Unset the everyone override",
        },
        "clear-percent": {
          type: "boolean",
          describe: "Unset percentage rollout",
        },
        "clear-roles": {
          type: "boolean",
          describe: "Clear roles list",
        },
        "clear-groups": {
          type: "boolean",
          describe: "Clear groups list",
        },
        "clear-users": {
          type: "boolean",
          describe: "Clear users list",
        },
      });
  },
  async (argv) => {
    const db = createDatabase();
    const model = new FeatureFlagGroupModel(db);

    try {
      const changes: any = {};

      if ((argv as any).clearEveryone) changes.everyone = null;
      else if (argv.everyone !== undefined) changes.everyone = argv.everyone;

      if ((argv as any).clearPercent) changes.percent = null;
      else if (argv.percent !== undefined) changes.percent = argv.percent;

      if ((argv as any).clearRoles) changes.roles = null;
      else if (argv.roles !== undefined) changes.roles = argv.roles as string[];

      if ((argv as any).clearGroups) changes.groups = null;
      else if (argv.groups !== undefined)
        changes.groups = argv.groups as string[];

      if ((argv as any).clearUsers) changes.users = null;
      else if (argv.users !== undefined) changes.users = argv.users as string[];

      const updatedCount = await model.updateAll(argv.groupId!, changes);

      console.log(
        JSON.stringify(
          {
            groupId: argv.groupId,
            updatedCount,
            changes,
          },
          null,
          2,
        ),
      );
    } catch (error) {
      console.error("Error updating all flags in group:", error);
      process.exit(1);
    } finally {
      await db.end();
    }
  },
);

// Add subject to feature flag group command
cli.command(
  "group-add-subject <groupId> <subject>",
  "Add an external subject ID to a feature flag group",
  (yargs) => {
    return yargs
      .positional("groupId", {
        type: "number",
        describe: "Feature flag group ID",
      })
      .positional("subject", {
        type: "string",
        describe: "External subject ID",
      });
  },
  async (argv) => {
    const db = createDatabase();
    const model = new FeatureFlagGroupModel(db);

    try {
      const added = await model.addSubject(argv.groupId!, argv.subject!);
      console.log(
        JSON.stringify(
          {
            groupId: argv.groupId,
            subject: argv.subject,
            added,
          },
          null,
          2,
        ),
      );
    } catch (error) {
      console.error("Error adding subject to group:", error);
      process.exit(1);
    } finally {
      await db.end();
    }
  },
);

// Remove subject from feature flag group command
cli.command(
  "group-remove-subject <groupId> <subject>",
  "Remove an external subject ID from a feature flag group",
  (yargs) => {
    return yargs
      .positional("groupId", {
        type: "number",
        describe: "Feature flag group ID",
      })
      .positional("subject", {
        type: "string",
        describe: "External subject ID",
      });
  },
  async (argv) => {
    const db = createDatabase();
    const model = new FeatureFlagGroupModel(db);

    try {
      const removed = await model.removeSubject(argv.groupId!, argv.subject!);
      console.log(
        JSON.stringify(
          {
            groupId: argv.groupId,
            subject: argv.subject,
            removed,
          },
          null,
          2,
        ),
      );
    } catch (error) {
      console.error("Error removing subject from group:", error);
      process.exit(1);
    } finally {
      await db.end();
    }
  },
);

// List subjects for feature flag group command
cli.command(
  "group-list-subjects <groupId>",
  "List external subject IDs for a feature flag group",
  (yargs) => {
    return yargs.positional("groupId", {
      type: "number",
      describe: "Feature flag group ID",
    });
  },
  async (argv) => {
    const db = createDatabase();
    const model = new FeatureFlagGroupModel(db);

    try {
      const subjects = await model.getSubjects(argv.groupId!);
      console.log(
        JSON.stringify(
          {
            groupId: argv.groupId,
            subjects,
          },
          null,
          2,
        ),
      );
    } catch (error) {
      console.error("Error listing subjects for group:", error);
      process.exit(1);
    } finally {
      await db.end();
    }
  },
);

// List groups for subject command
cli.command(
  "group-list-by-subject <subject>",
  "List feature flag groups assigned to an external subject ID",
  (yargs) => {
    return yargs.positional("subject", {
      type: "string",
      describe: "External subject ID",
    });
  },
  async (argv) => {
    const db = createDatabase();
    const model = new FeatureFlagGroupModel(db);

    try {
      const groups = await model.getGroupsForSubject(argv.subject!);
      console.log(
        JSON.stringify(
          {
            subject: argv.subject,
            groups,
          },
          null,
          2,
        ),
      );
    } catch (error) {
      console.error("Error listing groups by subject:", error);
      process.exit(1);
    } finally {
      await db.end();
    }
  },
);

// Hash user ID command (utility)
cli.command(
  "hash-user <userId>",
  "Hash a user ID using the same algorithm as percentage rollout",
  (yargs) => {
    return yargs.positional("userId", {
      type: "string",
      describe: "User ID to hash",
    });
  },
  async (argv) => {
    const db = createDatabase();
    const model = new FeatureFlagModel(db);

    try {
      const hash = await model.hashUserId(argv.userId!);
      const bucket = hash % 100;
      console.log(
        JSON.stringify(
          {
            userId: argv.userId,
            hash,
            bucket,
          },
          null,
          2,
        ),
      );
    } catch (error) {
      console.error("Error hashing user ID:", error);
      process.exit(1);
    } finally {
      await db.end();
    }
  },
);

async function main() {
  await cli.parseAsync();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Error:", err);
    process.exit(1);
  });
