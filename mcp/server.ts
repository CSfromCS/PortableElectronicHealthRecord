import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import {
  type PatientSelection,
  ToolError,
  describeChecklist,
  describePatient,
  describeTemplate,
  findPatients,
  listTags,
  previewTemplate,
  renderReport,
  describeProblemLists,
  resolvePatient,
  resolveTemplate,
  selectPatients,
  summarizePatient,
} from './queries'
import type { RoomFollower } from './room'
import { registerWriteTools } from './writeTools'

const READ_ONLY_INSTRUCTIONS = `You are connected to PUHRR, the user's personal patient notebook, through the room it syncs to. This connection is READ-ONLY: nothing you call here can change PUHRR.

REPORTS: never write a report, census, endorsement or progress note yourself, and never reformat one from memory. Call render_report and send its text to the user exactly as returned — every character, line break and symbol. If the user wants a different format, they change the template in PUHRR; list_templates shows what exists. If they ask for something no template covers, say so and offer the closest template instead of improvising.

PATIENTS: identify a patient by room AND last name, or by patientId. If a tool reports that a name, ward, tag or template doesn't match exactly, or matches more than one, ask the user which they mean — do not guess. Always read back who you looked at (room and name).

FRESHNESS: data is current as of the last sync from the user's devices (see sync_status); changes the user made in the last few seconds may not be here yet.

PRIVACY: this is real patient data. Share it only with the user, in their private chat.`

const WRITE_INSTRUCTIONS = READ_ONLY_INSTRUCTIONS
  .replace('This connection is READ-ONLY: nothing you call here can change PUHRR.', 'You can read AND change PUHRR. Changes appear on the user\'s devices within seconds.')
  + `

CHANGING THINGS — these rules protect real patients:
- Name the patient by room AND last name, every time. If the answer reports no match or several, ask the user; never pick one. Each result repeats who was changed: read it back to the user in one line, so a slip is caught at once.
- Do exactly what was asked, no more. Never fill in clinical content the user did not give you, and never "tidy" existing text.
- Tags, wards and services must already exist. If a name does not match exactly, the tool lists the closest ones: ask the user which they mean. The user may spell wards differently from one day to the next ("MICU" vs "Medical ICU"); assume it is the same place and offer the existing one before ever suggesting a new tag. Only call create_tag when the user says they want a new one.
- Deleting and discharging are two steps. request_delete / request_discharge change nothing and return a code and a plain description. Tell the user that description, and call confirm_action only after they clearly say yes to it. Never confirm on your own initiative, never reuse a code for something else, and never describe the action differently from the tool.
- After EVERY change, tell the user exactly what you did, from the tool's answer and nothing else: who (room and last name), then each field or entry that changed with its old and new value (deleted items: what was removed). Do not summarize it away or add what the tool did not say. Keep it short. If a call changed nothing, say so. The app has no history screen, so this message is the user's only record of the edit.
- Changes cannot be undone, and a deletion cannot be brought back. Delete a checklist item or Simple Problem List line only when the user clearly asked for exactly that. If the user says "that was wrong", recent_changes shows what was changed and its old values: tell them what the old values were and put them back only if they ask you to, as a new change.
- Problem lists: draft them in your reply first (simple lines: positive findings and key negatives; then master problems with the date each was identified and which lines are grouped under each). Write only after the user approves or corrects the draft, with create_problem_lists. Never write a drafted list on your own.
- If a result says the change could not be stored in the sync room, tell the user plainly: it is not yet on their devices.`

const selectionShape = {
  patientIds: z.array(z.number().int()).optional().describe('Exact patients, in the order to report them. Overrides every filter below.'),
  pool: z.array(z.enum(['active', 'admitted', 'discharged', 'referred', 'all'])).optional().describe('Which patients: default ["active"]. Several combine with OR, like the Patient Pool filter in PUHRR.'),
  windowHours: z.number().positive().optional().describe('For admitted/discharged/referred: how many hours back to look (default 12).'),
  tags: z.array(z.string()).optional().describe('Exact tag names to filter by.'),
  tagMode: z.enum(['AND', 'OR']).optional().describe('Whether a patient needs all the tags (AND) or any (OR). Default OR.'),
  wards: z.array(z.string()).optional().describe('Exact ward names to filter by.'),
  view: z.string().optional().describe('Name of a saved view; applies its filters and its sort. Use instead of tags/wards.'),
  sort: z.array(z.object({
    field: z.enum(['ward', 'room', 'name', 'admitDate', 'tagOrder']),
    direction: z.enum(['asc', 'desc']).optional(),
    tags: z.array(z.string()).optional().describe('For tagOrder: tag names in priority order.'),
  })).optional().describe('Sort levels, each breaking ties left by the one before. Default: room, then name.'),
}

const patientRefShape = {
  patientId: z.number().int().optional(),
  room: z.string().optional().describe('Room number as written in PUHRR. Use together with lastName.'),
  lastName: z.string().optional(),
}

type TextResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean; structuredContent?: Record<string, unknown> }

const json = (value: unknown): TextResult => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] })

/** Runs a tool and turns a fixable problem (ToolError) into an answer the model can act on. */
const run = async (task: () => Promise<TextResult> | TextResult): Promise<TextResult> => {
  try {
    return await task()
  } catch (error) {
    if (error instanceof ToolError) return { isError: true, content: [{ type: 'text', text: error.message }] }
    const message = error instanceof Error ? error.message : String(error)
    return { isError: true, content: [{ type: 'text', text: `PUHRR could not complete that: ${message}` }] }
  }
}

export const createPuhrrServer = (room: RoomFollower): McpServer => {
  const server = new McpServer({ name: 'puhrr', version: '0.2.0' }, { instructions: room.allowWrites ? WRITE_INSTRUCTIONS : READ_ONLY_INSTRUCTIONS })

  server.registerTool('sync_status', {
    description: 'When this connection last downloaded the room, and when the room itself last changed. Use refresh=true right after the user says they just edited something.',
    inputSchema: { refresh: z.boolean().optional() },
  }, ({ refresh }) => run(async () => {
    const world = refresh ? await room.forceRefresh() : await room.getWorld()
    return json({
      ...room.status(),
      patients: world.patients.length,
      activePatients: selectPatients(world).patients.length,
      templates: world.templates.length,
      access: room.allowWrites ? 'read-write' : 'read-only',
    })
  }))

  server.registerTool('list_tags', {
    description: 'Every tag group and its tags (wards, services, statuses, ...), with how many patients carry each. Use to check exact names before filtering.',
    inputSchema: {},
  }, () => run(async () => json(listTags(await room.getWorld()))))

  server.registerTool('find_patient', {
    description: 'Look patients up by any words in their room, name or ward. Returns every match so you can see whether it is ambiguous.',
    inputSchema: { query: z.string().describe('e.g. "12B cruz" or "dela cruz"') },
  }, ({ query }) => run(async () => json(findPatients(await room.getWorld(), query))))

  server.registerTool('list_patients', {
    description: "Patients as the Patients list shows them, with PUHRR's own filter, sort and saved views. Defaults to active patients sorted by room then name.",
    inputSchema: selectionShape,
  }, (selection) => run(async () => {
    const world = await room.getWorld()
    const { patients } = selectPatients(world, selection as PatientSelection)
    return json({ count: patients.length, patients: patients.map((patient) => summarizePatient(patient, world)) })
  }))

  server.registerTool('get_patient', {
    description: 'Everything PUHRR holds about one patient: profile, services, diagnoses, problems with that day\'s notes, checklist, vitals, medications, orders and labs. For a report, use render_report instead — never rebuild one from this.',
    inputSchema: {
      ...patientRefShape,
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('YYYY-MM-DD for the notes and checklist; default today.'),
      recentEntries: z.number().int().positive().max(100).optional().describe('How many of the latest vitals and labs to include (default 10).'),
    },
  }, ({ date, recentEntries, ...ref }) => run(async () => {
    const world = await room.getWorld()
    return json(describePatient(world, resolvePatient(world, ref), { date, recentEntries }))
  }))

  server.registerTool('get_checklist', {
    description: "Exactly what PUHRR's Master Checklist shows for a date across active patients (plus the General checklist): today's items, with unfinished items from earlier days carried forward, each with its note.",
    inputSchema: {
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('YYYY-MM-DD; default today.'),
      ...selectionShape,
    },
  }, ({ date, ...selection }) => run(async () => json(describeChecklist(await room.getWorld(), date, selection as PatientSelection))))

  server.registerTool('get_problem_lists', {
    description: "A patient's Simple Problem List (each line with its itemId and the master problems it is grouped under) and Master Problem List (numbered like the Problems tab, with sub-problems, status and date identified). Read this before adding or changing anything.",
    inputSchema: { ...patientRefShape },
  }, (ref) => run(async () => json(describeProblemLists(await room.getWorld(), resolvePatient(await room.getWorld(), ref)))))

  server.registerTool('list_custom_actions', {
    description: "The user's custom actions (the buttons in PUHRR, such as Start Admission Papers): what each adds to the checklist, which tags it needs or changes, and whether it is a button (manual) or fires by itself when a tag is added (automatic). Use run_custom_action to press a manual one.",
    inputSchema: {},
  }, () => run(async () => {
    const world = await room.getWorld()
    const names = (ids: number[]) => ids.map((id) => world.tagsById.get(id)?.name ?? `#${id}`)
    const effects = (list: Array<{ tagId: number; action: 'add' | 'remove' }>) => list.map((effect) => `${effect.action} ${names([effect.tagId])[0]}`)
    return json(world.customActions.map((action) => ({
      name: action.name,
      id: action.id,
      enabled: !action.disabled,
      for: action.scope === 'patient' ? 'one patient (room + last name)' : 'General checklist (no patient)',
      trigger: action.triggerType === 'automatic' ? `automatic: when the tag ${names(action.triggerTagId !== undefined ? [action.triggerTagId] : [])[0] ?? '?'} is added` : 'manual button',
      alwaysAdds: action.checklistItems,
      alwaysTagEffects: effects(action.tagEffects),
      conditions: action.conditions.map((condition) => ({
        needsTags: names(condition.requiredTagIds),
        ...(condition.daysOfWeek?.length ? { daysOfWeek: condition.daysOfWeek } : {}),
        ...(condition.daysOfMonth?.length ? { daysOfMonth: condition.daysOfMonth } : {}),
        adds: condition.checklistItems,
        tagEffects: effects(condition.tagEffects),
      })),
      ...(action.templateRunTemplateId !== undefined ? { rendersTemplate: world.templates.find((template) => template.id === action.templateRunTemplateId)?.name ?? `#${action.templateRunTemplateId}` } : {}),
    })))
  }))

  server.registerTool('list_views', {
    description: 'Saved views (named filter + sort combinations) the user made in PUHRR.',
    inputSchema: {},
  }, () => run(async () => {
    const world = await room.getWorld()
    return json(world.views.map((view) => ({
      name: view.name,
      enabled: !view.disabled,
      tags: view.tagIds.map((id) => world.tagsById.get(id)?.name ?? `#${id}`),
      tagMode: view.tagMode,
      wards: view.wardTagIds.map((id) => world.tagsById.get(id)?.name ?? `#${id}`),
      sort: view.sortConfig?.levels.map((level) => `${level.field} ${level.direction}`) ?? 'unchanged',
    })))
  }))

  server.registerTool('list_templates', {
    description: 'The report templates the user made, each with its exact format spelled out (literal text with ⟨variables⟩ where PUHRR fills in data) and a sample of its output. This is the authority on how a report is formatted.',
    inputSchema: { includeDisabled: z.boolean().optional(), includeSamples: z.boolean().optional().describe('Default true.') },
  }, ({ includeDisabled, includeSamples }) => run(async () => {
    const world = await room.getWorld()
    return json(world.templates
      .filter((template) => includeDisabled || !template.disabled)
      .map((template) => describeTemplate(template, world, includeSamples ?? true)))
  }))

  server.registerTool('preview_template', {
    description: 'A template rendered on made-up sample data, to show the user what it looks like. Not for real reports.',
    inputSchema: { templateId: z.number().int().optional(), name: z.string().optional() },
  }, (ref) => run(async () => {
    const world = await room.getWorld()
    const template = resolveTemplate(world, ref)
    return { content: [{ type: 'text', text: previewTemplate(world, template) }] }
  }))

  server.registerTool('render_report', {
    description: "Generate a report from one of the user's templates with real patient data — the same text PUHRR's Reports tab produces. SEND THE RESULT TO THE USER EXACTLY AS RETURNED; do not rephrase, reorder, summarize or fix it. Choose patients by patientIds, or with the same filter/sort/saved-view options as list_patients (default: all active patients).",
    inputSchema: { templateId: z.number().int().optional(), name: z.string().optional().describe('Exact template name.'), ...selectionShape },
  }, ({ templateId, name, ...selection }) => run(async () => {
    const world = await room.getWorld()
    const template = resolveTemplate(world, { templateId, name })
    const { text, patients } = renderReport(world, template, selection as PatientSelection)
    return {
      content: [{ type: 'text', text }],
      structuredContent: { template: template.name, patients, generatedAt: new Date().toISOString() },
    }
  }))

  if (room.allowWrites) registerWriteTools(server, room)
  return server
}
