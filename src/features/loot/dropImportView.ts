// What the drop list import panel (DropImportPanel.tsx, LOOT-008) shows and does with the leader's clicks, as pure functions so Node tests them.
// dropImport.ts does the matching and builds the writes; this holds only the panel's own choices. Only types and pure functions are imported.
import type { CandidateZone } from '../../shared/game/dropsString.ts'
import { importZoneKey, zoneIdFor, type CreatureRow, type ImportAnswers, type ImportCounts, type ItemRow, type ZoneAnswer, type ZoneRow } from './dropImport.ts'

export const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

export function countsText(counts: ImportCounts): string {
  const parts = [
    counts.newZones ? `${plural(counts.zones, 'zone', 'zones')} (${counts.newZones} new)` : plural(counts.zones, 'zone', 'zones'),
    counts.newCreatures ? `${plural(counts.creatures, 'creature', 'creatures')} (${counts.newCreatures} new)` : plural(counts.creatures, 'creature', 'creatures'),
    plural(counts.items, 'item', 'items'),
    ...(counts.journalItems ? [`${counts.journalItems} from DungeonJournal`] : []),
  ]
  return parts.join(', ')
}

/** Nothing would be written: no zone, creature or item is saved. Both Save buttons are off then. */
export const nothingToSave = (counts: ImportCounts | undefined) => !counts || (counts.items + counts.journalItems === 0 && counts.creatures === 0 && counts.zones === 0)

/** The confirm button: the phase the writes go into, and the counts. */
export const confirmLabel = (phase: string, counts: ImportCounts) => `Save to ${phase}: ${countsText(counts)}`

/** What a confirm step was opened for. It holds only while the phase picked in the editor and the pasted text are the same. */
export type ConfirmFor = { phaseNo: number; text: string }
export const confirmHolds = (open: ConfirmFor | null, phaseNo: number, text: string) => open !== null && open.phaseNo === phaseNo && open.text === text

/**
 * Whether a zone's block is open: when there is something to save or decide. A zone a leader took out of the phase is open, so its "Put it back"
 * shows, and so is one with a question the leader answered (a pick, "same as …" or "new"), so answering never closes the block they are in. A zone
 * whose rows are all already listed starts closed.
 */
export function zoneOpen(zone: ZoneRow): boolean {
  const anything = zone.creatures.some((creature) => creature.saved || creature.creatureTickable || creature.status === 'unmatched' || creature.differs || creature.items.some((item) => item.tickable))
  const answered = zone.picks.length > 0 || zone.creatures.some((creature) => creature.answerKey !== undefined)
  return zone.status !== 'matched' || zone.takenOut || answered || anything
}

/** The chip on a zone's summary line, if any. */
export function zoneChip(zone: ZoneRow, phase: string): { text: string; added: boolean } | undefined {
  if (zone.status === 'new') return { text: 'new zone', added: true }
  if (zone.takenOut) return { text: `taken out of ${phase}`, added: false }
  if (zone.status === 'matched' && zone.tickIn) return { text: `not in ${phase} yet`, added: false }
  return undefined
}

/** The counts line under the preview: what the save holds, and what is left out (unanswered questions, zones a leader took out and nobody put back). */
export function countsLine(counts: ImportCounts, zones: ZoneRow[], phase: string): string {
  const out = zones.filter((zone) => zone.takenOut && !zone.zoneTicked).length
  const left = [
    ...(counts.unanswered ? [`${plural(counts.unanswered, 'question', 'questions')} unanswered: left out.`] : []),
    ...(out ? [`${plural(out, 'zone', 'zones')} taken out of ${phase}: left out.`] : []),
  ]
  return left.length ? `${countsText(counts)}. ${left.join(' ')}` : countsText(counts)
}

/**
 * The Zone selects of a zone's block: which answer each one sets, and its label. An unmatched zone, or one a Guild Leader makes, has its own. A zone
 * that pasted zones were picked into has one per pick, named for the pasted zone, so each pick can be changed or taken back (Choose), also when the
 * zone matched by itself too.
 */
export function zoneSelects(zone: ZoneRow): { answerKey: string; label: string }[] {
  if (zone.status !== 'matched') return [{ answerKey: zone.id, label: 'Zone' }]
  return zone.picks.map((pick) => ({ answerKey: pick.answerKey, label: `Zone for ${pick.name}` }))
}

/**
 * The pasted zone an answer key belongs to (its instance, else its name's key, as dropImport.ts keys a candidate's answers), so "Make a new zone" from a
 * pick gets the id fixed from that zone's own instance.
 */
export const answerSubject = (answerKey: string, candidates: CandidateZone[]): Partial<CandidateZone> =>
  candidates.find((candidate) => `u${candidate.instanceId ?? importZoneKey(candidate.name)}` === answerKey) ?? {}

/** A Zone select's value as an answer: Choose clears it, "new" makes a zone (its id fixed now, so it doesn't change while the preview is open), else a pick. */
export function zoneAnswer(value: string, subject: { instanceId?: number }, taken: Set<number>): ZoneAnswer | undefined {
  if (value === '') return undefined
  return value === 'new' ? { make: true, zoneId: zoneIdFor(subject, taken) } : { pick: Number(value) }
}

/**
 * The items "Tick DungeonJournal's items" ticks under a creature: its new DungeonJournal items, never one a leader took off (that stays a tick of its
 * own). None under a creature a leader took out: the leader ticks Bring back first.
 */
export const journalToTick = (row: CreatureRow): ItemRow[] => (row.status === 'takenOut' ? [] : row.items.filter((item) => item.journalOnly && item.tickable && item.status === 'new'))

/** The answers after "Tick DungeonJournal's items": those items ticked, and a new creature with them, so a guessed or unticked one is saved too. */
export function tickJournal(answers: ImportAnswers, row: CreatureRow): ImportAnswers {
  const ticks = { ...answers.ticks }
  for (const item of journalToTick(row)) ticks[item.id] = true
  if (row.status === 'new') ticks[row.id] = true
  return { ...answers, ticks }
}
