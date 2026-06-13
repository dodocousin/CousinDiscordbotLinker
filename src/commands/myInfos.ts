import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  Colors,
  MessageFlags,
} from 'discord.js';
import { getPlayerByDiscordId, getPlayerLadderStats } from '../database';
import config from '../config';

export const data = new SlashCommandBuilder()
  .setName('myinfos')
  .setDescription('Show your linked in-game account info and stats');

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
        'Then use `/verify <code>` to link your account.'
      );
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    return;
  }

  // ── Build base embed ───────────────────────────────────────
  const embed = new EmbedBuilder()
    .setColor(Colors.Green)
    .setTitle('📋 My Account Info')
    .setDescription('Here is the information linked to your Discord account.')
    .addFields(
      { name: '🎮 In-Game Name', value: player.PlayerName  || '—', inline: true  },
      { name: '💬 Discord',      value: player.DiscordName || '—', inline: true  },
      { name: '🔑 EOS ID',       value: player.EosId       || '—', inline: false },
    )
    .setTimestamp()
    .setFooter({ text: 'To remove this link, use /unlink' });

  // ── Fetch TribeLadder stats (if enabled) ───────────────────
  const stats = await getPlayerLadderStats(player.EosId);

  if (stats) {
    embed.addFields(
      { name: '\u200B', value: '**── Tribe & Stats ──**', inline: false },
      { name: '🏰 Tribe Name',    value: stats.tribe_name   != null ? String(stats.tribe_name)   : '—', inline: true  },
      { name: '🆔 Tribe ID',      value: stats.tribe_id     != null ? String(stats.tribe_id)     : '—', inline: true  },
      { name: '⚔️ Level',         value: stats.player_level != null ? String(stats.player_level) : '—', inline: true  },
      { name: '🗡️ Player Kills',  value: stats.kills        != null ? String(stats.kills)        : '—', inline: true  },
      { name: '🦕 Dino Kills',    value: stats.dino_kill    != null ? String(stats.dino_kill)    : '—', inline: true  },
      { name: '💀 Deaths (PvP)',  value: stats.death        != null ? String(stats.death)        : '—', inline: true  },
      { name: '☠️ Total Deaths',  value: stats.death_all    != null ? String(stats.death_all)    : '—', inline: true  },
    );
  }

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}
