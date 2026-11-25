/**
 * Typed wrapper around config.json.
 * TypeScript infers an empty array as `never[]`, which breaks `.includes()`.
 * Importing through this module ensures all fields have the correct types.
 */

import rawConfig from '../config.json';

interface DatabaseConfig {
  host:              string;
  port:              number;
  user:              string;
  password:          string;
  database:          string;
  verificationTable: string;
  pendingCodesTable: string;
}

interface TribeLadderDBConfig {
  enabled:  boolean;
  host:     string;
  port:     number;
  user:     string;
  password: string;
  database: string;
}

interface ShopDatabaseConfig {
  host:     string;
  port:     number;
  user:     string;
  password: string;
  database: string;
  table:    string;
}

interface PointsSystemConfig {
  enabled:           boolean;
  pointsPerInterval: number;
  intervalMinutes:   number;
  rewardMessage:     string;
}

interface ArkServerConfig {
  mapName:  string;
  ip:       string;
  port:     number;
  password: string;
}

interface RewardLogWebhookConfig {
  enabled: boolean;
  url:     string;
}

interface ReferralSystemConfig {
  enabled:                 boolean;
  referralCodesTable:      string;
  referralsTable:          string;
  rewardsTable:            string;
  referralCodeLength:      number;
  workerIntervalSeconds:   number;
  milestone5Points:        number;
  milestone10Points:       number;
  milestone20Points:       number;
  milestone20RoleId:       string;
  statusChannelId:         string;
}

interface CharacterRestoreConfig {
  enabled:           boolean;
  /** Cousin Server Manager address, e.g. http://localhost:4000 */
  managerUrl:        string;
  /** API key with the `read` + `restore` scopes. */
  apiKey:            string;
  /** Minimum time between two restores of the same character (0 = no limit). */
  cooldownMinutes:   number;
  /** Discord channel where every restore is logged (empty = no log). */
  adminLogChannelId: string;
}

interface BotConfig {
  token:               string;
  clientId:            string;
  guildId:             string;
  allowedChannelIds:   string[];
  allowedAdminRoleIds: string[];
  tribeLadderDB:       TribeLadderDBConfig;
  database:            DatabaseConfig;
  shopDatabase:        ShopDatabaseConfig;
  pointsSystem:        PointsSystemConfig;
  arkServers:          ArkServerConfig[];
  rewardLogWebhook:    RewardLogWebhookConfig;
  referralSystem:      ReferralSystemConfig;
  /** Optional — missing section = feature disabled. */
  characterRestore?:   CharacterRestoreConfig;
}


const config: BotConfig = rawConfig as unknown as BotConfig;

export default config;
