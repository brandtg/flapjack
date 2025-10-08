#!/usr/bin/env node

import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { Pool } from "pg";
import { FeatureFlagModel } from "./model.js";
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
