# CousinDiscordLinker — Full System Documentation

A two-part system for ARK: Survival Ascended that requires players to link their Discord account before they can play on the server. It combines a **C++ server plugin** (CousinDiscordLinker) and a **TypeScript Discord bot** (DiscordBotLinker) that communicate through a shared **MySQL database**. You can get the plugin on my web store at : https://store.chezcousin.net for only 9.99$ 

---

## System Overview

```
Player logs in
     │
     ▼
[C++ Plugin] Checks DB → not verified?
     │
     └─► Sends in-game notification:
         "Join our Discord and type: /verify A3F9K2"
                               │
                               ▼
                    Player runs /verify A3F9K2 in Discord
                               │
                               ▼
                    [Discord Bot] Validates code in DB
                    Sets Verified=1, stores Discord info
                               │
                               ▼
                    [C++ Plugin] Timer detects verified → removes from pending
```

If the player **does not verify within the configured time** and `EnableKick` is `true`, they are kicked from the server.

---

## Part 1 — C++ Plugin (CousinDiscordLinker)

### What it does

- Checks if the player's EOS ID is verified in the MySQL `DiscordVerification` table
- If **not verified**: generates a one-time code, stores it in `DiscordVerificationCodes`, sends an orange in-game notification
- Sends reminder notifications every `ReminderIntervalSeconds`
- Checks verification status every `VerifyCheckIntervalSeconds` (always before the kick check)
- Optionally kicks unverified players after `KickAfterSeconds` (controlled by `EnableKick`)


## Part 2 — Discord Bot (DiscordBotLinker)

### Prerequisites

- **Node.js** v18+
- **npm** v9+
- A **MySQL** database (same one the C++ plugin connects to)
- A Discord bot application ([Discord Developer Portal](https://discord.com/developers/applications))
- *(Optional)* A **CousinTribeLadder** database if you want player stats in `/myinfos` and `/whois`

### 1. Create a Discord Application & Bot

1. Go to [https://discord.com/developers/applications](https://discord.com/developers/applications)
2. Click **New Application** → give it a name (e.g. `ARK Linker`)
3. Go to the **Bot** tab → click **Add Bot**
4. Under **Token** → click **Reset Token** → copy it → this is your `token`
5. Disable **Public Bot** if you only want it in your server
6. Under the **Bot** tab → scroll to **Privileged Gateway Intents** → enable **Server Members Intent**.
   ⚠️ **Required** — this bot requests `GuildMembers` (used to look up a player's roles/voice state for `/whois` and the points system). Without this intent enabled in the portal, the bot will crash on startup with `Used disallowed intents`.
7. Under **OAuth2 → General** → copy the **Application ID** → this is your `clientId`
8. Go to **OAuth2 → URL Generator**:
   - Scopes: `bot`, `applications.commands`
   - Bot Permissions: `Send Messages`, `Use Slash Commands`
   - Copy the URL and invite the bot to your server


### 2. Get your IDs from Discord

Enable **Developer Mode**: User Settings → Advanced → Developer Mode

| What | How to get it |
|---|---|
| **Guild ID** (`guildId`) | Right-click your server icon → Copy Server ID |
| **Channel ID** (`allowedChannelIds`) | Right-click a channel → Copy Channel ID |
| **Role ID** (`allowedAdminRoleIds`) | Server Settings → Roles → right-click a role → Copy Role ID |

### 3. Configure the bot

Copy `config.example.json` to `config.json` (this file is gitignored so your secrets never get committed) and edit it:

```bash
cp config.example.json config.json
```

Edit `DiscordBotLinker/config.json`:


```json
{
  "token": "YOUR_BOT_TOKEN",
  "clientId": "YOUR_APPLICATION_ID",
  "guildId": "YOUR_DISCORD_SERVER_ID",

  "allowedChannelIds": ["CHANNEL_ID"],

  "allowedAdminRoleIds": ["ADMIN_ROLE_ID_1", "ADMIN_ROLE_ID_2"],
  
// only if you use the plugin CousinTribeLadder
  "tribeLadderDB": {
    "enabled": false,
    "host": "localhost",
    "port": 3306,
    "user": "your_mysql_user",
    "password": "your_mysql_password",
    "database": "your_tribeladder_database_name"
  },

  "database": {
    "host": "localhost",
    "port": 3306,
    "user": "your_mysql_user",
    "password": "your_mysql_password",
    "database": "your_database_name",
    "verificationTable": "DiscordVerification",
    "pendingCodesTable": "DiscordVerificationCodes"
  },

// only if you want to reward players with shop points for playing + being in voice chat
  "shopDatabase": {
    "host": "localhost",
    "port": 3306,
    "user": "your_mysql_user",
    "password": "your_mysql_password",
    "database": "your_shop_database_name",
    "table": "shop"
  },

  "pointsSystem": {
    "enabled": false,
    "pointsPerInterval": 10,
    "intervalMinutes": 15,
    "rewardMessage": "You received {points} points for playing and being active in voice chat!"
  },

  "arkServers": [
    {
      "mapName": "TheIsland",
      "ip": "127.0.0.1",
      "port": 27020,
      "password": "your_rcon_password"
    },
    {
      "mapName": "Scorched",
      "ip": "127.0.0.1",
      "port": 27021,
      "password": "your_rcon_password"
    }
  ]
}
```


> ⚠️ **Important:** All IDs must be **strings** (quoted), not numbers. Discord IDs are 64-bit integers and cannot be safely represented as JSON numbers.
>
> ✅ `["1234567890123456789", "9876543210987654321"]`
> ❌ `[1234567890123456789, 9876543210987654321]`
>
> ✅ IDs must also be **separate strings** in the array — not comma-separated inside one string.
> ❌ `["111111, 222222"]` — this is ONE string and will never match

> ℹ️ `allowedChannelIds`: Leave empty (`[]`) to allow commands in all channels.
>
> ℹ️ `allowedAdminRoleIds`: Leave empty (`[]`) to lock `/whois` to nobody (security default — you must explicitly configure roles).
>
> ℹ️ `tribeLadderDB.enabled`: Set to `true` to show CousinTribeLadder stats in `/myinfos` and `/whois`. The table name is always `players` (column `eos_id` is used to match players).

> ⚠️ The `verificationTable` and `pendingCodesTable` values **must match** the table names in the C++ plugin's `config.json`.

### 4. Install dependencies

```bash
cd DiscordBotLinker
npm install
```

### 5. Register slash commands with Discord

Run this **once** (and again any time you add or rename a command):

```bash
npm run deploy
```

Expected output:
```
Registering 4 slash command(s) to guild ...
✅ Successfully registered 4 slash command(s).
```

### 6. Start the bot

**Development** (runs TypeScript directly):
```bash
npm run dev
```

**Production** (compile then run):
```bash
npm run build
npm start
```

---

## Points System (Shop Rewards for Active Players)

Rewards verified players with shop points every X minutes if they are **simultaneously**:
1. Online in-game on any of your configured ARK maps (checked via RCON `Listplayers`)
2. Connected to a voice channel in your Discord server (any channel except the guild's AFK channel — mute/deafen state does not matter)

### How it works

1. Every `intervalMinutes`, the bot connects via RCON to each server listed in `arkServers` and runs `Listplayers`.
2. The response is parsed to extract only the **EOS ID** of each online player (ignoring player names, which can contain commas/special characters).
3. Each online EOS ID is looked up in your `discordverification` table. If there's no record, or `Verified` is not `1`, the player is skipped — **no points for unverified players**.
4. If verified, the bot checks whether the linked `DiscordId` is currently connected to a voice channel (excluding AFK) in your Discord server.
5. If both conditions are met, the bot:
   - Adds `pointsPerInterval` points to that player's row in your shop table (matched by `eosId`)
   - Queues an in-game reward message for that player
6. Once all online/verified/in-voice players have been checked, the bot sends all queued reward messages for each map using a single reused RCON connection per map (instead of reconnecting per player), retrying each message once if the first attempt fails. Message: `ServerChatTo <eosid> "message"`, where `{points}` in `rewardMessage` is replaced with the actual amount granted. The message is targeted by **EOS ID** rather than in-game/Steam display name — this was changed after finding that `ServerChatToPlayer` requires the player's exact Steam name (which does **not** match what's stored in the verification DB), causing messages to silently fail to deliver. Using the EOS ID also means player names containing spaces are a non-issue.



### Required shop table schema

The bot expects the shop table (name configured via `shopDatabase.table`) to already exist with **at least** these columns, and `eosId` must be a `PRIMARY KEY` or have a `UNIQUE` index (the bot uses an upsert: `INSERT ... ON DUPLICATE KEY UPDATE points = points + VALUES(points)`):

```sql
CREATE TABLE IF NOT EXISTS `shop` (
  `eosId`  VARCHAR(64) NOT NULL PRIMARY KEY,
  `points` INT NOT NULL DEFAULT 0
);
```

### Config reference

| Field | Description |
|---|---|
| `shopDatabase.*` | Connection info for the (optionally separate) database holding the shop points table |
| `shopDatabase.table` | Name of the shop table (columns: `eosId`, `points`) |
| `pointsSystem.enabled` | Set to `true` to activate the points loop |
| `pointsSystem.pointsPerInterval` | How many points to grant each cycle |
| `pointsSystem.intervalMinutes` | How often (in minutes) to run the check/reward cycle |
| `pointsSystem.rewardMessage` | In-game chat message sent to rewarded players. Use `{points}` as a placeholder for the amount granted |
| `arkServers` | Array of `{ mapName, ip, port, password }` — one entry per map, used for both `Listplayers` RCON queries and sending reward chat messages |

> ⚠️ RCON must be enabled on each ARK server, and the `port`/`password` must match your server's RCON settings (`RCONEnabled=True`, `RCONPort`, `ServerAdminPassword` in `GameUserSettings.ini`).
>
> ℹ️ If a map's RCON connection fails (server offline, wrong credentials, etc.), the bot logs the error and simply skips that map for the current cycle — it won't crash the bot.
>
> ⚠️ **Use a numeric IP (`127.0.0.1`), not the hostname `"localhost"`, for any server running on the same machine as the bot.** Node.js on Windows can occasionally stall for a very long time (minutes) resolving the DNS name `"localhost"` due to IPv4/IPv6 dual-stack quirks — `127.0.0.1` skips DNS resolution entirely and connects instantly.
>
> ⚠️ **Windows Console "QuickEdit Mode" will pause the entire bot process** if you click inside the terminal window (even just to bring it into focus) — Windows blocks the process waiting for you to press Enter/Escape to exit text-selection mode. This can look exactly like the bot "hanging". To fix permanently: right-click the terminal's title bar → **Properties** → uncheck **QuickEdit Mode**. For production, running the bot via a process manager (e.g. **PM2** or **NSSM** as a Windows service) avoids this entirely since there's no interactive console to accidentally click into.

### Reward Log Webhook (optional)

If enabled, every points cycle that rewards at least one player also posts a summary embed to a Discord channel of your choice via a webhook — listing every player rewarded (name, map, points) plus the same summary line printed to the console. Nothing is sent on cycles where no one was rewarded (no spam).

To set it up:
1. In Discord, go to the channel you want the log posted to → **Edit Channel → Integrations → Webhooks → New Webhook**.
2. Copy the **Webhook URL**.
3. In `config.json`:
   ```json
   "rewardLogWebhook": {
     "enabled": true,
     "url": "https://discord.com/api/webhooks/xxxxxxxxxxxx/yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"
   }
   ```

| Field | Description |
|---|---|
| `rewardLogWebhook.enabled` | Set to `true` to post a reward summary to the webhook after each cycle (default `false`) |
| `rewardLogWebhook.url` | The Discord webhook URL to post to. Required if `enabled` is `true` |

> ℹ️ This is entirely separate from the bot's own Discord login — it uses Discord's webhook API directly, so no extra permissions or bot presence in that channel are needed.
>
> ⚠️ If the webhook URL is deleted/invalidated in Discord, or a network error occurs, the failure is only logged to the console — it will never crash the bot or interrupt the points cycle itself.


---


## Character Restore (Cousin Server Manager)

Lets a linked player restore **their own** character (level, XP, engrams, boss achievements) from the newest profile backup made by **Cousin Server Manager**, on the map they choose. The inventory is **not** restored (it is not part of the profile). All player-facing text is in French.

### Player flow

1. An admin posts the panel with `/restorepanel` (role-gated by `allowedAdminRoleIds`) in a channel.
2. The player logs out of the game and clicks **Restaurer mon personnage**.
3. The bot checks their Discord ↔ EOS link (`Verified = 1`) and the cooldown, then lists only the maps where a profile backup exists for that EOS ID.
4. After picking a map, the player sees the date of the newest backup and clicks **Confirmer la restauration**.
5. The bot restores that exact backup through the Server Manager API and posts the result (success or failure) in the admin log channel.

The EOS ID always comes from the verification table using the clicking user's Discord ID — players can never restore someone else's character. Every reply is ephemeral.

### Requirements

- Cousin Server Manager with the public API, a valid license, and an **API key** with the scopes **`read`** and **`restore`** (Account → API Keys).
- Automatic player profile backups enabled for each map in the Server Manager.

### Config reference

```json
"characterRestore": {
  "enabled": true,
  "managerUrl": "http://localhost:4000",
  "apiKey": "csm_xxxxxxxxxxxx_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "cooldownMinutes": 60,
  "adminLogChannelId": "123456789012345678"
}
```

| Key | Description |
|---|---|
| `enabled` | Turns the feature on. Missing section = disabled. |
| `managerUrl` | Server Manager address. Use `http://localhost:<port>` when the bot runs on the same PC. |
| `apiKey` | Server Manager API key (`read` + `restore` scopes). Keep it secret. |
| `cooldownMinutes` | Minimum time between two restores of the same character. `0` = no limit. |
| `adminLogChannelId` | Channel where every restore attempt is logged. The bot needs **View Channel**, **Send Messages** and **Embed Links** there. Empty = no Discord log. |

Cooldowns are stored in `data/character-restore-cooldowns.json` (survives restarts). On startup the bot prints whether it can reach the Server Manager with the configured key. Repost the panel with `/restorepanel` if you change `cooldownMinutes` (the panel text shows the limit).

---

## Discord Commands

### Referral system

Enable `ReferralSystem.Enabled` in the ASA plugin configuration and `referralSystem.enabled` in the bot configuration. On plugin startup, the shared linker database creates these tables if needed:

- `ReferralCodes` — one permanent, case-insensitive code per verified EOS account.
- `PlayerReferrals` — the cluster-wide referral record. `ReferredEosId` is unique, so a player cannot use different codes on multiple maps.
- `ReferralRewards` — durable reward/milestone audit entries.

Player flow:

1. A player links Discord with `/verify`.
2. The bot assigns their permanent code; they can retrieve it with `/referral me`.
3. A newly connected, linked player enters `/refer CODE` in ARK chat within the configured 24-hour window.
4. The plugin validates the linked identities and creates a `PENDING_REWARD` referral.
5. The bot worker credits +500 points to the recruiter and +250 to the newcomer, then completes the referral and evaluates milestones (5/10/20).

Use `/referral leaderboard` for completed-referral rankings. Admin-role holders configured through `allowedAdminRoleIds` can use `/referraladmin lookup`, `invalidate`, `code-reset`, and `reward-retry`.

Set `referralSystem.milestone20RoleId` only when the bot has the **Manage Roles** permission and its highest role is above the configured recruiter role. `statusChannelId` is optional; when configured, the bot posts and updates a referral status embed for the current process lifetime.

> The shop points table is currently in a separate database and only supports additive balances. Referral reward records make ordinary restarts recoverable, but a process crash after the shop increment and before the linker database marks that increment processed can cause one retry. For strict cross-database exactly-once delivery, add a unique `transaction_reference` column/table to the shop database and make `addPoints` perform an idempotent transaction-reference insert.


### `/verify <code>` — Link your account
**Available to:** Everyone (in allowed channels)

Links your Discord account to your in-game identity using the code shown in-game. All replies are ephemeral (only you see them).

| Case | Response |
|---|---|
| Valid code | ✅ Account linked — shows survivor name and Discord username |
| Already linked | ⚠️ Already linked — shows current link, suggests `/unlink` to switch |
| Invalid/expired code | ❌ Invalid or expired — tells player to relog for a fresh code |
| In-game account already linked to another Discord | ❌ Error — contact admin |

---

### `/myinfos` — My account info and stats
**Available to:** Everyone (in allowed channels)

Shows your Discord link status, survivor name, EOS ID. If **CousinTribeLadder** integration is enabled, also shows:

| Field | Description |
|---|---|
| 🏰 Tribe Name | Your current tribe name |
| 🆔 Tribe ID | Your tribe's numeric ID |
| ⚔️ Level | Your survivor level |
| 🗡️ Player Kills | Players you have killed |
| 🦕 Dino Kills | Enemy dinos you have killed |
| 💀 Deaths (PvP) | Times killed by another player |
| ☠️ Total Deaths | All deaths (PvP + PvE + other) |

---

### `/unlink` — Remove your link
**Available to:** Everyone (in allowed channels)

Removes the link between your Discord account and your in-game identity. You will be prompted to verify again the next time you log into the server.

---

### `/whois` — Admin lookup (role-gated)
**Available to:** Users with a role listed in `allowedAdminRoleIds`

Look up a player's linked account information. Has four subcommands:

| Subcommand | Input | Returns |
|---|---|---|
| `/whois eosid <eosid>` | EOS ID | Discord name, Discord ID, verified status |
| `/whois discordname <name>` | Exact Discord username | EOS ID, survivor name, verified status |
| `/whois discordid <id>` | Discord user snowflake ID | EOS ID, survivor name, Discord username |
| `/whois playername <name>` | Exact in-game player name | EOS ID, Discord name, Discord ID, verified status |

All four subcommands also include **CousinTribeLadder stats** if the integration is enabled.


**Response states for each subcommand:**

- `❌ No Record Found` — no DB entry for this EOS ID / Discord name / Discord ID
- `⚠️ Player Found — Not Linked` — record exists but `Verified = 0` (player hasn't verified yet)
- `✅ Linked Account Found` — full linked account details (+ stats if TribeLadder enabled)

---

## Troubleshooting

| Problem | Solution |
|---|---|
| `/verify` says "Invalid or Expired Code" | Player needs to relog to get a fresh code. Codes expire after `CodeExpiryMinutes` minutes |
| Player verified but still getting kicked | Check `VerifyCheckIntervalSeconds` — must be less than `KickAfterSeconds`. Also check `EnableKick` is `true` in plugin config |
| Want to disable kicking temporarily | Set `EnableKick: false` in plugin config then run `CousinDiscordLinker.Reload` via console/RCON |
| `/whois` says "no permission" | Check `allowedAdminRoleIds` — IDs must be **separate quoted strings**, not comma-separated inside one string |
| `/myinfos` or `/whois` shows no tribe/stats | Check `tribeLadderDB.enabled: true` and DB credentials in bot `config.json` |
| Restore panel: "Service temporairement indisponible" | Check the bot console: `unreachable` = wrong `managerUrl` or manager stopped; `invalid_api_key`/`api_key_revoked`/`api_key_expired` = create a new key; `insufficient_scope` = key needs `read` + `restore` |
| Restore: player sees "Aucune sauvegarde trouvée" | The Server Manager has no profile backup for that EOS ID — check profile backups are enabled for the map |
| `/restorepanel` not visible | Run `npm run deploy` again after updating the bot |
| Commands not appearing in Discord | Run `npm run deploy` again |
| Bot can't connect to MySQL | Check DB settings in `config.json`. Ensure the MySQL user has SELECT, INSERT, UPDATE, DELETE permissions |
| Bot token error on startup | Regenerate the token on the Discord Developer Portal and update `config.json` |
| Plugin doesn't create tables | Check `PluginDBSettings` in the plugin `config.json`. Ensure `UseMySQL: true` and credentials are correct |
