# Discord backlog publisher

This is an on-request developer tool, not the planned raid bot. It posts approved text to one channel webhook and updates its own tracked messages. It cannot edit messages posted by a person. Nothing is sent by a build, deploy, preview or credential setup.

## Shared content and publishing ownership

Collaborators maintain [the backlog](backlog.json) and [patch notes](../CHANGELOG.md) through PRs using [the contribution rules](../CONTRIBUTING.md#backlog-patch-notes-and-publishing). The primary maintainer publishes from the designated Windows machine; its encrypted credentials, message receipts and locks remain local. Other collaborators must not create independent publishing state for the same messages.

These shared files are source content, not valid publisher input yet. The current CLI accepts the `posts` payload below. Named backlog/patch-notes destinations, automatic rendering and coordinated release tracking are future work (`COMMS-002`). Do not configure the patch-notes webhook with the current setup command: it would replace the backlog credential. No automatic file watcher, deploy hook or Discord update is enabled by adding shared files.

## Secure setup (Windows)

Create a webhook in Discord's channel settings under Integrations, then run this in your own VS Code PowerShell terminal from the repository root:

```powershell
.\scripts\discord-backlog.ps1 -Configure
```

At the hidden prompt, paste the copied webhook URL and press Enter. Do not paste it in chat. The script uses Windows user encryption through `Export-Clixml` and saves the credential under `%LOCALAPPDATA%\IntrepidRaidDesk\Discord\webhook.xml`, outside the public repository. It can only be decrypted by the same Windows account on the same machine. Clear your clipboard afterward. Programs running as your account can still use this credential; encryption is not a boundary against a compromised account.

Setup accepts current `discord.com` and legacy `discordapp.com` webhook links, including dotted tokens, and trims surrounding paste whitespace. Requests always use `https://discord.com`. If validation fails, it reports only which part of the format failed, never the URL or token. Share only that diagnostic when troubleshooting.

If pasting into the hidden prompt fails, click **Copy Webhook URL** in Discord and run `.\scripts\discord-backlog.ps1 -ConfigureFromClipboard` yourself. This reads the clipboard locally without echoing it, validates and encrypts the URL, and replaces the current clipboard with harmless confirmation text after saving (Windows PowerShell may reject an empty clipboard value). It makes no network request. Do not ask an assistant to inspect the clipboard. Clear any saved clipboard-history entry separately if Windows clipboard history is enabled.

Never put this URL in source, input JSON, screenshots, command-line arguments or a `VITE_` variable. Rotate it in Discord if exposed. Do not run setup while terminal input is being recorded.

## Preview, then explicitly publish

Create a UTF-8 JSON file containing approved content. Keep guild-private content outside the repository; the following is only an invented shape:

```json
{
  "posts": [
    { "key": "raid-backlog", "content": "**Raid backlog**\n- Pending: starting roster snapshots" },
    { "key": "loot-backlog", "content": "**Loot backlog**\n- Pending: manual award recording" }
  ]
}
```

Keys are permanent identifiers: keep the same key to edit the same Discord message. Each content value must contain 1 to 2000 characters; split longer content into separate posts. Up to 20 posts are allowed per invocation. All mentions are suppressed, including `@everyone`, users and roles.

```powershell
# Default is preview; no credentials or network calls are needed.
.\scripts\discord-backlog.ps1 -File 'C:\path\outside-repo\backlog.json'

# Only after the content and destination are approved:
.\scripts\discord-backlog.ps1 -File 'C:\path\outside-repo\backlog.json' -Publish
```

The first publish creates replacement messages for the backlog previously posted by a person. Later publishes edit the tracked messages and skip unchanged text. Omitting a key does not delete its Discord message. Changing a key creates a new message; it does not rename or delete the old one.

Message IDs and content hashes are stored beside the encrypted credential in a per-webhook tracking file. Back up that state; losing it can cause duplicates. A lock prevents concurrent publishers using the same state directory. If the process is interrupted, inspect Discord and the tracking file before manually removing a stale lock. Do not blindly retry a timeout: Discord may have accepted the post even when the receipt was lost. The publisher stops on failed requests, rate limits or missing messages instead of silently recreating them. Already-sent messages are not rolled back when a later message fails.

The webhook credential is passed only to the child Node process, not as a command-line argument, and removed from the wrapper environment afterward. HTTP errors are reported without logging Discord response bodies or credential-bearing URLs.

## Assistant use

After secure setup, an assistant with approved local terminal access can run this publisher when explicitly asked to post or update the backlog. No MCP server is required for that workflow. This does not grant all assistants automatic Discord access, create a bot, or authorize unsolicited posting. Future dedicated tool integration can wrap the same publisher.

## Validation

`npm run test:unit` includes mocked Discord transport, payload validation, mention suppression, create/update behavior, tracking and failure tests. These tests never contact Discord. Build and lint remain required for changes.
