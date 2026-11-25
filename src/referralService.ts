import { Client, Colors, EmbedBuilder } from 'discord.js';
import config from './config';
import {
  completeReferralIfReady,
  ensureAllVerifiedReferralCodes,
  ensureReferralReward,
  getCompletedReferralCount,
  getPendingReferrals,
  getReferralLeaderboard,
  getReferralStats,
  isReferralRewardProcessed,
  markReferralRewarded,
  markReferralRewardProcessed,
} from './database';
import { addPoints } from './shopDb';

let intervalHandle: NodeJS.Timeout | null = null;
let workerInProgress = false;
let statusMessageId: string | null = null;

async function processReward(
  referralId: number | null, eosId: string, rewardType: string, points: number, milestone: number | null, reference: string
): Promise<void> {
  await ensureReferralReward(referralId, eosId, rewardType, points, milestone, reference);
  if (await isReferralRewardProcessed(reference)) return;

  // The shop database is separate from the linker database. This durable record
  // makes normal restarts recoverable; a crash after addPoints and before the
  // following mark leaves a possible duplicate window until the shop supports
  // a unique transaction reference.
  await addPoints(eosId, points);
  await markReferralRewardProcessed(reference);
}

async function processMilestones(client: Client, eosId: string, discordId: string): Promise<void> {
  const count = await getCompletedReferralCount(eosId);
  const milestones = [
    { count: 5, points: config.referralSystem.milestone5Points },
    { count: 10, points: config.referralSystem.milestone10Points },
    { count: 20, points: config.referralSystem.milestone20Points },
  ];

  for (const milestone of milestones) {
    if (count < milestone.count || milestone.points <= 0) continue;
    await processReward(null, eosId, `MILESTONE_${milestone.count}`, milestone.points, milestone.count, `milestone:${eosId}:${milestone.count}`);
  }

  if (count < 20 || !config.referralSystem.milestone20RoleId || !discordId) return;
  const guild = client.guilds.cache.get(config.guildId);
  if (!guild) return;
  const member = await guild.members.fetch(discordId).catch(() => null);
  if (member && !member.roles.cache.has(config.referralSystem.milestone20RoleId)) {
    await member.roles.add(config.referralSystem.milestone20RoleId, 'Completed 20 successful referrals').catch((error) => {
      console.error(`❌ Referral worker: unable to add milestone role to ${discordId}:`, error);
    });
  }
}

async function updateStatusMessage(client: Client): Promise<void> {
  if (!config.referralSystem.statusChannelId) return;
  const channel = await client.channels.fetch(config.referralSystem.statusChannelId).catch(() => null);
  if (!channel?.isTextBased() || !channel.isSendable()) return;
  const stats = await getReferralStats();
  const leaderboard = await getReferralLeaderboard(10);
  const topRecruiters = leaderboard.length === 0
    ? 'No completed referrals yet.'
    : leaderboard.map((entry, index) => `${index + 1}. **${entry.PlayerName}** — ${entry.referralCount}`).join('\n');
  const embed = new EmbedBuilder()
    .setColor(Colors.Blurple)
    .setTitle('🤝 ChezCousin Referral Program')
    .setDescription('Invite new survivors and earn Shop Points! Use `/referral me` to get your personal code.')
    .addFields(
      { name: '⏳ Pending Referrals', value: String(stats.pending ?? 0), inline: true },
      { name: '✅ Successful Referrals', value: String(stats.completed ?? 0), inline: true },
      { name: '💰 Points Distributed', value: String(stats.pointsDistributed ?? 0), inline: true },
      { name: '🏆 Top Recruiters', value: topRecruiters, inline: false },
      { name: '🎁 Standard Rewards', value: 'Recruiter: +500 points\nNew player: +250 points', inline: false },
    )
    .setTimestamp();

  if (statusMessageId) {
    const message = await channel.messages.fetch(statusMessageId).catch(() => null);
    if (message) {
      await message.edit({ embeds: [embed] });
      return;
    }
  }
  const message = await channel.send({ embeds: [embed] });
  statusMessageId = message.id;
}

async function runWorker(client: Client): Promise<void> {
  if (workerInProgress) return;
  workerInProgress = true;
  try {
    const pending = await getPendingReferrals();
    for (const referral of pending) {
      if (!referral.ReferrerRewarded) {
        await processReward(referral.Id, referral.ReferrerEosId, 'REFERRER', referral.ReferrerReward, null, `referral:${referral.Id}:referrer`);
        await markReferralRewarded(referral.Id, 'referrer');
      }
      if (!referral.ReferredRewarded) {
        await processReward(referral.Id, referral.ReferredEosId, 'REFERRED', referral.ReferredReward, null, `referral:${referral.Id}:referred`);
        await markReferralRewarded(referral.Id, 'referred');
      }
      if (await completeReferralIfReady(referral.Id)) {
        await processMilestones(client, referral.ReferrerEosId, referral.ReferrerDiscordId);
      }
    }
    await updateStatusMessage(client);
  } catch (error) {
    console.error('❌ Referral worker failed:', error);
  } finally {
    workerInProgress = false;
  }
}

export function startReferralSystem(client: Client): void {
  if (!config.referralSystem.enabled) {
    console.log('📌 Referral system disabled — skipping.');
    return;
  }
  if (intervalHandle) return;
  const seconds = Math.max(10, config.referralSystem.workerIntervalSeconds);
  console.log(`🤝 Referral system enabled — processing pending rewards every ${seconds}s.`);
  void ensureAllVerifiedReferralCodes().then((count) => console.log(`🤝 Referral code sweep confirmed ${count} verified account(s).`)).catch((error) => console.error('❌ Referral code sweep failed:', error));
  void runWorker(client);
  intervalHandle = setInterval(() => void runWorker(client), seconds * 1000);
}

export function stopReferralSystem(): void {
  if (intervalHandle) clearInterval(intervalHandle);
  intervalHandle = null;
}