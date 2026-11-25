// ─────────────────────────────────────────────────────────────
//  Character restore (Restauration de personnage)
//
//  A public panel (posted with /restorepanel) has one button. A player
//  who clicks it can restore THEIR OWN character from the newest profile
//  backup made by Cousin Server Manager, on the map they choose:
//
//    button → pick map → see newest backup date → confirm → restore
//
//  Security:
//   • The EOS ID always comes from the verification table, looked up with
//     the Discord ID of the user who clicked. It is never typed by the user
//     and never stored in a button, so nobody can restore someone else.
//   • The link is checked again right before the restore.
//   • One restore at a time per character + a configurable cooldown.
//   • The exact backup the player saw (timestamp) is the one restored.
//
//  Every reply is ephemeral (only the clicking player sees it).
// ─────────────────────────────────────────────────────────────

import fs from 'fs';
import path from 'path';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  Client,
  Colors,
  EmbedBuilder,
  MessageFlags,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import config from './config';
import { getPlayerByDiscordId, VerifiedPlayer } from './database';
import * as api from './csmApi';
import { CsmApiError, CsmPlayerBackup, CsmServer } from './csmApi';

// ── Custom IDs ───────────────────────────────────────────────

const PREFIX     = 'csmrestore:';
const ID_START   = `${PREFIX}start`;
const ID_MAP     = `${PREFIX}map`;
const ID_CONFIRM = `${PREFIX}confirm`;   // csmrestore:confirm:<serverId>:<timestamp>
const ID_CANCEL  = `${PREFIX}cancel`;

export function isCharacterRestoreInteraction(customId: string): boolean {
  return customId.startsWith(PREFIX);
}

// ── Config helpers ───────────────────────────────────────────

export function isCharacterRestoreEnabled(): boolean {
  const cfg = config.characterRestore;
  return !!(cfg && cfg.enabled && cfg.managerUrl && cfg.apiKey);
}

function cooldownMs(): number {
  const minutes = Number(config.characterRestore?.cooldownMinutes);
  return Number.isFinite(minutes) && minutes > 0 ? minutes * 60_000 : 0;
}

// ── Cooldown store (data/character-restore-cooldowns.json) ───
//  Keyed by EOS ID (the character), value = last successful restore (ms).

const DATA_DIR      = path.join(__dirname, '..', 'data');
const COOLDOWN_FILE = path.join(DATA_DIR, 'character-restore-cooldowns.json');
let cooldowns: Record<string, number> | null = null;

function loadCooldowns(): Record<string, number> {
  if (cooldowns) return cooldowns;
  try {
    const parsed = JSON.parse(fs.readFileSync(COOLDOWN_FILE, 'utf8'));
    cooldowns = parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    cooldowns = {};
  }
  return cooldowns!;
}

function saveCooldowns(): void {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${COOLDOWN_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(cooldowns ?? {}, null, 2));
    fs.renameSync(tmp, COOLDOWN_FILE);
  } catch (err) {
    console.error('❌  Character restore: could not save cooldowns:', err instanceof Error ? err.message : err);
  }
}

function remainingCooldownMs(eosId: string): number {
  const last = loadCooldowns()[eosId];
  if (!last) return 0;
  return Math.max(0, last + cooldownMs() - Date.now());
}

function markRestored(eosId: string): void {
  const store = loadCooldowns();
  const now = Date.now();
  store[eosId] = now;
  // Drop entries that are no longer on cooldown so the file stays small.
  for (const [id, ts] of Object.entries(store)) {
    if (ts + cooldownMs() < now) delete store[id];
  }
  saveCooldowns();
}

/** Characters currently being restored (prevents double clicks / parallel restores). */
const inFlight = new Set<string>();

// ── Formatting helpers ───────────────────────────────────────

const TS_RE = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/;

/** Backup timestamps are in the manager PC's local time (the bot runs on the same PC). */
function backupDate(ts: string): Date | null {
  const m = TS_RE.exec(ts);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
}

/** Plain text, for places where Discord timestamps don't render (menu options). */
function formatBackupPlain(ts: string): string {
  const m = TS_RE.exec(ts);
  return m ? `${m[3]}/${m[2]}/${m[1]} à ${m[4]}:${m[5]}` : ts;
}

/** Discord timestamp: shown in each player's own time zone and language. */
function formatBackupRich(ts: string): string {
  const d = backupDate(ts);
  if (!d) return ts;
  const unix = Math.floor(d.getTime() / 1000);
  return `<t:${unix}:F> (<t:${unix}:R>)`;
}

function formatDuration(ms: number): string {
  const totalMinutes = Math.max(1, Math.ceil(ms / 60_000));
  const days    = Math.floor(totalMinutes / 1440);
  const hours   = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const parts: string[] = [];
  if (days)    parts.push(`${days} jour${days > 1 ? 's' : ''}`);
  if (hours)   parts.push(`${hours} heure${hours > 1 ? 's' : ''}`);
  if (minutes) parts.push(`${minutes} minute${minutes > 1 ? 's' : ''}`);
  return parts.join(' ');
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function newestBackup(backups: CsmPlayerBackup[], eosId: string): CsmPlayerBackup | null {
  const wanted = eosId.toLowerCase();
  const sorted = backups
    .filter(b => b.eosId.toLowerCase() === wanted && TS_RE.test(b.timestamp))
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return sorted[0] ?? null;
}

// ── Embeds ───────────────────────────────────────────────────

function simpleEmbed(color: number, title: string, description: string): EmbedBuilder {
  return new EmbedBuilder().setColor(color).setTitle(title).setDescription(description);
}

function notLinkedEmbed(): EmbedBuilder {
  return simpleEmbed(Colors.Red, '❌ Compte non lié',
    'Ton compte Discord n\'est **pas lié** à un compte en jeu, donc le bot ne peut pas savoir quel personnage restaurer.\n\n' +
    '**Pour lier ton compte :**\n' +
    '1. Connecte-toi au serveur ARK : un code de vérification t\'est donné en jeu.\n' +
    '2. Utilise la commande `/verify <code>` ici sur Discord.\n' +
    '3. Reviens ensuite cliquer sur **Restaurer mon personnage**.');
}

function disabledEmbed(): EmbedBuilder {
  return simpleEmbed(Colors.Grey, '⏸️ Service désactivé',
    'La restauration de personnage est désactivée pour le moment. Contacte un administrateur si tu as besoin d\'aide.');
}

function cooldownEmbed(waitMs: number): EmbedBuilder {
  return simpleEmbed(Colors.Orange, '⏳ Patiente encore un peu',
    `Tu as déjà restauré ton personnage récemment.\n\n` +
    `Tu pourras refaire une restauration dans **${formatDuration(waitMs)}**.\n` +
    `Limite : une restauration toutes les **${formatDuration(cooldownMs())}**.`);
}

/** Problems the player can't fix themselves (configuration, manager down…). */
const ADMIN_SIDE_CODES = new Set([
  'missing_api_key', 'invalid_api_key', 'api_key_revoked', 'api_key_expired', 'too_many_failed_attempts',
  'license_required', 'api_access_denied', 'key_owner_unavailable', 'insufficient_scope', 'https_required',
  'not_found', 'invalid_request', 'invalid_json', 'internal_error', 'restore_failed',
  'unreachable', 'timeout', 'bad_response', 'unknown_error',
]);

function isAdminSideError(err: unknown): boolean {
  return !(err instanceof CsmApiError) || ADMIN_SIDE_CODES.has(err.code);
}

function errorEmbed(err: unknown): EmbedBuilder {
  const code = err instanceof CsmApiError ? err.code : 'unexpected';
  let title = '❌ Restauration impossible';
  let text: string;

  switch (code) {
    case 'player_online':
      title = '🎮 Tu es encore connecté';
      text = 'Ton personnage est **connecté sur cette carte**. La restauration ne peut se faire que lorsque tu es **complètement déconnecté**.\n\n' +
             '1. Quitte le jeu (retour au menu principal ou ferme ARK).\n' +
             '2. Attends environ **1 minute**.\n' +
             '3. Recommence en cliquant à nouveau sur **Restaurer mon personnage**.';
      break;
    case 'cannot_verify_offline':
      text = 'Le serveur de cette carte n\'a pas répondu quand le bot a vérifié que tu étais déconnecté. ' +
             'Pour ta sécurité, rien n\'a été modifié.\n\nRéessaie dans quelques minutes.';
      break;
    case 'invalid_state':
      text = 'Cette carte est en train de **démarrer, s\'arrêter ou se mettre à jour**. Rien n\'a été modifié.\n\n' +
             'Réessaie dans quelques minutes, quand la carte sera en ligne (ou complètement arrêtée).';
      break;
    case 'operation_in_progress':
    case 'backup_in_progress':
      text = 'Une opération est en cours sur cette carte (sauvegarde, redémarrage, mise à jour…). Rien n\'a été modifié.\n\n' +
             'Réessaie dans quelques minutes.';
      break;
    case 'backup_not_found':
      text = 'Aucune sauvegarde de ton personnage n\'a été trouvée sur cette carte (elle a peut-être été supprimée entre-temps). ' +
             'Rien n\'a été modifié.\n\nRecommence et choisis une autre carte, ou contacte un administrateur.';
      break;
    case 'server_not_found':
      text = 'Cette carte n\'est plus disponible pour la restauration. Rien n\'a été modifié.\n\nRecommence depuis le bouton du panneau.';
      break;
    case 'rate_limited':
      text = 'Le service reçoit beaucoup de demandes en ce moment. Rien n\'a été modifié.\n\nRéessaie dans une minute.';
      break;
    default:
      title = '⚠️ Service temporairement indisponible';
      text = 'Le service de restauration ne répond pas correctement pour le moment. Rien n\'a été modifié.\n\n' +
             'Réessaie plus tard. Si le problème continue, contacte un administrateur.';
  }

  return simpleEmbed(Colors.Red, title, text).setFooter({ text: `Code : ${code}` });
}

// ── Public panel (posted by /restorepanel) ───────────────────

export function buildRestorePanel() {
  const cooldown = cooldownMs();
  const limitLine = cooldown > 0
    ? `• Limite : **une restauration toutes les ${formatDuration(cooldown)}**.\n`
    : '';

  const embed = new EmbedBuilder()
    .setColor(Colors.Blurple)
    .setTitle('🧬 Restauration de personnage')
    .setDescription(
      'Ton personnage est **corrompu** ou tu n\'arrives **plus à te connecter** à ton survivant ? ' +
      'Ce bouton remet ton personnage tel qu\'il était lors de la **dernière sauvegarde** de la carte que tu choisis.'
    )
    .addFields(
      {
        name: '✅ Ce qui est restauré',
        value:
          '• Ton personnage (ton survivant)\n' +
          '• Ton niveau et ton expérience\n' +
          '• Tes engrammes\n' +
          '• Tes succès de boss',
      },
      {
        name: '❌ Ce qui n\'est PAS restauré',
        value:
          '• L\'inventaire de ton personnage (objets, armes, armures, ressources)\n' +
          '• Tes dinos, tes structures et le contenu de tes coffres',
      },
      {
        name: '📋 Comment faire',
        value:
          '1. **Déconnecte-toi complètement du jeu** (obligatoire).\n' +
          '2. Clique sur **Restaurer mon personnage** ci-dessous.\n' +
          '3. Choisis la **carte** où ton personnage doit être restauré.\n' +
          '4. Vérifie la **date de la sauvegarde** puis clique sur **Confirmer**.\n' +
          '5. Attends le message ✅ puis reconnecte-toi sur cette carte.',
      },
      {
        name: '⚠️ À savoir',
        value:
          '• Ton compte Discord doit être **lié** à ton compte en jeu (`/verify`).\n' +
          '• Tu peux seulement restaurer **ton propre** personnage.\n' +
          '• La restauration **remplace** ton personnage actuel sur la carte choisie : ' +
          'ce que tu as gagné depuis la sauvegarde (niveaux, engrammes) sera perdu.\n' +
          limitLine +
          '• Seules les cartes où une sauvegarde de ton personnage existe te seront proposées.',
      },
    )
    .setFooter({ text: 'Les réponses du bot sont privées : toi seul peux les voir.' });

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(ID_START)
      .setLabel('Restaurer mon personnage')
      .setEmoji('🧬')
      .setStyle(ButtonStyle.Primary),
  );

  return { embeds: [embed], components: [row] };
}

// ── Lookups ──────────────────────────────────────────────────

async function getLinkedPlayer(discordId: string): Promise<VerifiedPlayer | null> {
  const player = await getPlayerByDiscordId(discordId);
  return player && player.Verified === 1 && player.EosId ? player : null;
}

interface MapChoice { server: CsmServer; backup: CsmPlayerBackup }

/** Every map (visible to the API key) that has at least one backup for this player. */
async function findMapsWithBackups(eosId: string): Promise<MapChoice[]> {
  const servers = await api.listServers();
  const results = await Promise.allSettled(
    servers.map(async (server) => {
      const backup = newestBackup(await api.listPlayerBackups(server.id, eosId), eosId);
      return backup ? { server, backup } : null;
    }),
  );

  const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
  if (servers.length > 0 && failures.length === servers.length) throw failures[0].reason;
  for (const f of failures) {
    console.warn('⚠️  Character restore: could not list backups on one map:', f.reason instanceof Error ? f.reason.message : f.reason);
  }

  return results
    .filter((r): r is PromiseFulfilledResult<MapChoice | null> => r.status === 'fulfilled')
    .map(r => r.value)
    .filter((c): c is MapChoice => c !== null)
    .sort((a, b) => a.server.name.localeCompare(b.server.name, 'fr'));
}

// ── Admin log ────────────────────────────────────────────────

async function sendAdminLog(client: Client, embed: EmbedBuilder): Promise<void> {
  const channelId = config.characterRestore?.adminLogChannelId;
  if (!channelId) return;
  try {
    const channel = await client.channels.fetch(channelId);
    if (channel && channel.isSendable()) {
      await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
    } else {
      console.error(`❌  Character restore: admin log channel ${channelId} not found or not writable.`);
    }
  } catch (err) {
    console.error('❌  Character restore: failed to send admin log:', err instanceof Error ? err.message : err);
  }
}

function adminLogEmbed(
  ok: boolean,
  user: { id: string; username: string },
  player: VerifiedPlayer,
  mapName: string,
  timestamp: string,
  err?: unknown,
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(ok ? Colors.Green : Colors.Red)
    .setTitle(ok ? '🧬 Personnage restauré' : '🧬 Échec de restauration de personnage')
    .addFields(
      { name: 'Discord',    value: `<@${user.id}> (${user.username})`, inline: true },
      { name: 'Personnage', value: player.PlayerName || '—',          inline: true },
      { name: 'Carte',      value: mapName,                            inline: true },
      { name: 'EOS ID',     value: `\`${player.EosId}\``,             inline: false },
      { name: 'Sauvegarde', value: formatBackupRich(timestamp),        inline: false },
    )
    .setTimestamp();

  if (!ok) {
    const code = err instanceof CsmApiError ? err.code : 'unexpected';
    const message = err instanceof Error ? err.message : String(err);
    embed.addFields({ name: 'Erreur', value: truncate(`\`${code}\` — ${message}`, 1000), inline: false });
  }
  return embed;
}

// ── Steps ────────────────────────────────────────────────────

/** Step 1 — button on the public panel → pick a map. */
async function handleStart(interaction: ButtonInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (!isCharacterRestoreEnabled()) {
    await interaction.editReply({ embeds: [disabledEmbed()] });
    return;
  }

  const player = await getLinkedPlayer(interaction.user.id);
  if (!player) {
    await interaction.editReply({ embeds: [notLinkedEmbed()] });
    return;
  }

  const wait = remainingCooldownMs(player.EosId);
  if (wait > 0) {
    await interaction.editReply({ embeds: [cooldownEmbed(wait)] });
    return;
  }

  let choices: MapChoice[];
  try {
    choices = await findMapsWithBackups(player.EosId);
  } catch (err) {
    reportApiProblem(interaction.client, err, 'listing maps');
    await interaction.editReply({ embeds: [errorEmbed(err)] });
    return;
  }

  if (choices.length === 0) {
    await interaction.editReply({
      embeds: [simpleEmbed(Colors.Orange, '📭 Aucune sauvegarde trouvée',
        `Aucune sauvegarde du personnage **${player.PlayerName}** n'a été trouvée sur nos cartes.\n\n` +
        'Les sauvegardes sont faites automatiquement pendant que tu joues. Si tu viens d\'arriver sur le serveur, ' +
        'il n\'y en a peut-être pas encore. Contacte un administrateur si tu as besoin d\'aide.')],
    });
    return;
  }

  const menu = new StringSelectMenuBuilder()
    .setCustomId(ID_MAP)
    .setPlaceholder('Choisis la carte…')
    .addOptions(
      choices.slice(0, 25).map(c =>
        new StringSelectMenuOptionBuilder()
          .setLabel(truncate(c.server.name || c.server.map || c.server.id, 100))
          .setDescription(truncate(`Dernière sauvegarde : ${formatBackupPlain(c.backup.timestamp)}`, 100))
          .setValue(c.server.id)
          .setEmoji('🗺️'),
      ),
    );

  await interaction.editReply({
    embeds: [simpleEmbed(Colors.Blurple, '🗺️ Choisis la carte',
      `Personnage : **${player.PlayerName}**\n\n` +
      'Sur quelle carte veux-tu restaurer ton personnage ?\n' +
      'Seules les cartes où une sauvegarde de ton personnage existe sont affichées.\n\n' +
      '*Rien ne sera modifié avant que tu cliques sur **Confirmer** à l\'étape suivante.*')],
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)],
  });
}

/** Step 2 — map chosen → show the newest backup and ask for confirmation. */
async function handleMapSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  await interaction.deferUpdate();

  const player = await getLinkedPlayer(interaction.user.id);
  if (!player) {
    await interaction.editReply({ embeds: [notLinkedEmbed()], components: [] });
    return;
  }

  const serverId = interaction.values[0];
  let server: CsmServer | undefined;
  let backup: CsmPlayerBackup | null = null;
  try {
    server = (await api.listServers()).find(s => s.id === serverId);
    if (server) backup = newestBackup(await api.listPlayerBackups(server.id, player.EosId), player.EosId);
  } catch (err) {
    reportApiProblem(interaction.client, err, 'loading backup');
    await interaction.editReply({ embeds: [errorEmbed(err)], components: [] });
    return;
  }

  if (!server) {
    await interaction.editReply({ embeds: [errorEmbed(new CsmApiError('server_not_found', 'Server not visible', 404))], components: [] });
    return;
  }
  if (!backup) {
    await interaction.editReply({ embeds: [errorEmbed(new CsmApiError('backup_not_found', 'No backup', 404))], components: [] });
    return;
  }

  const confirmId = `${ID_CONFIRM}:${server.id}:${backup.timestamp}`;
  if (confirmId.length > 100) {
    throw new Error(`Character restore: custom id too long for server id ${server.id}`);
  }

  const embed = new EmbedBuilder()
    .setColor(Colors.Orange)
    .setTitle('⚠️ Confirme la restauration')
    .setDescription('Vérifie les informations ci-dessous avant de confirmer.')
    .addFields(
      { name: '🎮 Personnage',          value: player.PlayerName || '—',            inline: true },
      { name: '🗺️ Carte',               value: server.name,                         inline: true },
      { name: '💾 Sauvegarde utilisée', value: formatBackupRich(backup.timestamp),  inline: false },
      {
        name: 'Ce qui va se passer',
        value:
          `Ton personnage sur **${server.name}** sera remplacé par celui de cette sauvegarde ` +
          '(niveau, expérience, engrammes et succès de boss).\n' +
          '• Ce que tu as gagné **depuis** cette sauvegarde sera perdu.\n' +
          '• Ton **inventaire n\'est pas restauré**.\n' +
          '• Tu dois être **déconnecté du jeu** pendant la restauration.',
      },
    )
    .setFooter({ text: 'Cette action ne peut pas être annulée.' });

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(confirmId).setLabel('Confirmer la restauration').setEmoji('✅').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(ID_CANCEL).setLabel('Annuler').setStyle(ButtonStyle.Secondary),
  );

  await interaction.editReply({ embeds: [embed], components: [row] });
}

/** Step 3 — confirmed → restore. */
async function handleConfirm(interaction: ButtonInteraction, serverId: string, timestamp: string): Promise<void> {
  await interaction.deferUpdate();

  const player = await getLinkedPlayer(interaction.user.id);
  if (!player) {
    await interaction.editReply({ embeds: [notLinkedEmbed()], components: [] });
    return;
  }

  const wait = remainingCooldownMs(player.EosId);
  if (wait > 0) {
    await interaction.editReply({ embeds: [cooldownEmbed(wait)], components: [] });
    return;
  }

  if (inFlight.has(player.EosId)) {
    await interaction.editReply({
      embeds: [simpleEmbed(Colors.Orange, '⏳ Restauration déjà en cours', 'Une restauration de ton personnage est déjà en cours. Attends le résultat.')],
      components: [],
    });
    return;
  }

  inFlight.add(player.EosId);
  let mapName = serverId;
  try {
    await interaction.editReply({
      embeds: [simpleEmbed(Colors.Blurple, '⏳ Restauration en cours…', 'Ne te connecte pas au jeu pendant ce temps. Cela prend généralement quelques secondes.')],
      components: [],
    });

    try {
      const server = (await api.listServers()).find(s => s.id === serverId);
      if (server) mapName = server.name;
    } catch {
      // Name is cosmetic; the restore call below reports real problems.
    }

    const result = await api.restorePlayer(serverId, player.EosId, timestamp);
    markRestored(player.EosId);

    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(Colors.Green)
        .setTitle('✅ Personnage restauré !')
        .setDescription(
          `Ton personnage **${player.PlayerName}** a été restauré sur **${mapName}**.\n\n` +
          'Tu peux maintenant te reconnecter sur cette carte.\n' +
          'Si quelque chose ne va pas, contacte un administrateur.')
        .addFields({ name: '💾 Sauvegarde utilisée', value: formatBackupRich(result.timestamp || timestamp) })
        .setTimestamp()],
      components: [],
    });

    console.log(`🧬  Character restored: ${player.PlayerName} (${player.EosId}) on ${mapName} from ${timestamp} — requested by ${interaction.user.username} (${interaction.user.id})`);
    await sendAdminLog(interaction.client, adminLogEmbed(true, interaction.user, player, mapName, result.timestamp || timestamp));
  } catch (err) {
    console.error(`❌  Character restore failed for ${player.PlayerName} (${player.EosId}) on ${mapName}:`, err instanceof Error ? err.message : err);
    await interaction.editReply({ embeds: [errorEmbed(err)], components: [] }).catch(() => null);
    await sendAdminLog(interaction.client, adminLogEmbed(false, interaction.user, player, mapName, timestamp, err));
  } finally {
    inFlight.delete(player.EosId);
  }
}

async function handleCancel(interaction: ButtonInteraction): Promise<void> {
  await interaction.update({
    embeds: [simpleEmbed(Colors.Grey, 'Restauration annulée', 'Rien n\'a été modifié. Tu peux fermer ce message.')],
    components: [],
  });
}

// ── Problems the admins should know about (bad key, manager down…) ──

let lastProblemReport = 0;

function reportApiProblem(client: Client, err: unknown, context: string): void {
  if (!isAdminSideError(err)) return;
  const code = err instanceof CsmApiError ? err.code : 'unexpected';
  const message = err instanceof Error ? err.message : String(err);
  console.error(`❌  Character restore (${context}): ${code} — ${message}`);

  // At most one admin-channel alert every 10 minutes.
  if (Date.now() - lastProblemReport < 10 * 60_000) return;
  lastProblemReport = Date.now();
  void sendAdminLog(client, new EmbedBuilder()
    .setColor(Colors.Red)
    .setTitle('⚠️ Restauration de personnage : problème avec Server Manager')
    .setDescription(truncate(`Contexte : ${context}\n\`${code}\` — ${message}`, 4000))
    .setTimestamp());
}

// ── Router ───────────────────────────────────────────────────

export async function handleCharacterRestoreComponent(
  interaction: ButtonInteraction | StringSelectMenuInteraction,
): Promise<void> {
  const id = interaction.customId;

  if (interaction.isButton()) {
    if (id === ID_START)  return handleStart(interaction);
    if (id === ID_CANCEL) return handleCancel(interaction);
    if (id.startsWith(`${ID_CONFIRM}:`)) {
      const rest = id.slice(ID_CONFIRM.length + 1);
      const sep = rest.lastIndexOf(':');
      const serverId  = sep > 0 ? rest.slice(0, sep) : '';
      const timestamp = sep > 0 ? rest.slice(sep + 1) : '';
      if (!serverId || !TS_RE.test(timestamp)) {
        await interaction.reply({ content: '❌ Bouton invalide. Recommence depuis le panneau.', flags: MessageFlags.Ephemeral });
        return;
      }
      return handleConfirm(interaction, serverId, timestamp);
    }
  } else if (interaction.isStringSelectMenu() && id === ID_MAP) {
    return handleMapSelect(interaction);
  }

  console.warn(`⚠️  Character restore: unknown component id ${id}`);
}

// ── Startup check ────────────────────────────────────────────

/** Logs whether the Server Manager can be reached with the configured key. */
export async function checkCharacterRestoreSetup(): Promise<void> {
  if (!isCharacterRestoreEnabled()) {
    console.log('🧬  Character restore: disabled.');
    return;
  }
  try {
    const me = await api.getMe();
    const missing = ['read', 'restore'].filter(s => !me.key.scopes.includes(s));
    if (missing.length) {
      console.error(`❌  Character restore: API key "${me.key.name}" is missing scope(s): ${missing.join(', ')}.`);
    } else {
      console.log(`🧬  Character restore: connected to Server Manager ${me.managerVersion} with key "${me.key.name}". Cooldown: ${cooldownMs() > 0 ? formatDuration(cooldownMs()) : 'none'}.`);
    }
    if (me.key.expiresAt) console.log(`🧬  Character restore: API key expires ${me.key.expiresAt}.`);
  } catch (err) {
    const code = err instanceof CsmApiError ? err.code : 'unexpected';
    console.error(`❌  Character restore: cannot use Server Manager API (${code}): ${err instanceof Error ? err.message : err}`);
  }
  if (!config.characterRestore?.adminLogChannelId) {
    console.warn('⚠️  Character restore: adminLogChannelId is empty — restores will not be logged to Discord.');
  }
}
