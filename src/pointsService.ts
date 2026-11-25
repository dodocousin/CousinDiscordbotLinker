import { Client } from 'discord.js';
import config from './config';
import { getAllOnlinePlayers, sendChatToPlayers, ChatMessageJob } from './rcon';
import { addPoints } from './shopDb';
import { getPlayerByEosId } from './database';
import { withTimeout } from './utils';
import { logRewardCycle, RewardLogEntry } from './webhookLogger';


// ─────────────────────────────────────────────────────────────
//  Points system: rewards verified players who are simultaneously
//  online in-game (any ARK map) AND connected to a Discord voice
//  channel (excluding the guild's AFK channel).
// ─────────────────────────────────────────────────────────────

let intervalHandle: NodeJS.Timeout | null = null;
let cycleInProgress = false;

/** Timeout (ms) for individual DB/Discord API calls made per-player during a cycle. */
const PER_CALL_TIMEOUT_MS = 8000;

/**
 * Hard ceiling (ms) for an entire points cycle. If a cycle runs longer
 * than this — e.g. because some awaited call (DB query, Discord API
 * fetch) hangs forever despite the per-call timeouts below — this
 * watchdog forces `cycleInProgress` back to false so the recurring
 * timer can never get permanently wedged skipping every future tick.
 * This is a last-resort safety net; per-call timeouts should normally
 * make it unnecessary, but defense-in-depth here is cheap insurance
 * against the whole reward loop silently dying.
 */
const CYCLE_WATCHDOG_MS = 5 * 60_000;


/**
 * Runs a single award cycle:
 *   1. Query all ARK servers for currently online EOS IDs.
 *   2. For each online EOS ID, look up their verification record.
 *   3. Skip if not verified.
 *   4. Check if their linked Discord account is currently in a
 *      (non-AFK) voice channel in the configured guild.
 *   5. If so, award points and queue an in-game reward message.
 *   6. Send all queued reward messages, grouped per map, reusing a
 *      single RCON connection per map instead of reconnecting per player.
 */
async function runPointsCycleInner(client: Client): Promise<void> {
  const startedAt = new Date().toISOString();
  console.log(`🔎  [${startedAt}] Points cycle starting...`);

  const onlinePlayers = await getAllOnlinePlayers();
  console.log(`🔎  Points cycle: ${onlinePlayers.size} player(s) found online in-game across ${config.arkServers.length} map(s).`);

  if (onlinePlayers.size === 0) {
    console.log('🔎  Points cycle: no players online — nothing to check.');
    return;
  }

  const guild = client.guilds.cache.get(config.guildId);
  if (!guild) {
    console.error(`❌  Points cycle: guild ${config.guildId} not found in client cache. Is the bot actually in that guild, and does guildId in config.json match?`);
    return;
  }

  const afkChannelId = guild.afkChannelId;

  let verifiedCount  = 0;
  let inVoiceCount   = 0;
  let rewardedCount  = 0;

  // Reward messages to send, grouped by map so we can reuse one RCON
  // connection per map instead of reconnecting for every single player.
  const messagesByMap = new Map<string, ChatMessageJob[]>();

  // Collected for the optional Discord webhook reward log.
  const rewardLog: RewardLogEntry[] = [];


  for (const [eosId, mapName] of onlinePlayers) {
    let player;
    try {
      player = await withTimeout(
        getPlayerByEosId(eosId),
        PER_CALL_TIMEOUT_MS,
        `getPlayerByEosId(${eosId})`
      );
    } catch (err) {
      console.error(`❌  DB lookup timed out/failed for ${eosId} (map: ${mapName}), skipping this tick:`, err instanceof Error ? err.message : err);
      continue;
    }

    if (!player || player.Verified !== 1 || !player.DiscordId) {
      console.log(`ℹ️   Skipping ${eosId} (map: ${mapName}) — not verified / no linked Discord account.`);
      continue; // not verified — no points
    }
    verifiedCount++;

    // Prefer cache (fast), but fall back to an API fetch since the
    // member cache is not automatically fully populated just because
    // the GuildMembers intent is enabled — members are only cached as
    // they're observed via gateway events. Without this fallback,
    // genuinely online/verified players could be wrongly skipped.
    let member = guild.members.cache.get(player.DiscordId);
    if (!member) {
      try {
        member = await withTimeout(
          guild.members.fetch(player.DiscordId),
          PER_CALL_TIMEOUT_MS,
          `guild.members.fetch(${player.DiscordId})`
        );
      } catch {
        member = undefined;
      }
    }

    if (!member) {
      console.log(`ℹ️   Skipping ${player.PlayerName} (${eosId}) — DiscordId ${player.DiscordId} not found in this guild (left server, or invalid ID).`);
      continue;
    }


    const voiceChannelId = member.voice?.channelId ?? null;
    const isInVoice = voiceChannelId !== null && voiceChannelId !== afkChannelId;

    if (!isInVoice) {
      console.log(`ℹ️   Skipping ${player.PlayerName} (${eosId}) — not currently in a (non-AFK) voice channel.`);
      continue;
    }
    inVoiceCount++;

    const points = config.pointsSystem.pointsPerInterval;

    try {
      await withTimeout(
        addPoints(eosId, points),
        PER_CALL_TIMEOUT_MS,
        `addPoints(${eosId})`
      );
    } catch (dbErr) {
      console.error(`❌  Failed to add points for ${player.PlayerName} (${eosId}) to shop DB:`, dbErr instanceof Error ? dbErr.message : dbErr);
      continue;
    }

    rewardedCount++;
    console.log(`🏆  Rewarded ${player.PlayerName} (${eosId}) on map "${mapName}" with +${points} points (voice channel: ${voiceChannelId}).`);
    rewardLog.push({ playerName: player.PlayerName, mapName, points });

    const message = config.pointsSystem.rewardMessage.replace('{points}', String(points));
    const jobs = messagesByMap.get(mapName) ?? [];
    jobs.push({ eosId, playerName: player.PlayerName, message });
    messagesByMap.set(mapName, jobs);

  }

  // Send all queued reward messages, one RCON connection per map.
  let failedMessageCount = 0;
  for (const [mapName, jobs] of messagesByMap) {
    failedMessageCount += await sendChatToPlayers(mapName, jobs);
  }

  const summary =
    `${onlinePlayers.size} online, ${verifiedCount} verified, ${inVoiceCount} in voice, ` +
    `${rewardedCount} rewarded, ${failedMessageCount} reward message(s) failed to send.`;

  console.log(`🔎  Points cycle summary: ${summary}`);

  // Best-effort — never throws, never disrupts the cycle if it fails.
  await logRewardCycle(rewardLog, summary);
}


/**
 * Runs a single award cycle with re-entrancy protection AND a hard
 * watchdog timeout so the loop can never permanently wedge itself if
 * some awaited call inside hangs forever despite its own timeout.
 */
async function runPointsCycle(client: Client): Promise<void> {
  if (cycleInProgress) {
    console.warn('⚠️  Points cycle: previous cycle is still running — skipping this scheduled tick to avoid double-rewarding.');
    return;
  }
  cycleInProgress = true;

  try {
    await withTimeout(
      runPointsCycleInner(client),
      CYCLE_WATCHDOG_MS,
      'points cycle (watchdog)'
    );
  } catch (err) {
    console.error('❌  Error during points cycle:', err instanceof Error ? err.message : err);
  } finally {
    cycleInProgress = false;
  }
}



/**
 * Starts the recurring points-award loop if the points system is enabled
 * in config. Safe to call once at startup.
 */
export function startPointsSystem(client: Client): void {
  if (!config.pointsSystem.enabled) {
    console.log('📌  Points system disabled — skipping.');
    return;
  }

  if (config.arkServers.length === 0) {
    console.warn('⚠️  Points system enabled but no arkServers configured — skipping.');
    return;
  }

  if (intervalHandle) return; // already started

  const intervalMs = Math.max(1, config.pointsSystem.intervalMinutes) * 60_000;

  console.log(`🏆  Points system enabled — awarding ${config.pointsSystem.pointsPerInterval} pts every ${config.pointsSystem.intervalMinutes} min.`);

  // Run an initial cycle right away (helps confirm the system is working
  // without waiting for the first full interval), then repeat on schedule.
  void runPointsCycle(client);

  intervalHandle = setInterval(() => {
    void runPointsCycle(client);
  }, intervalMs);

}

export function stopPointsSystem(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
