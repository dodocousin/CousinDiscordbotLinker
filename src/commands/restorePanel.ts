import {
  ChatInputCommandInteraction,
  GuildMember,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import config from '../config';
import { buildRestorePanel, isCharacterRestoreEnabled } from '../characterRestore';

export const data = new SlashCommandBuilder()
  .setName('restorepanel')
  .setDescription('Admin : publie le panneau "Restaurer mon personnage" dans ce salon');

function isAdmin(interaction: ChatInputCommandInteraction): boolean {
  const member = interaction.member;
  if (config.allowedAdminRoleIds.length === 0 || !member) return false;
  if (member instanceof GuildMember) return config.allowedAdminRoleIds.some(id => member.roles.cache.has(id));
  const roles = Array.isArray(member.roles) ? member.roles as string[] : [];
  return config.allowedAdminRoleIds.some(id => roles.includes(id));
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!isAdmin(interaction)) {
    await interaction.reply({ content: '❌ Tu n\'as pas la permission d\'utiliser cette commande.', flags: MessageFlags.Ephemeral });
    return;
  }

  if (!isCharacterRestoreEnabled()) {
    await interaction.reply({
      content: '❌ La restauration de personnage n\'est pas activée. Configure la section `characterRestore` de `config.json` (enabled, managerUrl, apiKey) puis redémarre le bot.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const channel = interaction.channel;
  if (!channel || !channel.isSendable()) {
    await interaction.reply({ content: '❌ Je ne peux pas écrire dans ce salon. Vérifie mes permissions.', flags: MessageFlags.Ephemeral });
    return;
  }

  // Check the bot's effective permissions in this channel first, so the
  // admin is told exactly what is missing.
  if ('permissionsFor' in channel && interaction.guild?.members.me) {
    const perms = channel.permissionsFor(interaction.guild.members.me);
    const needed: Array<[bigint, string]> = [
      [PermissionFlagsBits.ViewChannel,  'Voir le salon'],
      [channel.isThread() ? PermissionFlagsBits.SendMessagesInThreads : PermissionFlagsBits.SendMessages,
        channel.isThread() ? 'Envoyer des messages dans les fils' : 'Envoyer des messages'],
      [PermissionFlagsBits.EmbedLinks,   'Intégrer des liens'],
    ];
    const missing = needed.filter(([flag]) => !perms?.has(flag)).map(([, label]) => `**${label}**`);
    if (missing.length) {
      await interaction.reply({
        content: `❌ Il manque au bot ces permissions dans ce salon : ${missing.join(', ')}.\n` +
                 'Ajoute-les au rôle du bot dans les paramètres du salon (ou de sa catégorie), puis réessaie.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
  }

  try {
    await channel.send(buildRestorePanel());
  } catch (err) {
    console.error('❌  /restorepanel: failed to post panel:', err);
    const code = (err as { code?: unknown })?.code;
    const message = err instanceof Error ? err.message : String(err);
    await interaction.reply({
      content: '❌ Impossible de publier le panneau ici.\n' +
               `Erreur Discord : \`${code ?? '?'}\` — ${message.slice(0, 300)}`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.reply({ content: '✅ Panneau de restauration publié dans ce salon.', flags: MessageFlags.Ephemeral });
}
