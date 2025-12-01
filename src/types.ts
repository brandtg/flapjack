/**
 * Represents a feature flag used to enable or disable features in an application.
 */
export type FeatureFlag = {
  /** Unique identifier for the feature flag */
  id: number;
  /** Human readable of the feature flag */
  name: string;
  /** Flip this flag on or off for everyone, overriding all other settings */
  everyone?: boolean | null;
  /** Number between 0 and 99.9 for percentage rollout */
  percent?: number;
  /** List of roles that have this feature flag enabled */
  roles?: string[];
  /** List of user groups that have this feature flag enabled */
  groups?: string[];
  /** List of specific user IDs that have this feature flag enabled */
  users?: string[];
  /** Description of where this flag is used and what it does */
  note?: string;
  /** Date when the feature flag was created */
  created: Date;
  /** Date when the feature flag was last modified */
  modified: Date;
  /** Optional expiration date for the feature flag */
  expires?: Date;
};

/**
 * Called when a feature flag which has expired is used.
 *
 * If the handler returns `true` or `false`, that value will be used as the result of the feature
 * flag check. If it returns `undefined` the behavior will be the same as if the flag has not
 * expired. This can be used to implement a grace period for expired flags, or to emit metrics to
 * alert that an expired flag is still in use.
 */
export type ExpiredFeatureFlagEventHandler = ({
  flag,
}: {
  flag: FeatureFlag;
}) => Promise<boolean | undefined>;

/**
 * Event handlers for feature flag events.
 */
export type FeatureFlagEventHandlers = {
  onExpired?: ExpiredFeatureFlagEventHandler;
};

/**
 * Represents a feature flag group used to manage multiple feature flags together.
 */
export type FeatureFlagGroup = {
  /** Unique identifier for the feature flag group */
  id: number;
  /** Human readable name of the feature flag group */
  name: string;
  /** Description of what this group is for */
  note?: string;
  /** Date when the group was created */
  created: Date;
  /** Date when the group was last modified */
  modified: Date;
};
