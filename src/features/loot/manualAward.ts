import type { NewManualAward } from '../../guildApi'

// Recording loot without a priority list (LOOT-002): what the "Record loot" form says, turned into the award the rules accept, or a sentence about what is wrong.
// Pure, so Node tests it; the dialog only lays it out. The rules have the last word (validManualAward): the recipient has to be a roster character whose name the
// award carries, the phase has to be the current one, and the audit entry has to be written in the same batch.
export const MANUAL_ITEM_MAX = 120
export const MANUAL_ENCOUNTER_MAX = 120
export const MANUAL_NOTE_MAX = 500
export const DECISIONS = [{ value: 'roll', label: 'Roll' }, { value: 'council', label: 'Council' }, { value: 'other', label: 'Other' }] as const

export type ManualAwardForm = {
  item: string
  /** The boss or dungeon, as free text. Optional. */
  encounter: string
  /** The roster id of the character who received it. */
  recipientId: string
  /** The raid date, YYYY-MM-DD: when it dropped, not when it is entered. */
  awardedAt: string
  decision: string
  awardNote: string
}

type Roster = { player: (id: string) => { id: string; name: string } | undefined }

/** A real calendar date written YYYY-MM-DD (the rules check the format only; a day that does not exist is refused here). */
export function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

/**
 * The award the form describes, or why it cannot be recorded. `missing` is true while a required field has simply not been filled in yet (the dialog keeps its button
 * off and says nothing); a `problem` without it is something wrong with what was typed, and is worth saying.
 */
export function manualAward(form: ManualAwardForm, roster: Roster, phaseNo: number): { award?: NewManualAward; problem?: string; missing?: boolean } {
  const item = form.item.trim()
  if (!item) return { problem: 'Enter the item.', missing: true }
  if (item.length > MANUAL_ITEM_MAX) return { problem: `The item can be up to ${MANUAL_ITEM_MAX} characters.` }
  const player = form.recipientId ? roster.player(form.recipientId) : undefined
  if (!form.recipientId) return { problem: 'Choose who received it.', missing: true }
  if (!player) return { problem: 'Choose a character from the roster.' }
  const encounter = form.encounter.trim()
  if (encounter.length > MANUAL_ENCOUNTER_MAX) return { problem: `The boss can be up to ${MANUAL_ENCOUNTER_MAX} characters.` }
  if (!isRealDate(form.awardedAt)) return { problem: 'Enter the raid date.', ...(form.awardedAt ? {} : { missing: true }) }
  const decision = DECISIONS.find((option) => option.value === form.decision)
  if (!decision) return { problem: 'Choose how it was decided.', ...(form.decision ? {} : { missing: true }) }
  const awardNote = form.awardNote.trim()
  if (awardNote.length > MANUAL_NOTE_MAX) return { problem: `The note can be up to ${MANUAL_NOTE_MAX} characters.` }
  return { award: { item, encounter, recipient: player.name, recipientId: player.id, awardedAt: form.awardedAt, awardNote, decision: decision.value, phaseNo } }
}
