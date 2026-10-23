import { randomInt } from 'node:crypto'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { listChanges, recordChange } from '@/features/changes/changeLog'
import type { Patient } from '@/types'
import {
  type ChecklistTarget,
  type Done,
  type PatientRef,
  addChecklistItem,
  addLab,
  addMedication,
  addOrder,
  addPatient,
  addProblem,
  addSimpleProblems,
  addVitals,
  createProblemLists,
  createTag,
  createView,
  deleteChecklistItem,
  deleteSimpleProblems,
  dischargePatient,
  duplicateTemplate,
  editChecklistItem,
  editProblem,
  editSimpleProblem,
  groupSimpleProblems,
  moveChecklistItem,
  planDelete,
  runCustomAction,
  reorderProblems,
  reorderSimpleProblems,
  resolvePatientForWrite,
  setChecklistItemDone,
  setDailyNote,
  setDiagnosis,
  setProblemStatus,
  setServices,
  setTags,
  setWard,
  updateLab,
  updateMedication,
  updateOrder,
  updatePatient,
  updateTemplate,
  updateView,
  updateVitals,
} from './mutations'
import { describeOps } from './describeChanges'
import { ToolError, patientIdentifier, resolveCustomAction } from './queries'
import type { RoomFollower } from './room'
import type { World } from './world'

type TextResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean }
const json = (value: unknown): TextResult => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] })

const run = async (task: () => Promise<TextResult>): Promise<TextResult> => {
  try {
    return await task()
  } catch (error) {
    if (error instanceof ToolError) return { isError: true, content: [{ type: 'text', text: error.message }] }
    const message = error instanceof Error ? error.message : String(error)
    return { isError: true, content: [{ type: 'text', text: `PUHRR could not complete that, and nothing was changed: ${message}` }] }
  }
}

const SOURCE = 'mcp'

/**
 * Makes one change and reports it: on the freshest copy of the room, recorded in the change log
 * (so it can be listed), then uploaded before this returns. The answer always names who was
 * changed and which fields.
 */
const act = (room: RoomFollower, tool: string, handler: (world: World) => Promise<Done>): Promise<TextResult> => run(async () => {
  const outcome = await room.write((world) => recordChange({ source: SOURCE, tool, summary: tool }, async (context) => {
    const done = await handler(world)
    context.setSummary(done.summary)
    if (done.patient) context.setPatient({ id: done.patient.id, identifier: patientIdentifier(done.patient) })
    return done
  }))
  const { result, entryId, ops, moreOps } = outcome.result
  return json({
    done: entryId !== null,
    summary: result.summary,
    ...(result.report ? { report: result.report } : {}),
    ...(entryId !== null ? describeOps(ops, moreOps) : { note: 'Nothing needed to change.' }),
    storedInRoom: outcome.stored,
    ...(outcome.warning ? { warning: outcome.warning } : {}),
  })
})

const patientShape = {
  room: z.string().describe("The patient's room exactly as PUHRR shows it. Always give the room AND last name."),
  lastName: z.string(),
  patientId: z.number().int().optional().describe('Only to settle two patients who share a room and last name.'),
}
const toRef = (input: { room: string; lastName: string; patientId?: number }): PatientRef => ({ room: input.room, lastName: input.lastName, patientId: input.patientId })

/** A checklist belongs to a patient, or to the General checklist. */
const checklistShape = {
  room: z.string().optional().describe('With lastName: whose checklist. Omit both for the General (no patient) checklist.'),
  lastName: z.string().optional(),
  patientId: z.number().int().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('YYYY-MM-DD; default today.'),
}
const checklistTarget = (world: World, input: { room?: string; lastName?: string; patientId?: number; date?: string }): ChecklistTarget => {
  if (!input.room && !input.lastName) return { patient: null, date: input.date }
  return { patient: resolvePatientForWrite(world, { room: input.room ?? '', lastName: input.lastName ?? '', patientId: input.patientId }), date: input.date }
}
const itemShape = {
  index: z.number().int().min(0).optional().describe('The index shown by get_checklist.'),
  text: z.string().optional().describe('The item\'s exact text; use the index if two items read the same.'),
}

const selectionShape = {
  tags: z.array(z.string()).optional(),
  tagMode: z.enum(['AND', 'OR']).optional(),
  wards: z.array(z.string()).optional(),
  sort: z.array(z.object({
    field: z.enum(['ward', 'room', 'name', 'admitDate', 'tagOrder']),
    direction: z.enum(['asc', 'desc']).optional(),
    tags: z.array(z.string()).optional(),
  })).optional(),
}

// --- Actions that need the user's yes first ---------------------------------------------------------------------

type PendingAction = { tool: string; summary: string; expiresAt: number; run: (world: World) => Promise<Done> }
const PENDING_MINUTES = 10
// No 0/O or 1/I/L: the user may be asked to read this back.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const newCode = (taken: Set<string>): string => {
  for (;;) {
    const code = Array.from({ length: 4 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('')
    if (!taken.has(code)) return code
  }
}

export const registerWriteTools = (server: McpServer, room: RoomFollower): void => {
  const pending = new Map<string, PendingAction>()
  const hold = (action: Omit<PendingAction, 'expiresAt'>): TextResult => {
    const now = Date.now()
    for (const [code, entry] of pending) if (entry.expiresAt < now) pending.delete(code)
    const code = newCode(new Set(pending.keys()))
    pending.set(code, { ...action, expiresAt: now + PENDING_MINUTES * 60_000 })
    return json({
      confirmationCode: code,
      willDo: action.summary,
      nothingChangedYet: true,
      next: `Tell the user exactly what is above and ask if they want it. Only if they clearly say yes, call confirm_action with this code (valid ${PENDING_MINUTES} minutes). This cannot be undone afterwards.`,
    })
  }

  // --- Patients ---------------------------------------------------------------------------------------------

  server.registerTool('add_patient', {
    description: 'Add a patient. The ward and services must already exist (check list_tags); a name that does not match exactly is refused with the closest existing ones.',
    inputSchema: {
      room: z.string(), lastName: z.string(), firstName: z.string().optional(), age: z.number().int().min(0).max(130).optional(),
      sex: z.enum(['M', 'F', 'O']).optional(), ward: z.string().optional(), mainServices: z.array(z.string()).optional(), attendingPhysician: z.string().optional(),
    },
  }, (input) => act(room, 'add_patient', (world) => addPatient(world, input)))

  server.registerTool('update_patient', {
    description: 'Edit any profile field of a patient: name, room, age, sex, attending, admission/referral/discharge dates and times, clinical summary, Database, plans, medications, labs, pendings. For the long text fields, appendText adds to what is there instead of replacing it. Ward, services, diagnoses and tags have their own tools.',
    inputSchema: {
      ...patientShape,
      newRoom: z.string().optional(), newLastName: z.string().optional(), firstName: z.string().optional(), middleName: z.string().optional(),
      age: z.number().int().min(0).max(130).optional(), sex: z.enum(['M', 'F', 'O']).optional(), attendingPhysician: z.string().optional(),
      admitDate: z.string().optional(), admitTime: z.string().optional(), referralDate: z.string().optional(), referralTime: z.string().optional(),
      dischargeDate: z.string().optional(), dischargeTime: z.string().optional(),
      clinicalSummary: z.string().optional(), database: z.string().optional(), plans: z.string().optional(), medications: z.string().optional(),
      labs: z.string().optional(), pendings: z.string().optional(),
      appendText: z.boolean().optional().describe('Add to the long text fields instead of replacing them.'),
    },
  }, ({ room: roomNumber, lastName, patientId, newRoom, newLastName, appendText, ...fields }) => act(room, 'update_patient', (world) => {
    const patient = resolvePatientForWrite(world, { room: roomNumber, lastName, patientId })
    return updatePatient(world, patient, { ...fields, room: newRoom, lastName: newLastName }, Boolean(appendText))
  }))

  server.registerTool('set_ward', {
    description: 'Set or clear a patient\'s ward. The ward must already exist; if the name does not match one exactly you get the closest existing wards to ask the user about.',
    inputSchema: { ...patientShape, ward: z.string().nullable().describe('The ward name, or null to clear it.') },
  }, ({ ward, ...ref }) => act(room, 'set_ward', (world) => setWard(world, resolvePatientForWrite(world, toRef(ref)), ward)))

  server.registerTool('set_services', {
    description: 'Add or remove a patient\'s Main services and Referral services. Services must already exist.',
    inputSchema: { ...patientShape, addMain: z.array(z.string()).optional(), removeMain: z.array(z.string()).optional(), addReferral: z.array(z.string()).optional(), removeReferral: z.array(z.string()).optional() },
  }, ({ addMain, removeMain, addReferral, removeReferral, ...ref }) => act(room, 'set_services', (world) =>
    setServices(world, resolvePatientForWrite(world, toRef(ref)), { addMain, removeMain, addReferral, removeReferral })))

  server.registerTool('set_diagnosis', {
    description: 'Set a patient\'s admission or discharge diagnosis. With several services, say which service it is for.',
    inputSchema: { ...patientShape, kind: z.enum(['admission', 'discharge']), text: z.string(), service: z.string().optional() },
  }, ({ kind, text, service, ...ref }) => act(room, 'set_diagnosis', (world) => setDiagnosis(world, resolvePatientForWrite(world, toRef(ref)), { kind, text, service })))

  server.registerTool('set_tags', {
    description: 'Add or remove existing tags on a patient (not ward or service tags, and not tags that discharge a patient). Adding a tag runs the same automatic custom actions PUHRR runs. A tag name that does not match exactly is refused with the closest existing ones; never create a tag just to make a name fit.',
    inputSchema: { ...patientShape, add: z.array(z.string()).optional(), remove: z.array(z.string()).optional() },
  }, ({ add, remove, ...ref }) => act(room, 'set_tags', (world) => setTags(world, resolvePatientForWrite(world, toRef(ref)), { add, remove })))

  server.registerTool('run_custom_action', {
    description: "Press one of the user's manual custom action buttons (e.g. Start Admission Papers) exactly as PUHRR does: it adds that action's checklist items for the patient (or the General checklist) and applies its tag effects; items already listed are skipped. Patient actions need room AND last name; General actions take none. If no condition matches the patient it does nothing and says which tags are missing: tell the user and add a tag only if they say so. A General action with a template also returns its rendered report: pass `report.text` on exactly as returned. Find names with list_custom_actions.",
    inputSchema: {
      name: z.string().optional().describe('Exact action name.'),
      actionId: z.number().int().optional(),
      room: z.string().optional().describe('With lastName, for patient actions.'),
      lastName: z.string().optional(),
      patientId: z.number().int().optional().describe('Only to settle two patients who share a room and last name.'),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Checklist date, YYYY-MM-DD; default today.'),
    },
  }, ({ name, actionId, room: r, lastName, patientId, date }) => act(room, 'run_custom_action', (world) => {
    const action = resolveCustomAction(world, { name, actionId })
    const patient = r !== undefined || lastName !== undefined || patientId !== undefined
      ? resolvePatientForWrite(world, toRef({ room: r ?? '', lastName: lastName ?? '', patientId }))
      : null
    return runCustomAction(world, { action, patient, date })
  }))

  server.registerTool('create_tag', {
    description: 'Create a new tag. Only after the user has said they want a NEW tag with this exact name, because the usual cause of a near-miss is that the tag already exists under another spelling. Similar existing tags block this unless the user confirmed none of them is meant.',
    inputSchema: {
      name: z.string(), group: z.string().describe('An existing tag group, e.g. Ward or Service.'),
      userApprovedName: z.string().describe('The exact name the user approved, repeated to prove they were asked.'),
      allowSimilar: z.boolean().optional().describe('Only after the user said none of the similar existing tags is what they mean.'),
    },
  }, ({ name, group, userApprovedName, allowSimilar }) => act(room, 'create_tag', (world) => {
    if (userApprovedName.trim().toLowerCase() !== name.trim().toLowerCase()) throw new ToolError('userApprovedName must be the exact name the user approved. Ask the user first.')
    return createTag(world, { name, group, allowSimilar })
  }))

  server.registerTool('request_discharge', {
    description: 'Step one of discharging a patient (tagging them Discharged, which makes them inactive). Changes nothing: it returns a code. Tell the user what will happen, and only after a clear yes call confirm_action.',
    inputSchema: { ...patientShape, tag: z.string().optional().describe('A terminal tag other than Discharged, e.g. Expired.') },
  }, ({ tag, ...ref }) => run(async () => {
    const world = await room.forceRefresh()
    const patient = resolvePatientForWrite(world, toRef(ref))
    return hold({
      tool: 'discharge_patient',
      summary: `Mark ${patientIdentifier(patient)} as ${tag ?? 'Discharged'} (they stop showing among active patients).`,
      run: (fresh) => dischargePatient(fresh, resolvePatientForWrite(fresh, toRef(ref)), tag),
    })
  }))

  // --- Vitals, medications, orders, labs ------------------------------------------------------------------------

  const vitalsShape = { date: z.string().optional(), time: z.string().optional(), bp: z.string().optional(), hr: z.string().optional(), rr: z.string().optional(), temp: z.string().optional(), spo2: z.string().optional(), note: z.string().optional() }
  server.registerTool('add_vitals', {
    description: 'Record vital signs for a patient. Date and time default to now (hospital time). Values are stored as text exactly as given, like the vitals tab.',
    inputSchema: { ...patientShape, ...vitalsShape },
  }, ({ room: r, lastName, patientId, ...input }) => act(room, 'add_vitals', (world) => addVitals(resolvePatientForWrite(world, { room: r, lastName, patientId }), input)))
  server.registerTool('update_vitals', {
    description: 'Edit an existing vitals entry (ids are in get_patient).',
    inputSchema: { ...patientShape, vitalId: z.number().int(), ...vitalsShape },
  }, ({ room: r, lastName, patientId, vitalId, ...input }) => act(room, 'update_vitals', (world) => updateVitals(resolvePatientForWrite(world, { room: r, lastName, patientId }), vitalId, input)))

  const medicationShape = { medication: z.string().optional(), dose: z.string().optional(), route: z.string().optional(), frequency: z.string().optional(), note: z.string().optional(), status: z.enum(['active', 'discontinued', 'completed']).optional() }
  server.registerTool('add_medication', { description: 'Add a medication to a patient.', inputSchema: { ...patientShape, ...medicationShape } },
    ({ room: r, lastName, patientId, ...input }) => act(room, 'add_medication', (world) => addMedication(resolvePatientForWrite(world, { room: r, lastName, patientId }), input)))
  server.registerTool('update_medication', { description: 'Edit a medication, including setting its status to discontinued or completed.', inputSchema: { ...patientShape, medicationId: z.number().int(), ...medicationShape } },
    ({ room: r, lastName, patientId, medicationId, ...input }) => act(room, 'update_medication', (world) => updateMedication(resolvePatientForWrite(world, { room: r, lastName, patientId }), medicationId, input)))

  const orderShape = { orderText: z.string().optional(), service: z.string().optional(), date: z.string().optional(), time: z.string().optional(), note: z.string().optional().describe('Side notes shown beside the order.') }
  server.registerTool('add_order', { description: 'Add a doctor\'s order for a patient.', inputSchema: { ...patientShape, ...orderShape } },
    ({ room: r, lastName, patientId, ...input }) => act(room, 'add_order', (world) => addOrder(resolvePatientForWrite(world, { room: r, lastName, patientId }), input)))
  server.registerTool('update_order', { description: 'Edit an order.', inputSchema: { ...patientShape, orderId: z.number().int(), ...orderShape } },
    ({ room: r, lastName, patientId, orderId, ...input }) => act(room, 'update_order', (world) => updateOrder(resolvePatientForWrite(world, { room: r, lastName, patientId }), orderId, input)))

  server.registerTool('add_lab', {
    description: 'Record a lab result from one of PUHRR\'s lab templates (CBC, urinalysis, chemistry, ABG, Others, ...). results maps each field name to its value; field names must match the template or you get the list. Calculated ABG fields are filled in as PUHRR does.',
    inputSchema: { ...patientShape, template: z.string().describe('Template name or id.'), results: z.record(z.string(), z.string()), date: z.string().optional(), time: z.string().optional(), note: z.string().optional() },
  }, ({ room: r, lastName, patientId, ...input }) => act(room, 'add_lab', (world) => addLab(resolvePatientForWrite(world, { room: r, lastName, patientId }), input)))
  server.registerTool('update_lab', {
    description: 'Edit a lab entry: results are merged in (an empty value clears that field).',
    inputSchema: { ...patientShape, labId: z.number().int(), results: z.record(z.string(), z.string()).optional(), date: z.string().optional(), time: z.string().optional(), note: z.string().optional() },
  }, ({ room: r, lastName, patientId, labId, ...input }) => act(room, 'update_lab', (world) => updateLab(resolvePatientForWrite(world, { room: r, lastName, patientId }), labId, input)))

  // --- Checklist -----------------------------------------------------------------------------------------------------

  server.registerTool('add_checklist_item', {
    description: 'Add an item (with an optional note) to a patient\'s checklist for a date, or to the General checklist.',
    inputSchema: { ...checklistShape, text: z.string(), notes: z.string().optional() },
  }, ({ text, notes, ...target }) => act(room, 'add_checklist_item', (world) => addChecklistItem(checklistTarget(world, target), text, notes)))
  server.registerTool('edit_checklist_item', {
    description: 'Change an item\'s text and/or note (an empty note clears it).',
    inputSchema: { ...checklistShape, ...itemShape, newText: z.string().optional(), notes: z.string().optional() },
  }, ({ index, text, newText, notes, ...target }) => act(room, 'edit_checklist_item', (world) => editChecklistItem(checklistTarget(world, target), { index, text }, { text: newText, notes })))
  server.registerTool('complete_checklist_item', { description: 'Check an item off; it moves to the bottom.', inputSchema: { ...checklistShape, ...itemShape } },
    ({ index, text, ...target }) => act(room, 'complete_checklist_item', (world) => setChecklistItemDone(checklistTarget(world, target), { index, text }, true)))
  server.registerTool('reopen_checklist_item', { description: 'Un-check a completed item; it moves back up.', inputSchema: { ...checklistShape, ...itemShape } },
    ({ index, text, ...target }) => act(room, 'reopen_checklist_item', (world) => setChecklistItemDone(checklistTarget(world, target), { index, text }, false)))
  server.registerTool('delete_checklist_item', {
    description: 'Remove a checklist item. One step, with no confirmation and no undo: only when the user clearly asked for exactly this item to go.',
    inputSchema: { ...checklistShape, ...itemShape },
  }, ({ index, text, ...target }) => act(room, 'delete_checklist_item', (world) => deleteChecklistItem(checklistTarget(world, target), { index, text })))
  server.registerTool('move_checklist_item', {
    description: 'Move an item to just before or after another item.',
    inputSchema: {
      ...checklistShape, ...itemShape,
      before: z.object(itemShape).optional(), after: z.object(itemShape).optional(),
    },
  }, ({ index, text, before, after, ...target }) => act(room, 'move_checklist_item', (world) => moveChecklistItem(checklistTarget(world, target), { index, text }, { before, after })))

  // --- Problems and notes ---------------------------------------------------------------------------------------------

  const problemRef = { problemId: z.number().int().optional(), problemTitle: z.string().optional() }
  server.registerTool('add_problem', {
    description: 'Add a problem to a patient\'s problem list (optionally as a sub-problem of another).',
    inputSchema: { ...patientShape, title: z.string(), parentProblemId: z.number().int().optional(), parentProblemTitle: z.string().optional(), dateIdentified: z.string().optional() },
  }, ({ title, parentProblemId, parentProblemTitle, dateIdentified, ...ref }) => act(room, 'add_problem', (world) =>
    addProblem(world, resolvePatientForWrite(world, toRef(ref)), { title, parent: { problemId: parentProblemId, title: parentProblemTitle }, dateIdentified })))
  server.registerTool('edit_problem', {
    description: 'Rename a problem (the old name is kept in its history) or edit its date identified or resolution notes.',
    inputSchema: { ...patientShape, ...problemRef, newTitle: z.string().optional(), dateIdentified: z.string().optional(), resolutionNotes: z.string().optional() },
  }, ({ problemId, problemTitle, newTitle, dateIdentified, resolutionNotes, ...ref }) => act(room, 'edit_problem', (world) =>
    editProblem(world, resolvePatientForWrite(world, toRef(ref)), { problemId, title: problemTitle }, { title: newTitle, dateIdentified, resolutionNotes })))
  server.registerTool('set_problem_status', {
    description: 'Resolve a problem (optionally into another problem) or reopen it.',
    inputSchema: { ...patientShape, ...problemRef, status: z.enum(['active', 'resolved']), date: z.string().optional(), resolutionNotes: z.string().optional(), resolvedIntoProblemId: z.number().int().optional() },
  }, ({ problemId, problemTitle, status, date, resolutionNotes, resolvedIntoProblemId, ...ref }) => act(room, 'set_problem_status', (world) =>
    setProblemStatus(world, resolvePatientForWrite(world, toRef(ref)), { problemId, title: problemTitle }, { status, date, resolutionNotes, resolvedInto: { problemId: resolvedIntoProblemId } })))
  server.registerTool('reorder_problems', {
    description: 'Set the order of a patient\'s problems (or the sub-problems of one). order lists every problem id once, first to last.',
    inputSchema: { ...patientShape, order: z.array(z.number().int()), parentProblemId: z.number().int().optional() },
  }, ({ order, parentProblemId, ...ref }) => act(room, 'reorder_problems', (world) =>
    reorderProblems(world, resolvePatientForWrite(world, toRef(ref)), { order, parent: { problemId: parentProblemId } })))
  // --- Simple problem list --------------------------------------------------------------------------------------------

  const simpleRefShape = { itemId: z.number().int().optional(), text: z.string().optional().describe('The exact text of the line.') }
  server.registerTool('add_simple_problems', {
    description: 'Add lines to the end of a patient\'s Simple Problem List: one salient finding per line, as in the Simple Problem List tab. Lines already on the list are skipped. Call get_problem_lists first so you do not repeat what is there.',
    inputSchema: { ...patientShape, lines: z.array(z.string()).min(1) },
  }, ({ lines, ...ref }) => act(room, 'add_simple_problems', (world) => addSimpleProblems(resolvePatientForWrite(world, toRef(ref)), lines)))
  server.registerTool('edit_simple_problem', {
    description: 'Reword one line of the Simple Problem List (by itemId or its exact current text).',
    inputSchema: { ...patientShape, ...simpleRefShape, newText: z.string() },
  }, ({ itemId, text, newText, ...ref }) => act(room, 'edit_simple_problem', (world) => editSimpleProblem(resolvePatientForWrite(world, toRef(ref)), { itemId, text }, newText)))
  server.registerTool('delete_simple_problems', {
    description: 'Remove lines from the Simple Problem List. One step, with no confirmation and no undo: only when the user clearly asked for exactly these lines to go.',
    inputSchema: { ...patientShape, lines: z.array(z.object(simpleRefShape)).min(1) },
  }, ({ lines, ...ref }) => act(room, 'delete_simple_problems', (world) => deleteSimpleProblems(resolvePatientForWrite(world, toRef(ref)), lines)))
  server.registerTool('reorder_simple_problems', {
    description: 'Set the order of the Simple Problem List. order lists every line\'s itemId once, first to last.',
    inputSchema: { ...patientShape, order: z.array(z.number().int()) },
  }, ({ order, ...ref }) => act(room, 'reorder_simple_problems', (world) => reorderSimpleProblems(resolvePatientForWrite(world, toRef(ref)), order)))
  server.registerTool('group_simple_problems', {
    description: 'Group Simple Problem List lines under a master problem (color-coding them to it), or take them out of it again. A line can sit under several problems. The problem must already exist and be active (add_problem or create_problem_lists).',
    inputSchema: {
      ...patientShape,
      lines: z.array(z.object(simpleRefShape)).min(1),
      problemId: z.number().int().optional(), problemTitle: z.string().optional(),
      action: z.enum(['group', 'ungroup']).optional().describe('Default group.'),
    },
  }, ({ lines, problemId, problemTitle, action, ...ref }) => act(room, 'group_simple_problems', (world) =>
    groupSimpleProblems(world, resolvePatientForWrite(world, toRef(ref)), lines, { problemId, title: problemTitle }, action ?? 'group')))
  server.registerTool('create_problem_lists', {
    description: 'Write an APPROVED problem list package in one step: the Simple Problem List lines, the master problems (with sub-problems and the date each was identified) and which lines are grouped under which problem. Use it only after the user has seen and approved the proposal. Lines and problems that already exist are reused. dateIdentified is YYYY-MM-DD (or YYYY-MM / YYYY when only partly known); leave it out to mean the admission date.',
    inputSchema: {
      ...patientShape,
      simpleItems: z.array(z.string()).optional().describe('Simple-list lines, in order.'),
      problems: z.array(z.object({
        title: z.string(), dateIdentified: z.string().optional(),
        items: z.array(z.string()).optional().describe('Exact texts of simple-list lines to group under this problem.'),
        subProblems: z.array(z.object({ title: z.string(), dateIdentified: z.string().optional(), items: z.array(z.string()).optional() })).optional(),
      })),
    },
  }, ({ simpleItems, problems, ...ref }) => act(room, 'create_problem_lists', (world) => createProblemLists(resolvePatientForWrite(world, toRef(ref)), { simpleItems, problems })))

  server.registerTool('set_daily_note', {
    description: 'Write a day\'s progress note: Subjective, Objective, Assessment, Plan, and/or the notes under individual problems. appendText adds to what is already there.',
    inputSchema: {
      ...patientShape, date: z.string().optional(), subjective: z.string().optional(), objective: z.string().optional(), assessment: z.string().optional(), plans: z.string().optional(),
      problemNotes: z.array(z.object({ problemId: z.number().int().optional(), title: z.string().optional(), notes: z.string() })).optional(),
      appendText: z.boolean().optional(),
    },
  }, ({ appendText, ...input }) => act(room, 'set_daily_note', (world) => {
    const { room: r, lastName, patientId, ...note } = input
    return setDailyNote(world, resolvePatientForWrite(world, { room: r, lastName, patientId }), note, Boolean(appendText))
  }))

  // --- Saved views and templates --------------------------------------------------------------------------------------

  server.registerTool('create_view', { description: 'Save a named filter + sort combination, like Manage Custom Views.', inputSchema: { name: z.string(), ...selectionShape } },
    (input) => act(room, 'create_view', (world) => createView(world, input)))
  server.registerTool('update_view', {
    description: 'Change a saved view: rename it, change its filters or sort, or switch it on or off.',
    inputSchema: { name: z.string(), newName: z.string().optional(), enabled: z.boolean().optional(), ...selectionShape },
  }, ({ name, ...changes }) => act(room, 'update_view', (world) => updateView(world, name, changes)))

  server.registerTool('duplicate_template', {
    description: 'Copy a report template under a new name — the safe way to start a variation of an existing format.',
    inputSchema: { name: z.string(), newName: z.string() },
  }, ({ name, newName }) => act(room, 'duplicate_template', (world) => duplicateTemplate(world, name, newName)))
  server.registerTool('update_template', {
    description: 'Edit a template: rename it, switch it on or off, or change its format text (patternText, headerPatternText, footerPatternText). Format text is written exactly as list_templates shows it, but with each variable as {{var:<id>}} for variables the template already defines; new variables cannot be created here. Built-in templates can only be switched on or off. To try a change safely, duplicate_template first.',
    inputSchema: { name: z.string(), newName: z.string().optional(), enabled: z.boolean().optional(), patternText: z.string().optional(), headerPatternText: z.string().optional(), footerPatternText: z.string().optional() },
  }, ({ name, ...changes }) => act(room, 'update_template', (world) => updateTemplate(world, name, changes)))

  // --- Deleting, confirming, recent changes ---------------------------------------------------------------------------------

  server.registerTool('request_delete', {
    description: 'Step one of deleting something. Changes nothing: it returns exactly what would be removed and a code. Tell the user that, word for word, and only after a clear yes call confirm_action. kind: patient (with everything recorded for them), vital, lab, medication, order, problem (with its sub-problems), view, or template.',
    inputSchema: {
      kind: z.enum(['patient', 'vital', 'lab', 'medication', 'order', 'problem', 'view', 'template']),
      room: z.string().optional(), lastName: z.string().optional(), patientId: z.number().int().optional(),
      recordId: z.number().int().optional().describe('The id of the vital, lab, medication, order or problem (from get_patient).'),
      name: z.string().optional().describe('The exact name of the view or template.'),
    },
  }, (input) => run(async () => {
    const world = await room.forceRefresh()
    const needsPatient = ['patient', 'vital', 'lab', 'medication', 'order', 'problem'].includes(input.kind)
    const patient: Patient | undefined = needsPatient ? resolvePatientForWrite(world, { room: input.room ?? '', lastName: input.lastName ?? '', patientId: input.patientId }) : undefined
    const plan = await planDelete(world, { kind: input.kind, patient, recordId: input.recordId, name: input.name })
    return hold({
      tool: `delete_${input.kind}`,
      summary: plan.summary,
      // Re-resolved against the copy that is current when the user says yes, not the one this was planned on.
      run: async (fresh) => {
        const samePatient = needsPatient ? resolvePatientForWrite(fresh, { room: input.room ?? '', lastName: input.lastName ?? '', patientId: input.patientId }) : undefined
        return (await planDelete(fresh, { kind: input.kind, patient: samePatient, recordId: input.recordId, name: input.name })).run()
      },
    })
  }))

  server.registerTool('confirm_action', {
    description: 'Step two of request_delete or request_discharge. Call this ONLY after the user has clearly said yes to exactly what that request described.',
    inputSchema: { code: z.string() },
  }, ({ code }) => run(async () => {
    const key = code.trim().toUpperCase()
    const action = pending.get(key)
    if (!action) throw new ToolError('That code is not valid, or it already expired or was used. Start again with request_delete or request_discharge.')
    pending.delete(key)
    if (action.expiresAt < Date.now()) throw new ToolError('That code expired. Start again and ask the user again.')
    return act(room, action.tool, action.run)
  }))

  server.registerTool('recent_changes', {
    description: 'What has been changed through this connection, newest first, with the fields each change touched (old value → new value). Changes cannot be undone: to put something back, change it back by hand with the user\'s say-so.',
    inputSchema: { limit: z.number().int().positive().max(50).optional() },
  }, ({ limit }) => run(async () => {
    await room.forceRefresh()
    return json((await listChanges(limit ?? 15)).map((entry) => ({
      at: entry.at,
      what: entry.summary,
      patient: entry.patientIdentifier ?? null,
      ...describeOps(entry.ops, entry.moreOps),
    })))
  }))
}
