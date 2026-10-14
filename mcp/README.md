# puhrr-mcp — PUHRR for Medmin

An [MCP](https://modelcontextprotocol.io) server that lets an AI agent (Medmin, running on Hermes)
**read** the user's PUHRR data, generate reports from the user's own report templates, and — only
when switched on — **change** PUHRR.

- **Read-only by default.** Set `PUHRR_ALLOW_WRITES=1` to add the write tools. Without it the write
  tools do not exist, and the bridge has no way to upload anything.
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
| `list_templates` | Each template's exact format spelled out, plus a sample of its output |
| `preview_template` | A template on sample data |
| `render_report` | A template with real patients — **send the result exactly as returned** |

A name that doesn't match exactly (a ward, tag, template, saved view) is never guessed: the tool
answers with the closest existing ones so the agent can ask the user.

### Write tools (only with `PUHRR_ALLOW_WRITES=1`)

| Area | Tools |
|---|---|
| Patients | `add_patient`, `update_patient` (every profile field; `appendText` adds to long text), `set_ward`, `set_services`, `set_diagnosis`, `set_tags`, `create_tag` |
| Daily work | `add_vitals` / `update_vitals`, `add_medication` / `update_medication`, `add_order` / `update_order`, `add_lab` / `update_lab` (validated against the lab templates; calculated ABG fields filled in) |
| Checklist | `add_checklist_item` (with note), `edit_checklist_item`, `complete_checklist_item`, `reopen_checklist_item`, `delete_checklist_item`, `move_checklist_item` — for a patient or the General checklist |
| Problems and notes | `add_problem`, `edit_problem`, `set_problem_status`, `reorder_problems`, `set_daily_note` (S/O/A/P and per-problem notes) |
| Views and templates | `create_view`, `update_view`, `duplicate_template`, `update_template` (rename, on/off, and reword or reorder a format using the variables it already has) |
| Needs a yes first | `request_delete` (patient, vital, lab, medication, order, problem, view, template), `request_discharge`, then `confirm_action` |
| Safety | `recent_changes`, `undo_change` |

Not included: creating brand-new template variables (do that in PUHRR; Medmin can duplicate a
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
  are the one exception (single step, but undoable). The agent is instructed to get the user's yes
  in between; the code makes a one-shot accident impossible but cannot prove a human said yes.
- **Everything is logged and undoable.** Each change is recorded (what it was, to whom, and what
  every record looked like before and after), synced to the user's devices, and shown in PUHRR under
  Settings → Recent Medmin changes with an Undo button. Deleted patients and entries are recoverable
  for 30 days. Undo refuses if the thing was edited again since, unless the user agrees to overwrite.
- **No silent loss.** A change is made on the freshest copy of the room and uploaded before the
  answer comes back. If the room can't be reached, the answer says the change is **not** stored,
  and it is sent with the next change.

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
         # PUHRR_ALLOW_WRITES: "1"   # uncomment only when the user wants Medmin to make changes
   ```
   Use `node` directly, not `npm run`: npm prints a banner to stdout, which would corrupt the
   protocol. Then restart the Hermes gateway so it picks up the new server.

5. **Try it:** ask Medmin for the sync status, then for a census.

6. **Turning on changes (optional, later).** Update PUHRR on **every** device first (phone, MacBook)
   so each can show and undo what Medmin does: an older version will say it needs updating. Then
   add `PUHRR_ALLOW_WRITES: "1"` to the `env` block, restart the gateway, and try one small change
   (add a vitals entry to a test patient), then check it appears on the phone and in
   Settings → Recent Medmin changes.

## Settings

| Variable | Default | Meaning |
|---|---|---|
| `PUHRR_ROOM_CODE_FILE` | — | File containing the room code (preferred) |
| `PUHRR_ROOM_CODE` | — | The room code itself, if no file is used |
| `PUHRR_TIMEZONE` | `Asia/Manila` | Timezone for "today" and Current Date/Time in reports. Set it to the hospital's, not the VPS's |
| `PUHRR_ALLOW_WRITES` | off | `1` adds the write tools |
| `PUHRR_DEVICE_NAME` | `Medmin` | Name this connection shows under in sync |
| `PUHRR_USERNAME` | `Medmin` | User name for the sync room |
| `PUHRR_SYNC_ENDPOINT` | PUHRR's Worker | Sync service URL |
| `LANG` | server's | Locale for date and time wording in reports. Set it to match what PUHRR shows on the user's phone |

## Notes

- Data is as fresh as the last sync from the user's devices, re-checked at most every 10 seconds
  per question. A phone with PUHRR closed doesn't push, so its newest edits appear when it's opened.
- Merging is per record: if Medmin and the user edit the **same record** (e.g. the same patient's
  profile) before either syncs, the later edit wins for that record. New entries from both survive.
- Every report is generated at the moment it's asked for, with the current time in `PUHRR_TIMEZONE`.
- The server's built-in instructions tell the agent never to write or reformat a report itself, and (in write mode) the rules above.
  Keep Medmin's own prompt consistent with that.
