# Discord backlog publisher

This is an on-request developer tool, not the planned raid bot. It publishes approved backlog and patch notes through separate channel webhooks and updates its own tracked messages. It cannot edit messages posted by a person. Nothing is sent by a build, deploy, preview or credential setup.

## Shared content and publishing ownership

Collaborators maintain [the backlog](backlog.json) and [patch notes](../CHANGELOG.md) through PRs using [the contribution rules](../CONTRIBUTING.md#backlog-patch-notes-and-publishing). The primary maintainer publishes from the designated Windows machine; its encrypted credentials, message receipts and locks remain local. Other collaborators must not create independent publishing state for the same messages.

Generated modes read these shared files directly. Backlog-only updates use `-Backlog`; a verified release uses `-Release '<exact dated changelog heading>'` and coordinates both channels. The manual `posts` payload remains supported. No automatic watcher, deploy hook or Discord update is enabled.

## Secure setup (Windows)

Create a webhook in Discord's channel settings under Integrations, then run this in your own VS Code PowerShell terminal from the repository root:

```powershell
.\scripts\discord-backlog.ps1 -Configure
```

At the hidden prompt, paste the copied webhook URL and press Enter. Do not paste it in chat. The script uses Windows user encryption through `Export-Clixml` and saves the credential under `%LOCALAPPDATA%\IntrepidRaidDesk\Discord\webhook.xml`, outside the public repository. It can only be decrypted by the same Windows account on the same machine. Clear your clipboard afterward. Programs running as your account can still use this credential; encryption is not a boundary against a compromised account.

Setup accepts current `discord.com` and legacy `discordapp.com` webhook links, including dotted tokens, and trims surrounding paste whitespace. Requests always use `https://discord.com`. If validation fails, it reports only which part of the format failed, never the URL or token. Share only that diagnostic when troubleshooting.

If pasting into the hidden prompt fails, click **Copy Webhook URL** in Discord and run `.\scripts\discord-backlog.ps1 -ConfigureFromClipboard` yourself. This reads the clipboard locally without echoing it, validates and encrypts the URL, and replaces the current clipboard with harmless confirmation text after saving (Windows PowerShell may reject an empty clipboard value). It makes no network request. Do not ask an assistant to inspect the clipboard. Clear any saved clipboard-history entry separately if Windows clipboard history is enabled.

Never put this URL in source, input JSON, screenshots, command-line arguments or a `VITE_` variable. Rotate it in Discord if exposed. Do not run setup while terminal input is being recorded.

### Add the separate patch-notes destination

Keep the already-configured backlog credential. Create another webhook **in the patch-notes channel**, copy its URL, and run this yourself:

```powershell
.\scripts\discord-backlog.ps1 -ConfigureFromClipboard -Destination patch-notes
```

This stores `webhook-patch-notes.xml` beside `webhook.xml` without overwriting it. `-Destination backlog` is the default for setup and manual payloads. Generated modes select their own destinations; release publishing refuses identical webhook IDs. Distinct webhook IDs do not prove distinct channels: the maintainer must create each webhook in the correct channel.

## Shared-file previews and releases

```powershell
# Backlog edits only: no patch-notes message.
.\scripts\discord-backlog.ps1 -Backlog
.\scripts\discord-backlog.ps1 -Backlog -Publish

# First verify the deployed release and update the shared files.
# Preview the exact dated heading; Unreleased is never publishable.
.\scripts\discord-backlog.ps1 -Release '2026-10-16 - bbefbc2'
# Only after explicit approval of the preview and both destinations:
.\scripts\discord-backlog.ps1 -Release '2026-10-16 - bbefbc2' -Publish
```

The dated entry is the maintainer's assertion of verification, not an automatic deployment check. Do not publish an old example release unless deliberately approving a historical announcement. Backlog entries become `released` only after verification, with their `release` matching a changelog heading exactly. The publisher validates schema, field values, unique IDs, real calendar dates, dependencies, cycles and release references before any send. It does not edit these source files or infer completion from merged PRs.

Backlog messages are grouped by ID prefix and split into pages of at most 2000 characters. Released/cancelled items are omitted; awaiting-deployment items remain. Patch notes use the selected section's paragraphs, preserving bullet lists. Oversized indivisible blocks fail explicitly: split them with blank lines or shorten source content. Keep general changelog commentary before the first `##` heading, not after the last release. Preview requires no credentials and prints generated content and destinations.

Publishing preflights both local credentials, tracking files, locks and rendered content before sending anything. Patch notes go first, then the backlog. Each successful receipt is saved immediately. A repeat of the same release skips unchanged messages; corrections edit the same release pages. Different releases create new messages. Old generator-owned overflow pages are edited to an archive notice, not deleted, so shrinking lists cannot leave stale active work visible. Preview reports this archival policy without reading credential-protected destination state. Manually tracked pages are never adopted or retired automatically.

Generated keys (`backlog-...`, `release-...`) are reserved. Existing manually published backlog messages have different keys and need a one-time, explicitly approved manual archive/removal when switching to generated content; the tool does not remove them.

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

Keys are permanent identifiers: keep the same key to edit the same Discord message. Do not start manual keys with the reserved `backlog-` or `release-` prefixes. Each content value must contain 1 to 2000 characters; split longer content into separate posts. Up to 100 posts are allowed per destination per invocation, including retired pages. All mentions are suppressed, including `@everyone`, users and roles.

```powershell
# Default is preview; no credentials or network calls are needed.
.\scripts\discord-backlog.ps1 -File 'C:\path\outside-repo\backlog.json'

# Only after the content and destination are approved:
.\scripts\discord-backlog.ps1 -File 'C:\path\outside-repo\backlog.json' -Publish

# Manual patch-notes payload (not coordinated with the backlog):
.\scripts\discord-backlog.ps1 -File 'C:\path\outside-repo\notes.json' -Destination patch-notes
```

The first publish creates replacement messages for the backlog previously posted by a person. Later publishes edit the tracked messages and skip unchanged text. Omitting a key does not delete its Discord message. Changing a key creates a new message; it does not rename or delete the old one.

Message IDs and content hashes are stored beside the encrypted credential in a per-webhook tracking file. Back up that state; losing it can cause duplicates. Per-webhook locks prevent overlapping publishers using the same state directory; release mode acquires both locks before sending. The publisher stops on failed requests, rate limits or missing messages instead of silently recreating them. Already-sent messages are not rolled back when a later message fails.

### Recovery

- **Explicit rejection, such as HTTP 429:** correct the problem/wait as appropriate, then rerun the same approved command. Saved successes are skipped and the failed channel resumes.
- **Timeout, network failure, server error, unreadable receipt, interruption or receipt-save failure:** delivery may have succeeded. A persisted `pending` record blocks automatic retry. Do not delete tracking to bypass it. Stop all publishers and inspect Discord first. Back up the tracking file. If the message exists and matches the attempted content, record its numeric ID and pending hash under `messages[pending.key]`, then remove `pending`. For an existing edited message, retain its original ID. If you confirm no delivery occurred, remove only `pending`, leaving previous receipts intact, then retry. If delivery cannot be established, stop and reconcile manually; exactly-once delivery is not guaranteed.
- **Stale lock after interruption:** confirm no publisher is running, inspect pending tracking and Discord, then remove only the corresponding `messages-<id>.lock`. Never remove another active process's lock.
- **Missing tracked message (404):** restore/reconcile the message or webhook manually; the publisher will not create a duplicate replacement automatically.

Do not copy private receipts into public source files or share raw errors/credential-bearing files. Maintain one designated publishing machine and state directory.

The webhook credential is passed only to the child Node process, not as a command-line argument, and removed from the wrapper environment afterward. HTTP errors are reported without logging Discord response bodies or credential-bearing URLs.

## Assistant use

After secure setup, an assistant with approved local terminal access can run this publisher when explicitly asked to post or update the backlog. No MCP server is required for that workflow. This does not grant all assistants automatic Discord access, create a bot, or authorize unsolicited posting. Future dedicated tool integration can wrap the same publisher.

## Validation

`npm run test:unit` includes mocked Discord transport, source validation, pagination thresholds, mention suppression, create/update behavior, two-channel preflight, partial failure/resume, pending-delivery protection and Windows destination configuration tests. These tests never contact Discord or use real credentials/clipboard content. Build and lint remain required for changes; `npx tsc -p tests\unit\tsconfig.json` checks tool and test types. An approved live create/edit check remains a separate adoption step.
