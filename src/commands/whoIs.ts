import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  Colors,
  GuildMember,
  MessageFlags,
} from 'discord.js';
import {
  getPlayerByEosId,
  getPlayerByDiscordId,
  getPlayerByDiscordName,
  getPlayerLadderStats,
  LadderStats,
} from '../database';
import config from '../config';

export const data = new SlashCommandBuilder()
  .setName('whois')
  .setDescription('Admin: look up a player\'s linked accounts (restricted to admin roles)')
  .addSubcommand(sub =>
    sub
      .setName('eosid')
      .setDescription('Look up a player by their in-game EOS ID')
      .addStringOption(opt =>
        opt.setName('eosid')
          .setDescription('The player\'s EOS ID')
          .setRequired(true)
      )
  )
  .addSubcommand(sub =>
    sub
      .setName('discordname')
      .setDescription('Look up a player by their exact Discord username')
      .addStringOption(opt =>
        opt.setName('name')
          .setDescription('Exact Discord username (case-sensitive)')
          .setRequired(true)
      )
  )
  .addSubcommand(sub =>
    sub
      .setName('discordid')
      .setDescription('Look up a player by their Discord user ID')
      .addStringOption(opt =>
        opt.setName('id')
          .setDescription('The Discord user\'s snowflake ID')
          .setRequired(true)
      )
  );


// ─────────────────────────────────────────────────────────────
//  Role-gate helper
// ─────────────────────────────────────────────────────────────

function hasAdminRole(interaction: ChatInputCommandInteraction): boolean {
  if (config.allowedAdminRoleIds.length === 0) return false;

  const member = interaction.member;
  if (!member) return false;

  if (member instanceof GuildMember) {
    return config.allowedAdminRoleIds.some(roleId => member.roles.cache.has(roleId));
  }

  // Fallback: raw APIInteractionGuildMember — roles is string[]
  const roles = Array.isArray(member.roles) ? member.roles as string[] : [];
  return config.allowedAdminRoleIds.some(roleId => roles.includes(roleId));
}


// ─────────────────────────────────────────────────────────────
//  Embed builders
// ─────────────────────────────────────────────────────────────

function notFoundEmbed(label: string, value: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(Colors.Red)
    .setTitle('❌ No Record Found')
    .setDescription(`No entry was found in the database for ${label}: \`${value}\``);
}

function unlinkedEmbed(label: string, value: string, player: {
  PlayerName?: string;
  EosId?: string;
}): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(Colors.Yellow)
    .setTitle('⚠️ Player Found — Not Linked')
    .setDescription(`A record exists for ${label}: \`${value}\`, but the Discord account is **not linked**.`);

  if (player.PlayerName) embed.addFields({ name: '🎮 In-Game Name', value: player.PlayerName, inline: true });
  if (player.EosId)      embed.addFields({ name: '🔑 EOS ID',       value: player.EosId,       inline: false });

  return embed;
}

function linkedEmbed(
  player: { PlayerName: string; EosId: string; DiscordId: string; DiscordName: string },
  stats: LadderStats | null
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(Colors.Green)
    .setTitle('✅ Linked Account Found')
    .addFields(
      { name: '🎮 In-Game Name', value: player.PlayerName || '—',  inline: true  },
      { name: '💬 Discord Name', value: player.DiscordName || '—', inline: true  },
      { name: '🆔 Discord ID',   value: player.DiscordId  || '—', inline: false },
      { name: '🔑 EOS ID',       value: player.EosId      || '—', inline: false },
    )
    .setTimestamp();

  if (stats) {
    embed.addFields(
      { name: '\u200B', value: '**── Tribe & Stats ──**', inline: false },
      { name: '🏰 Tribe Name',   value: stats.tribe_name   != null ? String(stats.tribe_name)   : '—', inline: true  },
      { name: '🆔 Tribe ID',     value: stats.tribe_id     != null ? String(stats.tribe_id)     : '—', inline: true  },
      { name: '⚔️ Level',        value: stats.player_level != null ? String(stats.player_level) : '—', inline: true  },
      { name: '🗡️ Player Kills', value: stats.kills        != null ? String(stats.kills)        : '—', inline: true  },
      { name: '🦕 Dino Kills',   value: stats.dino_kill    != null ? String(stats.dino_kill)    : '—', inline: true  },
      { name: '💀 Deaths (PvP)', value: stats.death        != null ? String(stats.death)        : '—', inline: true  },
      { name: '☠️ Total Deaths', value: stats.death_all    != null ? String(stats.death_all)    : '—', inline: true  },
    );
  }

  return embed;
}


// ─────────────────────────────────────────────────────────────
//  Command handler
// ─────────────────────────────────────────────────────────────

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  // ── Channel restriction ────────────────────────────────────
  if (
    config.allowedChannelIds.length > 0 &&
    !config.allowedChannelIds.includes(interaction.channelId)
  ) {
    await interaction.reply({
      content: '❌ This command can only be used in the designated channel.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // ── Admin role check ─────────────────────────────────────
  if (!hasAdminRole(interaction)) {
    await interaction.reply({
      content: '❌ You do not have permission to use this command. It is restricted to admin roles.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const subcommand = interaction.options.getSubcommand();

  // ── /whois eosid ─────────────────────────────────────────
  if (subcommand === 'eosid') {
    const eosId = interaction.options.getString('eosid', true).trim();
    const player = await getPlayerByEosId(eosId);

    if (!player) {
      await interaction.reply({ embeds: [notFoundEmbed('EOS ID', eosId)], flags: MessageFlags.Ephemeral });
      return;
    }
    if (player.Verified !== 1) {
      await interaction.reply({
        embeds: [unlinkedEmbed('EOS ID', eosId, { PlayerName: player.PlayerName, EosId: player.EosId })],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const stats = await getPlayerLadderStats(player.EosId);
    await interaction.reply({ embeds: [linkedEmbed(player, stats)], flags: MessageFlags.Ephemeral });
    return;
  }

  // ── /whois discordname ────────────────────────────────────
  if (subcommand === 'discordname') {
    const name = interaction.options.getString('name', true).trim();
    const player = await getPlayerByDiscordName(name);

    if (!player) {
      await interaction.reply({ embeds: [notFoundEmbed('Discord name', name)], flags: MessageFlags.Ephemeral });
      return;
    }
    if (player.Verified !== 1) {
      await interaction.reply({
        embeds: [unlinkedEmbed('Discord name', name, { PlayerName: player.PlayerName, EosId: player.EosId })],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const stats = await getPlayerLadderStats(player.EosId);
    await interaction.reply({ embeds: [linkedEmbed(player, stats)], flags: MessageFlags.Ephemeral });
    return;
  }

  // ── /whois discordid ──────────────────────────────────────
  if (subcommand === 'discordid') {
    const discordId = interaction.options.getString('id', true).trim();
    const player = await getPlayerByDiscordId(discordId);

    if (!player) {
      await interaction.reply({ embeds: [notFoundEmbed('Discord ID', discordId)], flags: MessageFlags.Ephemeral });
      return;
    }
    if (player.Verified !== 1) {
      await interaction.reply({
        embeds: [unlinkedEmbed('Discord ID', discordId, { PlayerName: player.PlayerName, EosId: player.EosId })],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const stats = await getPlayerLadderStats(player.EosId);
    await interaction.reply({ embeds: [linkedEmbed(player, stats)], flags: MessageFlags.Ephemeral });
    return;
  }
}
