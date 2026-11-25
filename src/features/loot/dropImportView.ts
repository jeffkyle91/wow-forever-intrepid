// What the drop list import panel (DropImportPanel.tsx, LOOT-008) shows and does with the leader's clicks, as pure functions so Node tests them.
// dropImport.ts does the matching and builds the writes; this holds only the panel's own choices. Only types and pure functions are imported.
import type { ImportCounts } from './dropImport.ts'

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
