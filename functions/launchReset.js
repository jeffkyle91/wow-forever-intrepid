// The one-time launch reset (docs/design/launch-reset.md): the maintainer erases the awards, loot priorities and Log entries of the pre-launch phase
// ("Launch prep") once, after the first real phase has started, and seals the guild so it can never be done again. Everything else is kept: the awards,
// priorities and entries of every later phase, the phase and drop list entries, the raid entries, the drop lists and the settings.
//
// Nothing in the app can run this. The rules never allow an award or a Log entry to be deleted, and they still do not: this runs with the Admin SDK from
// scripts/launch-reset.mjs, by the maintainer, and every step below is a check that it only ever erases what was agreed.
//
//   planLaunchReset(db, options)           reads, decides what would be erased, and deletes nothing. Throws when a reset must not be done.
//   applyLaunchReset(db, options, expect)  plans again, requires the plan to be exactly what the maintainer confirmed, backs the data up, erases it, checks
//                                          that nothing of the phase is left, and only then records the reset and seals the guild.
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { applicationDefault, deleteApp, getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'

export const SEAL_DOC = 'launchReset'
export const RECORD_ENTRY = 'ledger_launch-reset_1'
const BATCH = 400

// A phase is a number: none stored, or one that is not a whole number of 0 or more, is the first phase (the same reading as phaseNoOf in src/shared/game/phases.ts).
const phaseNoOf = (data) => (Number.isInteger(data?.phaseNo) && data.phaseNo >= 0 ? data.phaseNo : 0)

export class LaunchResetRefused extends Error {}
const refuse = (message) => { throw new LaunchResetRefused(message) }

export function openDatabase({ projectId }) {
  if (!projectId) refuse('A project id is required.')
  for (const app of getApps()) if (app.name === 'launch-reset') return { db: getFirestore(app), close: () => deleteApp(app) }
  const emulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST)
  const app = initializeApp({ projectId, ...(emulator ? {} : { credential: applicationDefault() }) }, 'launch-reset')
  return { db: getFirestore(app), close: () => deleteApp(app), emulator }
}

const guildRef = (db, guildId) => db.collection('guilds').doc(guildId)

/**
 * What the reset would erase. `options`: { guildId, phase, phaseName }. Reads only. Throws LaunchResetRefused when the reset must not be done: the guild is
 * sealed, the phase has not finished (the first real phase has not started), or the phase is not the one named.
 */
export async function planLaunchReset(db, { guildId, phase, phaseName }) {
  if (!guildId) refuse('A guild id is required.')
  if (!Number.isInteger(phase) || phase < 0) refuse('The phase must be a whole number of 0 or more (0 is the first phase, "Launch prep").')
  if (typeof phaseName !== 'string' || !phaseName.trim()) refuse('Give the name of the phase to erase, exactly as Settings shows it.')
  const guild = guildRef(db, guildId)

  const sealed = await guild.collection('settings').doc(SEAL_DOC).get()
  if (sealed.exists) refuse('This guild has already had its launch reset. It can be done only once.')

  const settingsDoc = await guild.collection('settings').doc('general').get()
  if (!settingsDoc.exists) refuse(`There are no settings for the guild "${guildId}". Is the guild id right?`)
  const settings = settingsDoc.data()
  const history = Array.isArray(settings.phaseHistory) ? settings.phaseHistory : []
  const current = history.length
  if (phase >= current) refuse(`Phase ${phase} has not finished: the guild is in phase ${current} ("${settings.currentPhase}"). Start the first real phase first.`)
  if (String(history[phase]).trim() !== phaseName.trim()) refuse(`Phase ${phase} is called "${history[phase]}", not "${phaseName}". Nothing was read further.`)

  const [awards, priorities, entries] = await Promise.all([
    guild.collection('awards').get(), guild.collection('lootPriorities').get(), guild.collection('auditLog').get(),
  ])
  const awardDocs = awards.docs.filter((doc) => phaseNoOf(doc.data()) === phase)
  const priorityDocs = priorities.docs.filter((doc) => phaseNoOf(doc.data()) === phase)
  const awardsLeft = awards.size - awardDocs.length
  const prioritiesLeft = priorities.size - priorityDocs.length

  // An entry belongs to the phase of what it is about. An award or priority that still exists says its own phase. One that is gone (a deleted priority) says it
  // in its create or delete entry (a create that lists no phase is the first phase). An entry about something whose phase cannot be told is kept and reported.
  const existing = { award: new Map(awards.docs.map((doc) => [doc.id, doc.data()])), priority: new Map(priorities.docs.map((doc) => [doc.id, doc.data()])) }
  const listed = new Map()
  for (const entry of entries.docs) {
    const data = entry.data()
    if (data.targetType !== 'award' && data.targetType !== 'priority') continue
    const key = `${data.targetType}:${data.targetId}`
    const said = Number.isInteger(data.after?.phaseNo) ? data.after.phaseNo : Number.isInteger(data.before?.phaseNo) ? data.before.phaseNo : undefined
    if (said !== undefined) listed.set(key, said)
    else if (data.action === 'create' && !listed.has(key)) listed.set(key, 0)
  }
  const erase = []
  const unresolved = new Set()
  let entriesLeft = 0
  for (const entry of entries.docs) {
    const data = entry.data()
    if (data.targetType !== 'award' && data.targetType !== 'priority') { entriesLeft += 1; continue }
    const key = `${data.targetType}:${data.targetId}`
    const stored = existing[data.targetType].get(data.targetId)
    const of = stored !== undefined ? phaseNoOf(stored) : listed.get(key)
    if (of === undefined) { unresolved.add(key); entriesLeft += 1 } else if (of === phase) erase.push(entry)
    else entriesLeft += 1
  }
  return {
    guildId, phase, phaseName: phaseName.trim(), currentPhase: settings.currentPhase, currentPhaseNo: current, phaseRev: settings.phaseRev ?? 0,
    awards: awardDocs, priorities: priorityDocs, entries: erase,
    counts: { awards: awardDocs.length, priorities: priorityDocs.length, entries: erase.length },
    kept: { awards: awardsLeft, priorities: prioritiesLeft, entries: entriesLeft, unresolvedTargets: [...unresolved].sort() },
  }
}

/** What a person is shown before confirming: the numbers and a few examples, nothing that could be pasted back as an instruction. */
export function describePlan(plan) {
  const sample = (docs, text) => docs.slice(0, 5).map((doc) => `    ${text(doc.data())}`)
  return [
    `Guild ${plan.guildId}: erase phase ${plan.phase} ("${plan.phaseName}"). The guild is now in phase ${plan.currentPhaseNo} ("${plan.currentPhase}").`,
    `  Would erase  ${plan.counts.awards} awards, ${plan.counts.priorities} loot priorities and ${plan.counts.entries} Log entries about them.`,
    ...sample(plan.awards, (data) => `award: ${data.item} -> ${data.recipient} (${data.awardedAt})`),
    ...sample(plan.priorities, (data) => `priority: ${data.item} (${data.encounter ?? ''})`),
    `  Would keep   ${plan.kept.awards} awards and ${plan.kept.priorities} priorities of later phases, and ${plan.kept.entries} Log entries (the later phases', and every phase, drop list and raid entry).`,
    ...(plan.kept.unresolvedTargets.length ? [`  Kept because their phase cannot be told: ${plan.kept.unresolvedTargets.join(', ')}`] : []),
  ].join('\n')
}

function jsonable(value) {
  if (value instanceof Timestamp) return { __timestamp: value.toDate().toISOString() }
  if (Array.isArray(value)) return value.map(jsonable)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, jsonable(inner)]))
  return value
}

/** Everything that is about to be erased, written to one file and read back, before anything is deleted. */
async function writeBackup(file, plan) {
  const dump = (docs) => docs.map((doc) => ({ id: doc.id, data: jsonable(doc.data()) }))
  const backup = { kind: 'launch-reset-backup', version: 1, guildId: plan.guildId, phase: plan.phase, phaseName: plan.phaseName, savedAt: new Date().toISOString(), awards: dump(plan.awards), priorities: dump(plan.priorities), entries: dump(plan.entries) }
  await mkdir(path.dirname(file), { recursive: true })
  // 'wx' never overwrites: a backup that is already there may be the only copy of an earlier run.
  try {
    await writeFile(file, JSON.stringify(backup, null, 2), { flag: 'wx', mode: 0o600 })
  } catch (error) {
    if (error?.code === 'EEXIST') refuse(`The backup file ${file} already exists and is never overwritten. Choose a new file name. Nothing was erased.`)
    throw error
  }
  const back = JSON.parse(await readFile(file, 'utf8'))
  if (back.awards.length !== plan.counts.awards || back.priorities.length !== plan.counts.priorities || back.entries.length !== plan.counts.entries) {
    refuse(`The backup file ${file} does not hold what was read (${back.awards.length} awards, ${back.priorities.length} priorities, ${back.entries.length} entries). Nothing was erased.`)
  }
}

async function eraseAll(db, refs) {
  for (let start = 0; start < refs.length; start += BATCH) {
    const batch = db.batch()
    for (const ref of refs.slice(start, start + BATCH)) batch.delete(ref)
    await batch.commit()
  }
}

/**
 * Erases the phase. `expect` is what the maintainer was shown by the dry run: { awards, priorities, entries }. The plan is made again now and has to be exactly
 * that, so nothing recorded since the dry run is erased unseen. Options: { guildId, phase, phaseName, backupFile }. Returns what was erased.
 */
export async function applyLaunchReset(db, options, expect, { now = () => new Date(), erase = eraseAll } = {}) {
  const { backupFile } = options
  if (!backupFile || !path.isAbsolute(backupFile)) refuse('Give the backup file as an absolute path, outside the repository.')
  const plan = await planLaunchReset(db, options)
  for (const key of ['awards', 'priorities', 'entries']) {
    if (!Number.isInteger(expect?.[key]) || expect[key] !== plan.counts[key]) {
      refuse(`${key}: ${expect?.[key]} were confirmed but ${plan.counts[key]} would be erased now. Run the dry run again and confirm what it shows. Nothing was erased.`)
    }
  }
  if (plan.counts.awards + plan.counts.priorities + plan.counts.entries === 0) refuse('There is nothing of that phase to erase. Nothing was done, and the guild was not sealed.')
  // The last guard before a delete: every document to erase is of the phase, and every entry is about one of them or about a priority of the phase that is gone.
  if (plan.awards.some((doc) => phaseNoOf(doc.data()) !== plan.phase) || plan.priorities.some((doc) => phaseNoOf(doc.data()) !== plan.phase)) refuse('A document of another phase was in the erase list. Nothing was erased.')

  await writeBackup(backupFile, plan)
  await erase(db, [...plan.awards, ...plan.priorities, ...plan.entries].map((doc) => doc.ref))

  // Nothing of the phase may be left. If something is (someone recorded loot meanwhile, or a delete failed) the guild is not sealed: run the dry run again.
  const left = await planLaunchReset(db, options)
  if (left.counts.awards + left.counts.priorities + left.counts.entries !== 0) {
    refuse(`${left.counts.awards} awards, ${left.counts.priorities} priorities and ${left.counts.entries} entries of the phase are still there. The guild was not sealed. The backup is ${backupFile}. Run the dry run again.`)
  }

  const guild = guildRef(db, plan.guildId)
  const at = Timestamp.fromDate(now())
  const erased = { awards: plan.counts.awards, priorities: plan.counts.priorities, auditEntries: plan.counts.entries }
  const batch = db.batch()
  // create(), not set(): it fails if either exists, so a reset can never be recorded twice.
  batch.create(guild.collection('settings').doc(SEAL_DOC), { phaseNo: plan.phase, phaseName: plan.phaseName, erasedAt: at, erased, backupFile: path.basename(backupFile), version: 1 })
  batch.create(guild.collection('auditLog').doc(RECORD_ENTRY), {
    at, by: 'launch-reset', byName: 'Launch reset', targetType: 'ledger', targetId: 'launch-reset', rev: 1, action: 'erase', item: plan.phaseName,
    changed: ['awards', 'priorities', 'auditEntries'], before: { phaseNo: plan.phase, ...erased }, after: {}, reason: 'The pre-launch test data was erased once, when the first real phase started.',
  })
  await batch.commit()
  return erased
}

/** Whether a path is inside a directory (the backup holds names, so it must not land in the repository). */
export function isInside(file, directory) {
  const relative = path.relative(path.resolve(directory), path.resolve(file))
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
}

export async function exists(file) {
  try { await stat(file); return true } catch { return false }
}
