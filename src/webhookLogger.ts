import { WebhookClient, EmbedBuilder, Colors } from 'discord.js';
import config from './config';

// ─────────────────────────────────────────────────────────────
//  Optional Discord webhook logger for the points/reward system.
//  Posts a summary embed listing every player rewarded during a
//  points cycle. Fully optional — controlled by
//  `rewardLogWebhook.enabled` / `rewardLogWebhook.url` in config.json.
// ─────────────────────────────────────────────────────────────

export interface RewardLogEntry {
  playerName: string;
  mapName:    string;
  points:     number;
}

let webhookClient: WebhookClient | null = null;
let attemptedInit = false;

/**
 * Lazily creates the WebhookClient the first time it's needed.
 * Returns null (and logs once) if the feature is disabled or misconfigured.
 */
function getWebhookClient(): WebhookClient | null {
  if (!config.rewardLogWebhook?.enabled) return null;

  if (!attemptedInit) {
    attemptedInit = true;
    if (!config.rewardLogWebhook.url) {
      console.error('❌  rewardLogWebhook.enabled is true but rewardLogWebhook.url is empty — reward log webhook disabled.');
      return null;
    }
    try {
      webhookClient = new WebhookClient({ url: config.rewardLogWebhook.url });
    } catch (err) {
      console.error('❌  Failed to initialize reward log webhook client (check rewardLogWebhook.url):', err instanceof Error ? err.message : err);
      webhookClient = null;
    }
  }

  return webhookClient;
}

/**
 * Posts a reward-cycle summary to the configured Discord webhook, if
 * enabled. Never throws — logs and swallows any failure so a webhook
 * outage/misconfiguration can never disrupt the points cycle itself.
 *
 * If `rewards` is empty, nothing is sent (avoids spamming the channel
 * with "0 rewarded" messages every cycle).
 */
export async function logRewardCycle(
  rewards: RewardLogEntry[],
  summary: string
): Promise<void> {
  if (rewards.length === 0) return;

  const client = getWebhookClient();
  if (!client) return;

  const lines = rewards.map(
    (r) => `🏆 Rewarded **${r.playerName}** on map **${r.mapName}** with **+${r.points}** points`
  );

  // Discord embed descriptions are capped at 4096 characters. On a very
  // busy cycle with many rewards, truncate gracefully instead of letting
  // the send fail outright.
  let description = lines.join('\n');
  const MAX_DESCRIPTION_LENGTH = 4000; // leave a little headroom below the 4096 hard cap
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    const omitted = rewards.length - lines.findIndex((_, i) =>
      lines.slice(0, i + 1).join('\n').length > MAX_DESCRIPTION_LENGTH
    );
    description = description.slice(0, MAX_DESCRIPTION_LENGTH) + `\n… (truncated, ${omitted} more not shown)`;
  }

  const embed = new EmbedBuilder()
    .setColor(Colors.Gold)
    .setTitle('🏆 Points Cycle Rewards')
    .setDescription(description)
    .addFields({ name: 'Summary', value: summary })
    .setTimestamp();

  try {
    await client.send({ embeds: [embed] });
  } catch (err) {
    console.error('❌  Failed to send reward log webhook message:', err instanceof Error ? err.message : err);
  }
}
