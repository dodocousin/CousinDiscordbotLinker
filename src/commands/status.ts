import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  Colors,
  MessageFlags,
} from 'discord.js';
import { getPlayerByDiscordId } from '../database';
import config from '../config';

export const data = new SlashCommandBuilder()
  .setName('status')
  .setDescription('Check if your Discord account is linked to an in-game ARK identity');

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

  // ── Not linked ─────────────────────────────────────────────
  if (!player || player.Verified !== 1) {
    const embed = new EmbedBuilder()
      .setColor(Colors.Red)
      .setTitle('❌ Not Linked')
      .setDescription(
        'Your Discord account is **not currently linked** to any in-game account.\n\n' +
        'Log into the server — you will receive a verification code.\n' +
        'Then come back here and use `/verify <code>`.'
      );
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    return;
  }

  // ── Linked ─────────────────────────────────────────────────
  const embed = new EmbedBuilder()
    .setColor(Colors.Green)
    .setTitle('✅ Account Linked')
    .setDescription('Your Discord account is linked to an in-game identity.')
    .addFields(
      { name: '🎮 In-Game Name', value: player.PlayerName,  inline: true  },
      { name: '💬 Discord',      value: player.DiscordName, inline: true  },
      { name: '🔑 EOS ID',       value: player.EosId,       inline: false },
    )
    .setTimestamp()
    .setFooter({ text: 'To remove this link, use /unlink' });

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}
