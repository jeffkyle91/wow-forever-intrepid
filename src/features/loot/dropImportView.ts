// What the drop list import panel (DropImportPanel.tsx, LOOT-008) shows and does with the leader's clicks, as pure functions so Node tests them.
// dropImport.ts does the matching and builds the writes; this holds only the panel's own choices. Only types and pure functions are imported.
import type { ImportCounts, ZoneRow } from './dropImport.ts'

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
 * shows. A zone whose rows are all already listed starts closed.
 */
export function zoneOpen(zone: ZoneRow): boolean {
  const anything = zone.creatures.some((creature) => creature.saved || creature.creatureTickable || creature.status === 'unmatched' || creature.differs || creature.items.some((item) => item.tickable))
  return zone.status !== 'matched' || zone.takenOut || anything
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
