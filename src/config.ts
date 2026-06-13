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

interface BotConfig {
  token:               string;
  clientId:            string;
  guildId:             string;
  allowedChannelIds:   string[];
  allowedAdminRoleIds: string[];
  tribeLadderDB:       TribeLadderDBConfig;
  database:            DatabaseConfig;
}

const config: BotConfig = rawConfig as unknown as BotConfig;

export default config;
