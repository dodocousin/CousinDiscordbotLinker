import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  Colors,
  MessageFlags,
} from 'discord.js';
import {
  getCodeEntry,
  getPlayerByDiscordId,
  getPlayerByEosId,
  linkPlayer,
  deleteCode,
} from '../database';
import config from '../config';

export const data = new SlashCommandBuilder()
  .setName('verify')
  .setDescription('Link your Discord account to your ARK: Survival Ascended in-game identity')
  .addStringOption(option =>
    option
      .setName('code')
      .setDescription('The verification code shown to you in-game')
      .setRequired(true)
      .setMinLength(4)
      .setMaxLength(12)
  );

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

  const code        = interaction.options.getString('code', true).toUpperCase().trim();
  const discordId   = interaction.user.id;
  const discordName = interaction.user.username;

  // ── Check if this Discord account is already linked ────────
  const existing = await getPlayerByDiscordId(discordId);
  if (existing && existing.Verified === 1) {
    const embed = new EmbedBuilder()
      .setColor(Colors.Yellow)
      .setTitle('⚠️ Already Linked')
      .setDescription(
        `Your Discord is already linked to in-game player **${existing.PlayerName}**.\n\n` +
        `If you want to switch to a different in-game account, use \`/unlink\` first and then log into the server to get a new code.`
      )
      .addFields({ name: 'Linked In-Game Name', value: existing.PlayerName, inline: true });
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    return;
  }

  // ── Look up the code in the pending codes table ────────────
  const codeEntry = await getCodeEntry(code);
  if (!codeEntry) {
    const embed = new EmbedBuilder()
      .setColor(Colors.Red)
      .setTitle('❌ Invalid or Expired Code')
      .setDescription(
        'The code you entered is **invalid or has expired**.\n\n' +
        'Log into the server again to receive a fresh code, then try again here.'
      );
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    return;
  }

  // ── Check if this in-game account is already linked to a different Discord ──
  const existingByEos = await getPlayerByEosId(codeEntry.EosId);
  if (existingByEos && existingByEos.Verified === 1 && existingByEos.DiscordId !== discordId) {
    const embed = new EmbedBuilder()
      .setColor(Colors.Red)
      .setTitle('❌ In-Game Account Already Linked')
      .setDescription(
        `The in-game account **${codeEntry.PlayerName}** is already linked to a different Discord account.\n\n` +
        `Contact a server admin if you believe this is an error.`
      );
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    return;
  }

  // ── All checks passed – link the account ──────────────────
  await linkPlayer(codeEntry.EosId, discordId, discordName);
  await deleteCode(code);

  const embed = new EmbedBuilder()
    .setColor(Colors.Green)
    .setTitle('✅ Account Linked Successfully!')
    .setDescription(
      `Your Discord account has been linked to in-game player **${codeEntry.PlayerName}**.\n\n` +
      `You can now play on the server without being kicked. Welcome!`
    )
    .addFields(
      { name: '🎮 In-Game Name', value: codeEntry.PlayerName, inline: true },
      { name: '💬 Discord',      value: discordName,           inline: true },
    )
    .setTimestamp();

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}
