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
  resolvePatient,
  resolveTemplate,
  selectPatients,
  summarizePatient,
} from './queries'
import type { RoomFollower } from './room'

const INSTRUCTIONS = `You are connected to PUHRR, the user's personal patient notebook, through the room it syncs to. This connection is READ-ONLY: nothing you call here can change PUHRR.

REPORTS: never write a report, census, endorsement or progress note yourself, and never reformat one from memory. Call render_report and send its text to the user exactly as returned — every character, line break and symbol. If the user wants a different format, they change the template in PUHRR; list_templates shows what exists. If they ask for something no template covers, say so and offer the closest template instead of improvising.

PATIENTS: identify a patient by room AND last name, or by patientId. If a tool reports that a name, ward, tag or template doesn't match exactly, or matches more than one, ask the user which they mean — do not guess. Always read back who you looked at (room and name).

FRESHNESS: data is current as of the last sync from the user's devices (see sync_status); changes the user made in the last few seconds may not be here yet.

PRIVACY: this is real patient data. Share it only with the user, in their private chat.`

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
  const server = new McpServer({ name: 'puhrr', version: '0.1.0' }, { instructions: INSTRUCTIONS })

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
      access: 'read-only',
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

  return server
}
