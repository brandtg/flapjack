/**
 * Represents a feature flag used to enable or disable features in an application.
 */
export type FeatureFlag = {
  /** Unique identifier for the feature flag */
  id: number;
  /** Human readable of the feature flag */
  name: string;
  /** Flip this flag on or off for everyone, overriding all other settings */
  everyone?: boolean;
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
};
