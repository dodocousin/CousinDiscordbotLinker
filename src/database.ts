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
  connectTimeout:   10000,
  // Idle pooled connections can silently die (e.g. NAT/firewall drops
  // the TCP session without sending a RST) and then hang forever on
  // the next query issued against them. Enabling TCP keep-alive lets
  // the OS detect and clean up dead connections instead of the pool
  // handing out a zombie connection that will never respond.
  enableKeepAlive:        true,
  keepAliveInitialDelay:  10000,
});



const verTable  = config.database.verificationTable;
const codeTable = config.database.pendingCodesTable;
const referralCodesTable = () => config.referralSystem.referralCodesTable;
const referralsTable = () => config.referralSystem.referralsTable;
const rewardsTable = () => config.referralSystem.rewardsTable;


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
  tribe_name:       string | null;
  tribe_id:         number | null;
  player_level:     number | null;
  kills:            number | null;
  dino_kill:        number | null;
  death:            number | null;
  death_all:        number | null;
  wild_dino_kills:  number | null;
  tames:            number | null;
}

export interface ReferralCode extends RowDataPacket {
  EosId: string;
  DiscordId: string;
  ReferralCode: string;
}

export interface Referral extends RowDataPacket {
  Id: number;
  ReferrerEosId: string;
  ReferredEosId: string;
  ReferrerDiscordId: string;
  ReferredDiscordId: string;
  ReferralCode: string;
  Status: string;
  ReferrerReward: number;
  ReferredReward: number;
  ReferrerRewarded: number;
  ReferredRewarded: number;
}

export interface ReferralStats extends RowDataPacket {
  pending: number;
  completed: number;
  pointsDistributed: number;
}

export interface ReferralLeaderboardEntry extends RowDataPacket {
  EosId: string;
  PlayerName: string;
  referralCount: number;
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
 * Finds a player record by their exact in-game player name.
 */
export async function getPlayerByPlayerName(playerName: string): Promise<VerifiedPlayer | null> {
  const [rows] = await pool.execute<VerifiedPlayer[]>(
    `SELECT * FROM \`${verTable}\` WHERE PlayerName = ?`,
    [playerName]
  );
  return rows.length > 0 ? rows[0] : null;
}

/**
 * Marks a player as verified and stores their Discord identity.
 * Returns true if a row was actually updated, false if no row exists
 * for that EosId (e.g. the C++ plugin hasn't created the record yet).
 */
export async function linkPlayer(
  eosId:       string,
  discordId:   string,
  discordName: string
): Promise<boolean> {
  const [result] = await pool.execute<ResultSetHeader>(
    `UPDATE \`${verTable}\` SET DiscordId = ?, DiscordName = ?, Verified = 1 WHERE EosId = ?`,
    [discordId, discordName, eosId]
  );
  return result.affectedRows > 0;
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
// Referral queries
// ─────────────────────────────────────────────────────────────

const REFERRAL_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateReferralCode(length: number): string {
  let code = '';
  for (let index = 0; index < length; index++) {
    code += REFERRAL_ALPHABET[Math.floor(Math.random() * REFERRAL_ALPHABET.length)];
  }
  return code;
}

/** Ensures one permanent referral code exists for a verified player. */
export async function ensureReferralCode(player: VerifiedPlayer): Promise<ReferralCode | null> {
  if (!config.referralSystem.enabled || player.Verified !== 1 || !player.DiscordId) return null;

  const table = referralCodesTable();
  const [existing] = await pool.execute<ReferralCode[]>(
    `SELECT EosId, DiscordId, ReferralCode FROM \`${table}\` WHERE EosId = ? LIMIT 1`, [player.EosId]
  );
  if (existing.length > 0) return existing[0];

  const length = Math.min(16, Math.max(6, config.referralSystem.referralCodeLength));
  for (let attempt = 0; attempt < 10; attempt++) {
    const referralCode = generateReferralCode(length);
    try {
      await pool.execute(
        `INSERT INTO \`${table}\` (EosId, DiscordId, ReferralCode, Active) VALUES (?, ?, ?, 1)`,
        [player.EosId, player.DiscordId, referralCode]
      );
      return { EosId: player.EosId, DiscordId: player.DiscordId, ReferralCode: referralCode } as ReferralCode;
    } catch (error) {
      const [afterConflict] = await pool.execute<ReferralCode[]>(
        `SELECT EosId, DiscordId, ReferralCode FROM \`${table}\` WHERE EosId = ? LIMIT 1`, [player.EosId]
      );
      if (afterConflict.length > 0) return afterConflict[0];
      if (attempt === 9) throw error;
    }
  }
  return null;
}

export async function ensureAllVerifiedReferralCodes(): Promise<number> {
  if (!config.referralSystem.enabled) return 0;
  const [players] = await pool.execute<VerifiedPlayer[]>(
    `SELECT * FROM \`${verTable}\` WHERE Verified = 1 AND DiscordId <> ''`
  );
  let createdOrConfirmed = 0;
  for (const player of players) {
    if (await ensureReferralCode(player)) createdOrConfirmed++;
  }
  return createdOrConfirmed;
}

export async function getReferralCodeByDiscordId(discordId: string): Promise<ReferralCode | null> {
  const [rows] = await pool.execute<ReferralCode[]>(
    `SELECT EosId, DiscordId, ReferralCode FROM \`${referralCodesTable()}\` WHERE DiscordId = ? AND Active = 1 LIMIT 1`, [discordId]
  );
  return rows[0] ?? null;
}

export async function getCompletedReferralCount(eosId: string): Promise<number> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS count FROM \`${referralsTable()}\` WHERE ReferrerEosId = ? AND Status = 'COMPLETED'`, [eosId]
  );
  return Number(rows[0]?.count ?? 0);
}

export async function getPendingReferrals(): Promise<Referral[]> {
  const [rows] = await pool.execute<Referral[]>(
    `SELECT * FROM \`${referralsTable()}\` WHERE Status = 'PENDING_REWARD' ORDER BY Id ASC LIMIT 100`
  );
  return rows;
}

export async function markReferralRewarded(referralId: number, side: 'referrer' | 'referred'): Promise<void> {
  const column = side === 'referrer' ? 'ReferrerRewarded' : 'ReferredRewarded';
  await pool.execute(`UPDATE \`${referralsTable()}\` SET \`${column}\` = 1 WHERE Id = ?`, [referralId]);
}

export async function completeReferralIfReady(referralId: number): Promise<boolean> {
  const [result] = await pool.execute<ResultSetHeader>(
    `UPDATE \`${referralsTable()}\`
     SET Status = 'COMPLETED', CompletedAt = UTC_TIMESTAMP()
     WHERE Id = ? AND Status = 'PENDING_REWARD' AND ReferrerRewarded = 1 AND ReferredRewarded = 1`, [referralId]
  );
  return result.affectedRows > 0;
}

export async function ensureReferralReward(
  referralId: number | null, eosId: string, rewardType: string, points: number, milestone: number | null, reference: string
): Promise<boolean> {
  const [result] = await pool.execute<ResultSetHeader>(
    `INSERT IGNORE INTO \`${rewardsTable()}\` (ReferralId, EosId, RewardType, Points, Milestone, TransactionReference)
     VALUES (?, ?, ?, ?, ?, ?)`, [referralId, eosId, rewardType, points, milestone, reference]
  );
  return result.affectedRows > 0;
}

export async function isReferralRewardProcessed(reference: string): Promise<boolean> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT Processed FROM \`${rewardsTable()}\` WHERE TransactionReference = ? LIMIT 1`, [reference]
  );
  return Number(rows[0]?.Processed ?? 0) === 1;
}

export async function markReferralRewardProcessed(reference: string): Promise<void> {
  await pool.execute(
    `UPDATE \`${rewardsTable()}\` SET Processed = 1, ProcessedAt = UTC_TIMESTAMP() WHERE TransactionReference = ?`, [reference]
  );
}

export async function getReferralStats(): Promise<ReferralStats> {
  const [rows] = await pool.execute<ReferralStats[]>(
    `SELECT
       SUM(Status = 'PENDING_REWARD') AS pending,
       SUM(Status = 'COMPLETED') AS completed,
       COALESCE((SELECT SUM(Points) FROM \`${rewardsTable()}\` WHERE Processed = 1), 0) AS pointsDistributed
     FROM \`${referralsTable()}\``
  );
  return rows[0] ?? { pending: 0, completed: 0, pointsDistributed: 0 } as ReferralStats;
}

export async function getReferralLeaderboard(limit = 10): Promise<ReferralLeaderboardEntry[]> {
  const [rows] = await pool.execute<ReferralLeaderboardEntry[]>(
    `SELECT r.ReferrerEosId AS EosId, COALESCE(v.PlayerName, r.ReferrerEosId) AS PlayerName, COUNT(*) AS referralCount
     FROM \`${referralsTable()}\` r
     LEFT JOIN \`${verTable}\` v ON v.EosId = r.ReferrerEosId
     WHERE r.Status = 'COMPLETED'
     GROUP BY r.ReferrerEosId, v.PlayerName
     ORDER BY referralCount DESC, PlayerName ASC LIMIT ?`, [limit]
  );
  return rows;
}

export async function getReferralById(id: number): Promise<Referral | null> {
  const [rows] = await pool.execute<Referral[]>(`SELECT * FROM \`${referralsTable()}\` WHERE Id = ? LIMIT 1`, [id]);
  return rows[0] ?? null;
}

export async function getReferralByEosId(eosId: string): Promise<Referral | null> {
  const [rows] = await pool.execute<Referral[]>(
    `SELECT * FROM \`${referralsTable()}\` WHERE ReferredEosId = ? OR ReferrerEosId = ? ORDER BY Id DESC LIMIT 1`, [eosId, eosId]
  );
  return rows[0] ?? null;
}

export async function invalidateReferral(id: number): Promise<boolean> {
  const [result] = await pool.execute<ResultSetHeader>(
    `UPDATE \`${referralsTable()}\` SET Status = 'CANCELLED' WHERE Id = ? AND Status <> 'COMPLETED'`, [id]
  );
  return result.affectedRows > 0;
}

export async function retryReferral(id: number): Promise<boolean> {
  const [result] = await pool.execute<ResultSetHeader>(
    `UPDATE \`${referralsTable()}\` SET Status = 'PENDING_REWARD' WHERE Id = ? AND Status IN ('REJECTED', 'CANCELLED')`, [id]
  );
  return result.affectedRows > 0;
}

export async function resetReferralCode(player: VerifiedPlayer): Promise<ReferralCode | null> {
  await pool.execute(`DELETE FROM \`${referralCodesTable()}\` WHERE EosId = ?`, [player.EosId]);
  return ensureReferralCode(player);
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
      `SELECT tribe_name, tribe_id, player_level, kills, dino_kill, death, death_all, wild_dino_kills, tames
       FROM players
       WHERE eos_id = ?`,
      [eosId]
    );
    return rows.length > 0 ? rows[0] : null;
  } catch {
    return null;
  }
}
