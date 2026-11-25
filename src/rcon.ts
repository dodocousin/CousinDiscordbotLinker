import { Rcon } from 'rcon-client';
import config from './config';
import { withTimeout } from './utils';

// ─────────────────────────────────────────────────────────────
//  ARK: Survival Ascended RCON helpers
// ─────────────────────────────────────────────────────────────
//
//  `Listplayers` returns lines shaped like:
//    0. K?VRA, 00027a0497f9495bbc0230fccaef48a2
//    1. Hectarok, 0002b215e99f47d092025ef0049ca341
//
//  We only care about the EOS ID (the long hex string after the comma).
// ─────────────────────────────────────────────────────────────

export interface OnlinePlayer {
  eosId:   string;
  mapName: string;
}

/** Matches "<index>. <name>, <eosId>" — captures the EOS id (hex string). */
const LISTPLAYERS_LINE = /^\s*\d+\.\s*.*?,\s*([0-9a-fA-F]{16,})\s*$/;

/** Hard timeout (ms) for the whole connect+command sequence to a single server. */
const RCON_HARD_TIMEOUT_MS = 5000;

/**
 * Closes an Rcon connection, but never waits more than a couple seconds.
 * `rcon.end()` sends a FIN and waits for the socket's "close" event —
 * which can hang forever if the remote server doesn't cooperate with a
 * clean half-close (common with game server RCON implementations).
 * If it doesn't close in time, we forcibly destroy the socket instead.
 */
async function endWithHardTimeout(rcon: Rcon, label: string): Promise<void> {
  await withTimeout(
    rcon.end(),
    2000,
    `end() on ${label}`,
    () => {
      try {
        rcon.socket?.destroy();
      } catch {
        // ignore
      }
    }
  ).catch(() => null); // never throw — closing is best-effort
}

/**
 * Creates an Rcon instance and connects it, forcibly destroying the
 * underlying socket if the connection doesn't complete within the
 * hard timeout. This is more aggressive than rcon-client's own
 * `timeout` option (which only guards command/auth round-trips, not
 * the initial TCP handshake) and is needed because a stalled Windows
 * TCP connection attempt can otherwise block Node's event loop well
 * past any plain JS-level `setTimeout`.
 */
async function connectWithHardTimeout(server: {
  ip: string;
  port: number;
  password: string;
}): Promise<Rcon> {
  const rcon = new Rcon({
    host:     server.ip,
    port:     server.port,
    password: server.password,
    timeout:  RCON_HARD_TIMEOUT_MS,
  });

  // rcon-client re-emits socket-level errors (e.g. ECONNRESET) as an
  // 'error' event on its own EventEmitter. If nobody listens for it,
  // Node.js treats it as an unhandled error and crashes the entire
  // process. Attaching a listener here — even just to log — prevents
  // a single flaky RCON socket from taking down the whole bot.
  rcon.on('error', (err) => {
    console.error(`⚠️  RCON socket error on "${server.ip}:${server.port}":`, err instanceof Error ? err.message : err);
  });

  await withTimeout(

    rcon.connect(),
    RCON_HARD_TIMEOUT_MS,
    `connect to ${server.ip}:${server.port}`,
    () => {
      // Force-abandon the stuck connection attempt so it can't linger
      // and keep blocking the event loop / holding a socket open.
      try {
        rcon.socket?.destroy();
      } catch {
        // ignore
      }
    }
  );

  return rcon;
}

/**
 * Connects to a single map's RCON, runs Listplayers, and returns the
 * set of EOS IDs currently online on that map.
 * Never throws — logs and returns an empty array on any failure.
 * Guaranteed to resolve within ~RCON_HARD_TIMEOUT_MS even if the
 * underlying TCP connection hangs (unreachable host, firewalled port, etc.).
 */
async function getOnlinePlayersForServer(server: {
  mapName: string;
  ip: string;
  port: number;
  password: string;
}): Promise<OnlinePlayer[]> {
  console.log(`🔌  Attempting RCON connect to "${server.mapName}" (${server.ip}:${server.port})...`);
  let rcon: Rcon | null = null;
  try {
    rcon = await connectWithHardTimeout(server);
    console.log(`✅  RCON connected to "${server.mapName}" — sending Listplayers...`);

    const response = await withTimeout(
      rcon.send('Listplayers'),
      RCON_HARD_TIMEOUT_MS,
      `Listplayers on "${server.mapName}" (${server.ip}:${server.port})`,
      () => {
        try {
          rcon?.socket?.destroy();
        } catch {
          // ignore
        }
      }
    );

    const players: OnlinePlayer[] = [];

    for (const line of response.split('\n')) {
      const match = LISTPLAYERS_LINE.exec(line.trim());
      if (match) {
        players.push({ eosId: match[1].toLowerCase(), mapName: server.mapName });
      }
    }

    console.log(`✅  "${server.mapName}": ${players.length} player(s) online.`);
    return players;
  } catch (err) {
    console.error(`❌  RCON error on map "${server.mapName}" (${server.ip}:${server.port}):`, err instanceof Error ? err.message : err);
    return [];
  } finally {
    if (rcon) {
      await endWithHardTimeout(rcon, `"${server.mapName}" (${server.ip}:${server.port})`);
    }
  }
}


/**
 * Queries all configured ARK servers in parallel and returns a map of
 * EOS ID -> map name the player was found on. If a player is somehow
 * found on multiple maps, the first one encountered wins.
 *
 * Each server query is independently timeout-guarded, so a single
 * unreachable/misconfigured map can never block or hang the whole cycle.
 */
export async function getAllOnlinePlayers(): Promise<Map<string, string>> {
  const results = await Promise.all(
    config.arkServers.map((server) => getOnlinePlayersForServer(server))
  );

  const onlineMap = new Map<string, string>();
  for (const players of results) {
    for (const { eosId, mapName } of players) {
      if (!onlineMap.has(eosId)) {
        onlineMap.set(eosId, mapName);
      }
    }
  }

  return onlineMap;
}

/**
 * Builds a safe `ServerChatTo <eosid> <message>` command string.
 * Using the EOS ID (instead of the in-game/Steam display name, which
 * `ServerChatToPlayer` requires and does NOT match what's stored in the
 * verification DB) sidesteps name-matching entirely — no quoting,
 * trimming, or escaping needed for the identifier since EOS IDs are
 * already validated as pure hex when parsed from `Listplayers`. The
 * message is still quoted/sanitized since it's free text that can
 * contain spaces.
 */
function buildChatCommand(eosId: string, message: string): string {
  const safeMessage = message.trim().replace(/["\\]/g, '');
  return `ServerChatTo ${eosId} "${safeMessage}"`;
}

/**
 * Sends an in-game chat message to a specific player (identified by EOS
 * ID) on a specific map via `ServerChatTo <eosid> <message>`.
 * Never throws — logs and swallows errors so the points loop keeps running.
 * Guaranteed to resolve within ~RCON_HARD_TIMEOUT_MS.
 *
 * NOTE: for sending multiple messages to the same map (e.g. rewarding
 * several players in one points cycle), prefer `sendChatToPlayers()`
 * below, which reuses a single RCON connection instead of reconnecting
 * once per message.
 */
export async function sendChatToPlayer(mapName: string, eosId: string, message: string): Promise<void> {
  const server = config.arkServers.find((s) => s.mapName === mapName);
  if (!server) {
    console.error(`❌  Cannot send chat message: unknown map "${mapName}"`);
    return;
  }

  let rcon: Rcon | null = null;
  try {
    rcon = await connectWithHardTimeout(server);

    await withTimeout(
      rcon.send(buildChatCommand(eosId, message)),
      RCON_HARD_TIMEOUT_MS,
      `ServerChatTo on "${mapName}" (${server.ip}:${server.port})`,
      () => {
        try {
          rcon?.socket?.destroy();
        } catch {
          // ignore
        }
      }
    );
  } catch (err) {
    console.error(`❌  Failed to send chat message to EOS ID "${eosId}" on map "${mapName}":`, err instanceof Error ? err.message : err);
  } finally {
    if (rcon) {
      await endWithHardTimeout(rcon, `"${mapName}" (${server.ip}:${server.port})`);
    }
  }
}

export interface ChatMessageJob {
  eosId:      string;
  playerName: string; // kept only for logging
  message:    string;
}


/**
 * Sends multiple in-game chat messages to a single map, reusing ONE
 * RCON connection for all of them instead of reconnecting per message.
 * This significantly reduces the number of connection attempts during
 * a points cycle (which is the most failure-prone part of talking to
 * ARK's RCON), and retries each individual send once before giving up.
 *
 * Never throws. Returns the number of messages that failed to send
 * after retrying, so callers can log/telemetry it.
 */
export async function sendChatToPlayers(mapName: string, jobs: ChatMessageJob[]): Promise<number> {
  if (jobs.length === 0) return 0;

  const server = config.arkServers.find((s) => s.mapName === mapName);
  if (!server) {
    console.error(`❌  Cannot send chat messages: unknown map "${mapName}"`);
    return jobs.length;
  }

  let rcon: Rcon | null = null;
  let failedCount = 0;

  try {
    rcon = await connectWithHardTimeout(server);

    for (const job of jobs) {
      const command = buildChatCommand(job.eosId, job.message);
      let sent = false;


      // Try up to 2 times (1 retry) per message before giving up —
      // a single dropped send on a shared connection shouldn't doom
      // every other player's message in the same cycle.
      for (let attempt = 1; attempt <= 2 && !sent; attempt++) {
        try {
          const response = await withTimeout(
            rcon.send(command),
            RCON_HARD_TIMEOUT_MS,
            `ServerChatTo (attempt ${attempt}) on "${mapName}" (${server.ip}:${server.port})`,

            () => {
              try {
                rcon?.socket?.destroy();
              } catch {
                // ignore
              }
            }
          );
          console.log(`📨  Sent reward message to "${job.playerName}" on "${mapName}" (attempt ${attempt}). Response: ${JSON.stringify(response)}`);
          sent = true;
        } catch (err) {
          console.error(`❌  Attempt ${attempt} failed sending chat message to "${job.playerName}" on map "${mapName}":`, err instanceof Error ? err.message : err);

          // The connection may have died (e.g. socket destroyed by the
          // timeout handler above). If a retry is still available,
          // reconnect before trying again.
          if (attempt < 2) {
            try {
              await endWithHardTimeout(rcon, `"${mapName}" (${server.ip}:${server.port}) [reconnect before retry]`);
              rcon = await connectWithHardTimeout(server);
            } catch (reconnectErr) {
              console.error(`❌  Failed to reconnect to "${mapName}" for retry:`, reconnectErr instanceof Error ? reconnectErr.message : reconnectErr);
              break; // no point retrying without a connection
            }
          }
        }
      }

      if (!sent) {
        failedCount++;
      }
    }
  } catch (err) {
    console.error(`❌  RCON connection error while sending batch chat messages on map "${mapName}":`, err instanceof Error ? err.message : err);
    failedCount = jobs.length; // couldn't even connect — treat all as failed
  } finally {
    if (rcon) {
      await endWithHardTimeout(rcon, `"${mapName}" (${server.ip}:${server.port})`);
    }
  }

  return failedCount;
}
