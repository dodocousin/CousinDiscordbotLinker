import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  Colors,
  MessageFlags,
} from 'discord.js';
import { getPlayerByDiscordId, unlinkPlayer } from '../database';
import config from '../config';

export const data = new SlashCommandBuilder()
  .setName('unlink')
  .setDescription('Unlink your Discord account from your ARK in-game identity');

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  // ── Channel restriction ────────────────────────────────────
  if (
    config.allowedChannelIds.length > 0 &&
    !config.allowedChannelIds.includes(interaction.channelId)
  ) {
    await interaction.reply({
      content: '❌ This command can only be used in the designated verification channel.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const player = await getPlayerByDiscordId(interaction.user.id);

  // ── Not currently linked ───────────────────────────────────
  if (!player || player.Verified !== 1) {
    const embed = new EmbedBuilder()
      .setColor(Colors.Yellow)
      .setTitle('⚠️ Not Linked')
      .setDescription("Your Discord account isn't linked to any in-game account, so there is nothing to unlink.");
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    return;
  }

  // ── Unlink ─────────────────────────────────────────────────
  const success = await unlinkPlayer(interaction.user.id);

  if (success) {
    const embed = new EmbedBuilder()
      .setColor(Colors.Orange)
      .setTitle('🔓 Account Unlinked')
      .setDescription(
        `Your Discord has been unlinked from in-game player **${player.PlayerName}**.\n\n` +
        `The next time you log into the server you will receive a new verification code.\n` +
        `Use \`/verify <code>\` here to re-link your account.`
      )
      .addFields({ name: '🎮 Was Linked To', value: player.PlayerName, inline: true })
      .setTimestamp();
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  } else {
    await interaction.reply({
      content: '❌ Failed to unlink your account. Please try again or contact a server admin.',
      flags: MessageFlags.Ephemeral,
    });
  }
}
