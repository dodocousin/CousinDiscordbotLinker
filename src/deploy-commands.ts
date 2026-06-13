/**
 * deploy-commands.ts
 *
 * Registers slash commands with Discord for a specific guild (server).
 * Run this once whenever you add or change a command:
 *
 *   npm run deploy
 *
 * Guild-scoped commands appear instantly. If you ever want global commands
 * (available in all servers), replace Routes.applicationGuildCommands with
 * Routes.applicationCommands — but note they take up to 1 hour to propagate.
 */

import { REST, Routes, RESTPostAPIApplicationCommandsJSONBody } from 'discord.js';
import * as verify   from './commands/verify';
import * as myInfos  from './commands/myInfos';
import * as unlink   from './commands/unlink';
import * as whoIs    from './commands/whoIs';
import config from './config';

if (!config.token)    { console.error('❌ config.json: token is empty');    process.exit(1); }
if (!config.clientId) { console.error('❌ config.json: clientId is empty'); process.exit(1); }
if (!config.guildId)  { console.error('❌ config.json: guildId is empty');  process.exit(1); }

const commands: RESTPostAPIApplicationCommandsJSONBody[] = [
  verify.data.toJSON(),
  myInfos.data.toJSON(),
  unlink.data.toJSON(),
  whoIs.data.toJSON(),
];

const rest = new REST({ version: '10' }).setToken(config.token);

(async () => {
  try {
    console.log(`Registering ${commands.length} slash command(s) to guild ${config.guildId}...`);

    const result = await rest.put(
      Routes.applicationGuildCommands(config.clientId, config.guildId),
      { body: commands }
    );

    console.log(`✅ Successfully registered ${(result as unknown[]).length} slash command(s).`);
  } catch (error) {
    console.error('❌ Failed to register commands:', error);
    process.exit(1);
  }
})();
