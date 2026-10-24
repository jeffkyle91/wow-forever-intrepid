import type { NewManualAward } from '../../guildApi'
import { nameKey } from '../../shared/game/candidates.ts'
import { splitEncounter } from './groupPriorities.ts'

// Recording loot without a priority list (LOOT-002): what the "Record loot" form says, turned into the award the rules accept, or a sentence about what is wrong.
// Pure, so Node tests it; the dialog only lays it out. The rules have the last word (validManualAward): the recipient has to be a roster character whose name the
// award carries, the phase has to be the current one, and the audit entry has to be written in the same batch.
export const MANUAL_ITEM_MAX = 120
export const MANUAL_ENCOUNTER_MAX = 120
export const MANUAL_NOTE_MAX = 500
export const DECISIONS = [{ value: 'roll', label: 'Roll' }, { value: 'council', label: 'Council' }, { value: 'other', label: 'Other' }] as const

export type ManualAwardForm = {
  item: string
  /** The dungeon or raid, picked from the guild's list or typed. Optional. */
  dungeon: string
  /** The boss, as free text. Optional. */
  boss: string
  /** The roster id of the character who received it. */
  recipientId: string
  /** The raid date, YYYY-MM-DD: when it dropped, not when it is entered. */
  awardedAt: string
  decision: string
  awardNote: string
}

/** The middle dot that joins a dungeon and a boss. */
export const SEPARATOR = '\u00b7'
const ANY_CREATURE = 'any creature'

/**
 * The text an award keeps its place in: "dungeon · boss", the form a priority's encounter is written in, so the Log's dungeon and boss filters read an award the same way
 * (`splitEncounter`). A dungeon with no boss ends in the separator, which keeps it a dungeon (text with no separator reads as a boss with no dungeon). With no dungeon,
 * whatever was typed for the boss stands as it is, so "Dungeon · Boss" typed in whole still works.
 */
export function encounterOf(dungeon: string, boss: string): string {
  const place = dungeon.trim()
  const name = boss.trim()
  if (!place) return name
  return name ? `${place} ${SEPARATOR} ${name}` : `${place} ${SEPARATOR}`
}

export type DungeonChoices = { raids: string[]; dungeons: string[]; others: string[] }

/**
 * The dungeons the form offers, each name once, with its spaces tidied: the guild's raids, then its dungeons (both from the zone list, by name), then any dungeon a priority of
 * the phase names that neither has (one typed by hand). A name with the separator in it is left out, because it would split in two when stored. `keep` is a dungeon already
 * picked: it stays offered even if the lists no longer have it (a zone renamed or a priority hidden while the form is open), so the select never shows one dungeon and records another.
 * Pure.
 */
export function dungeonChoices(zones: readonly { name: string; kind: string }[], priorityEncounters: readonly string[], keep = ''): DungeonChoices {
  const seen = new Set<string>()
  const take = (names: readonly string[]) => {
    const taken: string[] = []
    for (const name of names) {
      const tidy = name.trim().replace(/\s+/g, ' ')
      const key = nameKey(tidy)
      if (key === '' || tidy.includes(SEPARATOR) || seen.has(key)) continue
      seen.add(key)
      taken.push(tidy)
    }
    return taken.sort((a, b) => a.localeCompare(b))
  }
  return {
    raids: take(zones.filter((zone) => zone.kind === 'raid').map((zone) => zone.name)),
    dungeons: take(zones.filter((zone) => zone.kind !== 'raid').map((zone) => zone.name)),
    others: take([...priorityEncounters.map((encounter) => splitEncounter(encounter).dungeon), keep]),
  }
}

/** The bosses to suggest for a dungeon: its drop list's creatures in encounter order, then any boss a priority of the phase names there. "Any creature" is not a boss. */
export function bossChoices(dungeon: string, listOrder: readonly string[], priorityEncounters: readonly string[]): string[] {
  if (nameKey(dungeon) === '') return []
  const fromPriorities = priorityEncounters.map(splitEncounter).filter((place) => nameKey(place.dungeon) === nameKey(dungeon)).map((place) => place.boss)
  const seen = new Set<string>()
  const names: string[] = []
  for (const name of [...listOrder, ...fromPriorities]) {
    const key = nameKey(name)
    if (key === '' || key === ANY_CREATURE || seen.has(key)) continue
    seen.add(key)
    names.push(name.trim())
  }
  return names
}

type Roster = { player: (id: string) => { id: string; name: string } | undefined }

type ExistingAward = { id: string; item: string; recipient: string; recipientId?: string; awardedAt: string; status?: unknown }

const DAY = 86_400_000
const dayOf = (date: string) => Date.parse(`${date}T00:00:00Z`)

/**
 * An award that looks like the one about to be recorded: not removed, the same recipient (by roster id when both have one, else by name), the same item name and a raid
 * date within one day. It is the importer's "possible duplicate" rule (docs of the addon exchange, section 6.3), so a drop typed here and later imported from the addon is
 * caught by the same test. It only warns: two copies of an item can truly drop to one person on one night.
 */
export function possibleDuplicate(award: Pick<NewManualAward, 'item' | 'recipient' | 'recipientId' | 'awardedAt'>, existing: readonly ExistingAward[]): ExistingAward | undefined {
  return existing.find((other) => other.status !== 'removed'
    && (other.recipientId !== undefined ? other.recipientId === award.recipientId : nameKey(other.recipient) === nameKey(award.recipient))
    && nameKey(other.item) === nameKey(award.item)
    && Math.abs(dayOf(other.awardedAt) - dayOf(award.awardedAt)) <= DAY)
}

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
  if (form.dungeon.includes(SEPARATOR)) return { problem: `The dungeon's name cannot contain “${SEPARATOR}”.` }
  const encounter = encounterOf(form.dungeon, form.boss)
  if (encounter.length > MANUAL_ENCOUNTER_MAX) return { problem: `The dungeon and boss can be up to ${MANUAL_ENCOUNTER_MAX} characters together.` }
  if (!isRealDate(form.awardedAt)) return { problem: 'Enter the raid date.', ...(form.awardedAt ? {} : { missing: true }) }
  const decision = DECISIONS.find((option) => option.value === form.decision)
  if (!decision) return { problem: 'Choose how it was decided.', ...(form.decision ? {} : { missing: true }) }
  const awardNote = form.awardNote.trim()
  if (awardNote.length > MANUAL_NOTE_MAX) return { problem: `The note can be up to ${MANUAL_NOTE_MAX} characters.` }
  return { award: { item, encounter, recipient: player.name, recipientId: player.id, awardedAt: form.awardedAt, awardNote, decision: decision.value, phaseNo } }
}
