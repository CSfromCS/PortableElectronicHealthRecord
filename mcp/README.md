# puhrr-mcp — PUHRR for Medmin

An [MCP](https://modelcontextprotocol.io) server that lets an AI agent (Medmin, running on Hermes)
**read** the user's PUHRR data and generate reports from the user's own report templates.

- **Read-only.** It follows the sync room the way another device would, but it has no way to push.
  Nothing it does can change PUHRR. (Write tools arrive in a later phase.)
- **Same code as the app.** It runs PUHRR's own template engine, filter, sort and Master Checklist
  logic in Node, so a report generated here is character-for-character what the Reports tab makes.
- **Encrypted end to end.** It holds the room code, downloads the encrypted snapshot, and decrypts
  it in memory. Nothing is written to disk.

## Tools

| Tool | What it does |
|---|---|
| `sync_status` | When the room was last downloaded and last changed; patient counts |
| `list_tags` | Tag groups and tags (wards, services, ...) with patient counts |
| `find_patient` | Look up patients by room, name or ward; returns every match |
| `list_patients` | The Patients list, with PUHRR's filter (tags AND/OR, wards, pool), sort, and saved views |
| `get_patient` | Everything about one patient: profile, diagnoses, problems, notes, checklist, vitals, meds, orders, labs |
| `get_checklist` | What the Master Checklist shows for a date, including unfinished items carried forward |
| `list_views` | Saved views |
| `list_templates` | Each template's exact format spelled out, plus a sample of its output |
| `preview_template` | A template on sample data |
| `render_report` | A template with real patients — **send the result exactly as returned** |

A name that doesn't match exactly (a ward, tag, template, saved view) is never guessed: the tool
answers with the closest existing ones so the agent can ask the user.

## Setting it up (Medmin can do this from chat)

Requires Node 20 or newer and git on the VPS.

1. **Get the code.**
   ```bash
   git clone https://github.com/CSfromCS/PortableElectronicHealthRecord.git /opt/puhrr
   cd /opt/puhrr && npm ci
   ```
   (`git pull && npm ci` later updates it.)

2. **Store the room code in a private file** — the same room code PUHRR's sync uses. It unlocks all
   patient data, so keep it out of chat history, notes and Medmin's memory:
   ```bash
   sudo install -d -m 700 /etc/puhrr
   sudo install -m 600 /dev/null /etc/puhrr/room-code
   # then put the room code in that file, and delete the message you sent it in
   ```
   Make the file readable only by the account Hermes runs as (`chown` it to that account).

3. **Check it starts.**
   ```bash
   cd /opt/puhrr && PUHRR_ROOM_CODE_FILE=/etc/puhrr/room-code npm run mcp
   ```
   It should print `puhrr-mcp ready (read-only), room xxxxx` to stderr and wait. Stop it with Ctrl+C.
   A wrong room code fails here with a clear message and creates nothing.

4. **Register it with Hermes** in `~/.hermes/config.yaml`
   ([Hermes MCP docs](https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp)):
   ```yaml
   mcp_servers:
     puhrr:
       command: "node"
       args:
         - "/opt/puhrr/node_modules/tsx/dist/cli.mjs"
         - "--tsconfig"
         - "/opt/puhrr/mcp/tsconfig.json"
         - "/opt/puhrr/mcp/puhrr-mcp.ts"
       env:
         PUHRR_ROOM_CODE_FILE: "/etc/puhrr/room-code"
         PUHRR_TIMEZONE: "Asia/Manila"
         LANG: "en_US.UTF-8"
   ```
   Use `node` directly, not `npm run`: npm prints a banner to stdout, which would corrupt the
   protocol. Then restart the Hermes gateway so it picks up the new server.

5. **Try it:** ask Medmin for the sync status, then for a census.

## Settings

| Variable | Default | Meaning |
|---|---|---|
| `PUHRR_ROOM_CODE_FILE` | — | File containing the room code (preferred) |
| `PUHRR_ROOM_CODE` | — | The room code itself, if no file is used |
| `PUHRR_TIMEZONE` | `Asia/Manila` | Timezone for "today" and Current Date/Time in reports. Set it to the hospital's, not the VPS's |
| `PUHRR_DEVICE_NAME` | `Medmin` | Name this connection shows under in sync |
| `PUHRR_USERNAME` | `Medmin` | User name for the sync room |
| `PUHRR_SYNC_ENDPOINT` | PUHRR's Worker | Sync service URL |
| `LANG` | server's | Locale for date and time wording in reports. Set it to match what PUHRR shows on the user's phone |

## Notes

- Data is as fresh as the last sync from the user's devices, re-checked at most every 10 seconds
  per question. A phone with PUHRR closed doesn't push, so its newest edits appear when it's opened.
- Every report is generated at the moment it's asked for, with the current time in `PUHRR_TIMEZONE`.
- The server's built-in instructions tell the agent never to write or reformat a report itself.
  Keep Medmin's own prompt consistent with that.
