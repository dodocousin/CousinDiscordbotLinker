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
6. Under **OAuth2 → General** → copy the **Application ID** → this is your `clientId`
7. Go to **OAuth2 → URL Generator**:
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
  }
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

## Discord Commands

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

Look up a player's linked account information. Has three subcommands:

| Subcommand | Input | Returns |
|---|---|---|
| `/whois eosid <eosid>` | EOS ID | Discord name, Discord ID, verified status |
| `/whois discordname <name>` | Exact Discord username | EOS ID, survivor name, verified status |
| `/whois discordid <id>` | Discord user snowflake ID | EOS ID, survivor name, Discord username |

All three subcommands also include **CousinTribeLadder stats** if the integration is enabled.

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
| Commands not appearing in Discord | Run `npm run deploy` again |
| Bot can't connect to MySQL | Check DB settings in `config.json`. Ensure the MySQL user has SELECT, INSERT, UPDATE, DELETE permissions |
| Bot token error on startup | Regenerate the token on the Discord Developer Portal and update `config.json` |
| Plugin doesn't create tables | Check `PluginDBSettings` in the plugin `config.json`. Ensure `UseMySQL: true` and credentials are correct |
