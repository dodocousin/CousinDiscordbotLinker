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
import config from './config';

// ─────────────────────────────────────────────────────────────
//  Validate config on startup
// ─────────────────────────────────────────────────────────────

if (!config.token) {
  console.error('❌  config.json: token is empty. Bot cannot start.');
  process.exit(1);
}
if (!config.database.host || !config.database.user || !config.database.database) {
  console.error('❌  config.json: database connection settings are incomplete.');
  process.exit(1);
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

// ─────────────────────────────────────────────────────────────
//  Create Discord client
//  We only need the Guilds intent for slash commands.
// ─────────────────────────────────────────────────────────────

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, (readyClient) => {
  console.log(`✅  Bot ready! Logged in as ${readyClient.user.tag}`);
  if (config.allowedChannelIds.length > 0) {
    console.log(`📌  Allowed channels: ${config.allowedChannelIds.join(', ')}`);
  } else {
    console.log('📌  No channel restriction – commands work everywhere.');
  }
});

// ─────────────────────────────────────────────────────────────
//  Handle interactions
// ─────────────────────────────────────────────────────────────

client.on(Events.InteractionCreate, async (interaction: Interaction) => {
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
