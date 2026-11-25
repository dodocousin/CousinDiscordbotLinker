import { ChatInputCommandInteraction, Colors, EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import config from '../config';
import { ensureReferralCode, getCompletedReferralCount, getPlayerByDiscordId, getReferralLeaderboard } from '../database';

export const data = new SlashCommandBuilder()
  .setName('referral')
  .setDescription('Get your referral code or view the recruiter leaderboard')
  .addSubcommand(sub => sub.setName('me').setDescription('Show your personal referral code and progress'))
  .addSubcommand(sub => sub.setName('leaderboard').setDescription('Show successful referral leaders'));

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!config.referralSystem.enabled) {
    await interaction.reply({ content: '❌ The referral system is currently disabled.', flags: MessageFlags.Ephemeral });
    return;
  }
  if (config.allowedChannelIds.length > 0 && !config.allowedChannelIds.includes(interaction.channelId)) {
    await interaction.reply({ content: '❌ This command can only be used in the designated verification channel.', flags: MessageFlags.Ephemeral });
    return;
  }

  if (interaction.options.getSubcommand() === 'leaderboard') {
    const entries = await getReferralLeaderboard(10);
    const text = entries.length === 0 ? 'No completed referrals yet.' : entries.map((entry, index) => `${index + 1}. **${entry.PlayerName}** — ${entry.referralCount}`).join('\n');
    await interaction.reply({ embeds: [new EmbedBuilder().setColor(Colors.Blurple).setTitle('🏆 Referral Leaderboard').setDescription(text).setTimestamp()] });
    return;
  }

  const player = await getPlayerByDiscordId(interaction.user.id);
  if (!player || player.Verified !== 1) {
    await interaction.reply({ content: '❌ Link your Discord account with `/verify` before using the referral program.', flags: MessageFlags.Ephemeral });
    return;
  }
  const code = await ensureReferralCode(player);
  const completed = await getCompletedReferralCount(player.EosId);
  const nextMilestone = [5, 10, 20].find(value => value > completed);
  await interaction.reply({
    embeds: [new EmbedBuilder()
      .setColor(Colors.Green)
      .setTitle('🤝 Your Referral Code')
      .setDescription(`Give **${code?.ReferralCode ?? '—'}** to a new survivor. They must enter \`/refer ${code?.ReferralCode ?? 'CODE'}\` in-game within 24 hours of their first connection.`)
      .addFields(
        { name: 'Recruiter reward', value: '+500 Shop Points per successful referral', inline: true },
        { name: 'New player reward', value: '+250 Shop Points', inline: true },
        { name: 'Successful referrals', value: String(completed), inline: true },
        { name: 'Next milestone', value: nextMilestone ? `${completed} / ${nextMilestone}` : 'All milestones completed', inline: false },
      )
      .setTimestamp()],
    flags: MessageFlags.Ephemeral,
  });
}