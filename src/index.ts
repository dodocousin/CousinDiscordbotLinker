import {
  Client,
  Collection,
  Events,
  GatewayIntentBits,
  Interaction,
  ChatInputCommandInteraction,
  MessageFlags,
} from 'discord.js';
import * as verify  from './commands/verify';
import * as myInfos from './commands/myInfos';
import * as unlink  from './commands/unlink';
import * as whoIs   from './commands/whoIs';
import * as referral from './commands/referral';
import * as referralAdmin from './commands/referralAdmin';
import * as restorePanel from './commands/restorePanel';
import config from './config';
import { startPointsSystem } from './pointsService';
import { startReferralSystem } from './referralService';
import {
  checkCharacterRestoreSetup,
  handleCharacterRestoreComponent,
  isCharacterRestoreInteraction,
} from './characterRestore';

// ─────────────────────────────────────────────────────────────
//  Validate config on startup
// ─────────────────────────────────────────────────────────────

if (!config.token) {
  console.error('❌  config.json: token is empty. Bot cannot start.');
  process.exit(1);
}
if (!config.clientId) {
  console.error('❌  config.json: clientId is empty. Bot cannot start.');
  process.exit(1);
}
if (!config.guildId) {
  console.error('❌  config.json: guildId is empty. Bot cannot start.');
  process.exit(1);
}
if (!config.database.host || !config.database.user || !config.database.database) {
  console.error('❌  config.json: database connection settings are incomplete.');
  process.exit(1);
}
if (config.tribeLadderDB.enabled &&
    (!config.tribeLadderDB.host || !config.tribeLadderDB.user || !config.tribeLadderDB.database)) {
  console.error('❌  config.json: tribeLadderDB.enabled is true but connection settings are incomplete.');
  process.exit(1);
}
if (config.pointsSystem.enabled || config.referralSystem.enabled) {
  if (!config.shopDatabase.host || !config.shopDatabase.user || !config.shopDatabase.database || !config.shopDatabase.table) {
    console.error('❌  config.json: pointsSystem.enabled or referralSystem.enabled is true but shopDatabase settings are incomplete.');
    process.exit(1);
  }
}
if (config.pointsSystem.enabled) {
  if (!Array.isArray(config.arkServers) || config.arkServers.length === 0) {
    console.error('❌  config.json: pointsSystem.enabled is true but arkServers is empty.');
    process.exit(1);
  }
  for (const server of config.arkServers) {
    if (!server.mapName || !server.ip || !server.port || !server.password) {
      console.error(`❌  config.json: arkServers entry is incomplete (missing mapName/ip/port/password): ${JSON.stringify(server)}`);
      process.exit(1);
    }
  }
  if (!config.pointsSystem.pointsPerInterval || config.pointsSystem.pointsPerInterval <= 0) {
    console.error('❌  config.json: pointsSystem.pointsPerInterval must be a positive number.');
    process.exit(1);
  }
  if (!config.pointsSystem.intervalMinutes || config.pointsSystem.intervalMinutes <= 0) {
    console.error('❌  config.json: pointsSystem.intervalMinutes must be a positive number.');
    process.exit(1);
  }
}
if (config.rewardLogWebhook?.enabled && !config.rewardLogWebhook.url) {
  console.error('❌  config.json: rewardLogWebhook.enabled is true but rewardLogWebhook.url is empty.');
  process.exit(1);
}
if (config.characterRestore?.enabled) {
  const cr = config.characterRestore;
  if (!cr.managerUrl || !/^https?:\/\//i.test(cr.managerUrl)) {
    console.error('❌  config.json: characterRestore.managerUrl must start with http:// or https:// (e.g. http://localhost:4000).');
    process.exit(1);
  }
  if (!cr.apiKey || !cr.apiKey.startsWith('csm_')) {
    console.error('❌  config.json: characterRestore.apiKey is empty or invalid (it must start with csm_).');
    process.exit(1);
  }
  if (cr.cooldownMinutes !== undefined && (typeof cr.cooldownMinutes !== 'number' || cr.cooldownMinutes < 0)) {
    console.error('❌  config.json: characterRestore.cooldownMinutes must be a number >= 0 (0 = no limit).');
    process.exit(1);
  }
}



// ─────────────────────────────────────────────────────────────
//  Command interface
// ─────────────────────────────────────────────────────────────

interface Command {
  data:    { name: string; toJSON(): unknown };
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
}

// ─────────────────────────────────────────────────────────────
//  Build command registry
// ─────────────────────────────────────────────────────────────

const commands = new Collection<string, Command>();
commands.set(verify.data.name,  verify);
commands.set(myInfos.data.name, myInfos);
commands.set(unlink.data.name,  unlink);
commands.set(whoIs.data.name,   whoIs);
commands.set(referral.data.name, referral);
commands.set(referralAdmin.data.name, referralAdmin);
commands.set(restorePanel.data.name, restorePanel);

// ─────────────────────────────────────────────────────────────
//  Create Discord client
//  We only need the Guilds intent for slash commands.
// ─────────────────────────────────────────────────────────────

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers,
  ],
});

client.once(Events.ClientReady, (readyClient) => {
  console.log(`✅  Bot ready! Logged in as ${readyClient.user.tag}`);
  if (config.allowedChannelIds.length > 0) {
    console.log(`📌  Allowed channels: ${config.allowedChannelIds.join(', ')}`);
  } else {
    console.log('📌  No channel restriction – commands work everywhere.');
  }

  startPointsSystem(readyClient);
  startReferralSystem(readyClient);
  void checkCharacterRestoreSetup();
});


// ─────────────────────────────────────────────────────────────
//  Handle interactions
// ─────────────────────────────────────────────────────────────

client.on(Events.InteractionCreate, async (interaction: Interaction) => {
  // ── Buttons / menus (character restore panel) ─────────────
  if ((interaction.isButton() || interaction.isStringSelectMenu()) &&
      isCharacterRestoreInteraction(interaction.customId)) {
    try {
      await handleCharacterRestoreComponent(interaction);
    } catch (error) {
      console.error(`❌  Error handling component ${interaction.customId}:`, error);
      const errContent = '❌ Une erreur inattendue est survenue. Réessaie plus tard.';
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: errContent, flags: MessageFlags.Ephemeral }).catch(() => null);
      } else {
        await interaction.reply({ content: errContent, flags: MessageFlags.Ephemeral }).catch(() => null);
      }
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  const command = commands.get(interaction.commandName);
  if (!command) {
    console.warn(`⚠️  Unknown command received: /${interaction.commandName}`);
    return;
  }

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(`❌  Error executing /${interaction.commandName}:`, error);

    const errContent = '❌ An unexpected error occurred. Please try again later.';

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: errContent, flags: MessageFlags.Ephemeral }).catch(() => null);
    } else {
      await interaction.reply({ content: errContent, flags: MessageFlags.Ephemeral }).catch(() => null);
    }
  }
});

// ─────────────────────────────────────────────────────────────
//  Start bot
// ─────────────────────────────────────────────────────────────

client.login(config.token).catch((err) => {
  console.error('❌  Failed to log in to Discord:', err);
  process.exit(1);
});
