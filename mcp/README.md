# puhrr-mcp — an MCP server for PUHRR

An [MCP](https://modelcontextprotocol.io) server (stdio) that gives any MCP-compatible client access
to your PUHRR data: **read** it, generate reports from your own report templates, and — only when
switched on — **change** it.

- **Read-only by default.** Set `PUHRR_ALLOW_WRITES=1` to add the write tools. Without it the write
  tools do not exist, and the server has no way to upload anything.
- **Same code as the app.** It runs PUHRR's own template engine, filter, sort, tag and checklist
  logic in Node, so a report generated here is character-for-character what the Reports tab makes,
  and a change made here is made the way the app would make it.
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
| `list_custom_actions` | The custom action buttons: what each adds to the checklist, the tags it needs or changes, manual or automatic |
| `list_templates` | Each template's exact format spelled out, plus a sample of its output |
| `preview_template` | A template on sample data |
| `render_report` | A template with real patients — the text is final and should be used exactly as returned |

A name that doesn't match exactly (a ward, tag, template, saved view) is never guessed: the tool
answers with the closest existing ones so the caller can ask the user.

### Write tools (only with `PUHRR_ALLOW_WRITES=1`)

| Area | Tools |
|---|---|
| Patients | `add_patient`, `update_patient` (every profile field; `appendText` adds to long text), `set_ward`, `set_services`, `set_diagnosis`, `set_tags`, `create_tag` |
| Daily work | `add_vitals` / `update_vitals`, `add_medication` / `update_medication`, `add_order` / `update_order`, `add_lab` / `update_lab` (validated against the lab templates; calculated ABG fields filled in) |
| Checklist | `add_checklist_item` (with note), `edit_checklist_item`, `complete_checklist_item`, `reopen_checklist_item`, `delete_checklist_item`, `move_checklist_item` — for a patient or the General checklist |
| Problems and notes | `add_problem`, `edit_problem`, `set_problem_status`, `reorder_problems`, `set_daily_note` (S/O/A/P and per-problem notes) |
| Custom actions | `run_custom_action`: presses a manual button (patient or General) the way the app does; items already listed are skipped, and a patient who matches no condition is left alone with the missing tags named. A General action with a template also returns its rendered report |
| Views and templates | `create_view`, `update_view`, `duplicate_template`, `update_template` (rename, on/off, and reword or reorder a format using the variables it already has) |
| Needs a yes first | `request_delete` (patient, vital, lab, medication, order, problem, view, template), `request_discharge`, then `confirm_action` |
| Safety | `recent_changes`, `undo_change` |

Not included: creating brand-new template variables (do that in PUHRR; a client can duplicate a
template and reword it), and photos (they don't sync yet).

### The guardrails

- **Which patient.** Every patient change needs the room **and** last name; no match, or more than
  one, is refused with the candidates listed. An id that contradicts them is refused. Each answer
  repeats who was changed.
- **Existing names only.** Wards, services and tags must already exist. `"MICU"` against
  `"Medical ICU"` is refused with the existing one offered; a new tag is created only by
  `create_tag`, which needs the user's approved name and is blocked while a similar one exists.
- **Deleting and discharging are two steps.** `request_delete` / `request_discharge` change nothing
  and return a plain description plus a 10-minute code; `confirm_action` runs it. Checklist items
  are the one exception (single step, but undoable). The client is instructed to get the user's yes
  in between; the code makes a one-shot accident impossible but cannot prove a human said yes.
- **Everything is logged and undoable.** Each change is recorded (what it was, to whom, and what
  every record looked like before and after) and synced to your devices. PUHRR has no screen for it:
  after every change the server's answer lists each field that changed (old value → new value) and
  the change id, and the client is told to read that back to the user, who can ask for an undo at
  any time (`recent_changes` lists earlier ones). Deleted patients and entries are recoverable for 30
  days. Undo refuses if the thing was edited again since, unless the user agrees to overwrite.
- **No silent loss.** A change is made on the freshest copy of the room and uploaded before the
  answer comes back. If the room can't be reached, the answer says the change is **not** stored,
  and it is sent with the next change.

## Setting it up

Requires Node 20 or newer and git.

1. **Get the code.**
   ```bash
   git clone https://github.com/CSfromCS/PortableElectronicHealthRecord.git puhrr
   cd puhrr && npm ci
   ```
   (`git pull && npm ci` later updates it.)

2. **Store the room code in a private file** — the same room code PUHRR's sync uses. It unlocks all
   of your patient data, so keep it out of chat history, notes and anything shared. Make the file
   readable only by the account that runs the server.

3. **Check it starts.**
   ```bash
   PUHRR_ROOM_CODE_FILE=/path/to/room-code npm run mcp
   ```
   It should print `puhrr-mcp ready (read-only), room xxxxx` to stderr and wait. Stop it with Ctrl+C.
   A wrong room code fails here with a clear message and creates nothing.

4. **Register it with your MCP client.** It is a stdio server. Most clients take an entry like this
   (adjust the paths; the key names follow the common `mcpServers` convention):
   ```json
   {
     "mcpServers": {
       "puhrr": {
         "command": "node",
         "args": [
           "/path/to/puhrr/node_modules/tsx/dist/cli.mjs",
           "--tsconfig", "/path/to/puhrr/mcp/tsconfig.json",
           "/path/to/puhrr/mcp/puhrr-mcp.ts"
         ],
         "env": {
           "PUHRR_ROOM_CODE_FILE": "/path/to/room-code",
           "PUHRR_TIMEZONE": "Asia/Manila"
         }
       }
     }
   }
   ```
   Use `node` directly, not `npm run`: npm prints a banner to stdout, which would corrupt the
   protocol.

5. **Turning on changes (optional).** Update PUHRR on **every** device first so each can sync the
   change log: an older version will say it needs updating. Then add `"PUHRR_ALLOW_WRITES": "1"`
   to `env`, restart the client, and try one small change on a test patient, then check it appears
   on your devices, that the client reported exactly what it changed, and that asking it to undo puts it back.

## Settings

| Variable | Default | Meaning |
|---|---|---|
| `PUHRR_ROOM_CODE_FILE` | — | File containing the room code (preferred) |
| `PUHRR_ROOM_CODE` | — | The room code itself, if no file is used |
| `PUHRR_TIMEZONE` | `Asia/Manila` | Timezone for "today" and Current Date/Time in reports. Set it to your own |
| `PUHRR_ALLOW_WRITES` | off | `1` adds the write tools |
| `PUHRR_DEVICE_NAME` | `mcp` | Name this connection shows under in sync |
| `PUHRR_USERNAME` | `mcp` | User name for the sync room |
| `PUHRR_SYNC_ENDPOINT` | PUHRR's Worker | Sync service URL |
| `LANG` | system's | Locale for date and time wording in reports. Set it to match what PUHRR shows on your phone |

## Notes

- Data is as fresh as the last sync from your devices, re-checked at most every 10 seconds per
  request. A device with PUHRR closed doesn't push, so its newest edits appear when it's opened.
- Merging is per record: if the server and you edit the **same record** (e.g. the same patient's
  profile) before either syncs, the later edit wins for that record. New entries from both survive.
- Every report is generated at the moment it's asked for, with the current time in `PUHRR_TIMEZONE`.
- The server's built-in instructions tell the client never to write or reformat a report itself,
  and (in write mode) the rules above.
