import mysql, { RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import config from './config';

// ─────────────────────────────────────────────────────────────
//  Main DB pool (CousinDiscordLinker tables)
// ─────────────────────────────────────────────────────────────

const pool = mysql.createPool({
  host:             config.database.host,
  port:             config.database.port,
  user:             config.database.user,
  password:         config.database.password,
  database:         config.database.database,
  waitForConnections: true,
  connectionLimit:  10,
  queueLimit:       0,
});

const verTable  = config.database.verificationTable;
const codeTable = config.database.pendingCodesTable;


// ─────────────────────────────────────────────────────────────
//  TribeLadder DB pool (CousinTribeLadder — optional)
// ─────────────────────────────────────────────────────────────

let ladderPool: mysql.Pool | null = null;

if (config.tribeLadderDB.enabled) {
  ladderPool = mysql.createPool({
    host:             config.tribeLadderDB.host,
    port:             config.tribeLadderDB.port,
    user:             config.tribeLadderDB.user,
    password:         config.tribeLadderDB.password,
    database:         config.tribeLadderDB.database,
    waitForConnections: true,
    connectionLimit:  5,
    queueLimit:       0,
  });
}


// ─────────────────────────────────────────────────────────────
//  Types
// ─────────────────────────────────────────────────────────────

export interface PendingCode extends RowDataPacket {
  EosId:      string;
  PlayerName: string;
  Code:       string;
  ExpiresAt:  number;
}

export interface VerifiedPlayer extends RowDataPacket {
  Id:          number;
  EosId:       string;
  PlayerName:  string;
  DiscordId:   string;
  DiscordName: string;
  Verified:    number;
}

export interface LadderStats extends RowDataPacket {
  tribe_name:   string | null;
  tribe_id:     number | null;
  player_level: number | null;
  kills:        number | null;
  dino_kill:    number | null;
  death:        number | null;
  death_all:    number | null;
}


// ─────────────────────────────────────────────────────────────
//  Main DB queries
// ─────────────────────────────────────────────────────────────

/**
 * Looks up a pending code that exists AND has not expired.
 * Returns null if not found or expired.
 */
export async function getCodeEntry(code: string): Promise<PendingCode | null> {
  const nowTs = Math.floor(Date.now() / 1000);
  const [rows] = await pool.execute<PendingCode[]>(
    `SELECT EosId, PlayerName, Code, ExpiresAt FROM \`${codeTable}\` WHERE Code = ? AND ExpiresAt > ?`,
    [code.toUpperCase(), nowTs]
  );
  return rows.length > 0 ? rows[0] : null;
}

/**
 * Finds a verified player record by their Discord user ID.
 */
export async function getPlayerByDiscordId(discordId: string): Promise<VerifiedPlayer | null> {
  const [rows] = await pool.execute<VerifiedPlayer[]>(
    `SELECT * FROM \`${verTable}\` WHERE DiscordId = ?`,
    [discordId]
  );
  return rows.length > 0 ? rows[0] : null;
}

/**
 * Finds a player record by their EOS ID.
 */
export async function getPlayerByEosId(eosId: string): Promise<VerifiedPlayer | null> {
  const [rows] = await pool.execute<VerifiedPlayer[]>(
    `SELECT * FROM \`${verTable}\` WHERE EosId = ?`,
    [eosId]
  );
  return rows.length > 0 ? rows[0] : null;
}

/**
 * Finds a player record by their exact Discord username.
 */
export async function getPlayerByDiscordName(discordName: string): Promise<VerifiedPlayer | null> {
  const [rows] = await pool.execute<VerifiedPlayer[]>(
    `SELECT * FROM \`${verTable}\` WHERE DiscordName = ?`,
    [discordName]
  );
  return rows.length > 0 ? rows[0] : null;
}

/**
 * Marks a player as verified and stores their Discord identity.
 */
export async function linkPlayer(
  eosId:       string,
  discordId:   string,
  discordName: string
): Promise<void> {
  await pool.execute(
    `UPDATE \`${verTable}\` SET DiscordId = ?, DiscordName = ?, Verified = 1 WHERE EosId = ?`,
    [discordId, discordName, eosId]
  );
}

/**
 * Deletes a pending code entry after it has been consumed.
 */
export async function deleteCode(code: string): Promise<void> {
  await pool.execute(
    `DELETE FROM \`${codeTable}\` WHERE Code = ?`,
    [code.toUpperCase()]
  );
}

/**
 * Unlinks a Discord user from their in-game account.
 * Returns true if a record was updated.
 */
export async function unlinkPlayer(discordId: string): Promise<boolean> {
  const [result] = await pool.execute<ResultSetHeader>(
    `UPDATE \`${verTable}\` SET Verified = 0, DiscordId = '', DiscordName = '' WHERE DiscordId = ?`,
    [discordId]
  );
  return result.affectedRows > 0;
}


// ─────────────────────────────────────────────────────────────
//  TribeLadder DB query
// ─────────────────────────────────────────────────────────────

/**
 * Fetches a player's CousinTribeLadder stats by EOS ID.
 * Returns null if TribeLadderDB is disabled OR the player has no entry.
 * Never throws — failures are swallowed and null is returned.
 */
export async function getPlayerLadderStats(eosId: string): Promise<LadderStats | null> {
  if (!ladderPool) return null;

  try {
    const [rows] = await ladderPool.execute<LadderStats[]>(
      `SELECT tribe_name, tribe_id, player_level, kills, dino_kill, death, death_all
       FROM players
       WHERE eos_id = ?`,
      [eosId]
    );
    return rows.length > 0 ? rows[0] : null;
  } catch {
    return null;
  }
}
