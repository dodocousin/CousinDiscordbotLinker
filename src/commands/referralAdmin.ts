import { ChatInputCommandInteraction, Colors, EmbedBuilder, GuildMember, MessageFlags, SlashCommandBuilder } from 'discord.js';
import config from '../config';
import { getPlayerByEosId, getReferralByEosId, invalidateReferral, resetReferralCode, retryReferral } from '../database';

export const data = new SlashCommandBuilder()
  .setName('referraladmin')
  .setDescription('Admin: manage referrals')
  .addSubcommand(sub => sub.setName('lookup').setDescription('Look up a referral by EOS ID').addStringOption(opt => opt.setName('eosid').setDescription('Player EOS ID').setRequired(true)))
  .addSubcommand(sub => sub.setName('invalidate').setDescription('Cancel an uncompleted referral').addIntegerOption(opt => opt.setName('id').setDescription('Referral ID').setRequired(true)))
  .addSubcommand(sub => sub.setName('code-reset').setDescription('Generate a new code for a verified player').addStringOption(opt => opt.setName('eosid').setDescription('Player EOS ID').setRequired(true)))
  .addSubcommand(sub => sub.setName('reward-retry').setDescription('Retry a cancelled or rejected referral').addIntegerOption(opt => opt.setName('id').setDescription('Referral ID').setRequired(true)));

function isAdmin(interaction: ChatInputCommandInteraction): boolean {
  const member = interaction.member;
  if (config.allowedAdminRoleIds.length === 0 || !member) return false;
  if (member instanceof GuildMember) return config.allowedAdminRoleIds.some(id => member.roles.cache.has(id));
  const roles = Array.isArray(member.roles) ? member.roles as string[] : [];
  return config.allowedAdminRoleIds.some(id => roles.includes(id));
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!isAdmin(interaction)) {
    await interaction.reply({ content: '❌ You do not have permission to use this command.', flags: MessageFlags.Ephemeral });
    return;
  }
  const sub = interaction.options.getSubcommand();
  if (sub === 'lookup') {
    const eosId = interaction.options.getString('eosid', true).trim();
    const referral = await getReferralByEosId(eosId);
    if (!referral) { await interaction.reply({ content: '❌ No referral found for that EOS ID.', flags: MessageFlags.Ephemeral }); return; }
    await interaction.reply({ embeds: [new EmbedBuilder().setColor(Colors.Blurple).setTitle(`Referral #${referral.Id}`).addFields(
      { name: 'Referrer EOS', value: referral.ReferrerEosId, inline: false }, { name: 'Referred EOS', value: referral.ReferredEosId, inline: false },
      { name: 'Code / Status', value: `${referral.ReferralCode} / ${referral.Status}`, inline: true }, { name: 'Rewards', value: `Referrer: ${referral.ReferrerRewarded ? '✅' : '⏳'} ${referral.ReferrerReward}\nNewcomer: ${referral.ReferredRewarded ? '✅' : '⏳'} ${referral.ReferredReward}`, inline: true },
    )], flags: MessageFlags.Ephemeral });
    return;
  }
  if (sub === 'invalidate') {
    const id = interaction.options.getInteger('id', true);
    const success = await invalidateReferral(id);
    await interaction.reply({ content: success ? `✅ Referral #${id} cancelled.` : `❌ Referral #${id} was not found or is already completed.`, flags: MessageFlags.Ephemeral });
    return;
  }
  if (sub === 'reward-retry') {
    const id = interaction.options.getInteger('id', true);
    const success = await retryReferral(id);
    await interaction.reply({ content: success ? `✅ Referral #${id} queued for retry.` : `❌ Referral #${id} cannot be retried in its current state.`, flags: MessageFlags.Ephemeral });
    return;
  }
  const eosId = interaction.options.getString('eosid', true).trim();
  const player = await getPlayerByEosId(eosId);
  if (!player || player.Verified !== 1) { await interaction.reply({ content: '❌ A verified player with that EOS ID was not found.', flags: MessageFlags.Ephemeral }); return; }
  const code = await resetReferralCode(player);
  await interaction.reply({ content: `✅ New referral code for **${player.PlayerName}**: \`${code?.ReferralCode ?? 'not created'}\``, flags: MessageFlags.Ephemeral });
}