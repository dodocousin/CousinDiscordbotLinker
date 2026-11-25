import mysql from 'mysql2/promise';
import config from './config';

// ─────────────────────────────────────────────────────────────
//  Shop DB pool (separate database used by the shop system)
// ─────────────────────────────────────────────────────────────
//
//  Expected table schema (already exists per user):
//    eosId  VARCHAR(...)  PRIMARY KEY / UNIQUE
//    points INT           NOT NULL DEFAULT 0
// ─────────────────────────────────────────────────────────────

let shopPool: mysql.Pool | null = null;

function getPool(): mysql.Pool {
  if (!shopPool) {
    shopPool = mysql.createPool({
      host:                config.shopDatabase.host,
      port:                config.shopDatabase.port,
      user:                config.shopDatabase.user,
      password:            config.shopDatabase.password,
      database:            config.shopDatabase.database,
      waitForConnections:  true,
      connectionLimit:     5,
      queueLimit:          0,
      connectTimeout:      10000,
      // See database.ts for rationale — prevents zombie idle connections
      // from silently hanging future queries.
      enableKeepAlive:        true,
      keepAliveInitialDelay:  10000,
    });


  }
  return shopPool;
}

const shopTable = () => config.shopDatabase.table;

/**
 * Adds points to a player's shop balance, identified by their EOS ID.
 * Uses an upsert since `eosId` is a PRIMARY/UNIQUE key on the shop table:
 *   - If the row exists, increments `points`.
 *   - If not, creates a new row starting with `points`.
 */
export async function addPoints(eosId: string, points: number): Promise<void> {
  const pool  = getPool();
  const table = shopTable();

  await pool.execute(
    `INSERT INTO \`${table}\` (eosId, points) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE points = points + VALUES(points)`,
    [eosId, points]
  );
}
