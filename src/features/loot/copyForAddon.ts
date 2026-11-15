// "Copy for addon" (ADDON-002, issue #193): the app's own data to the night model of docs/spec/exchange-v0.md section 5.1, and that model to the night
// string (nightString.ts). Pure: no React and no Firestore. The caller passes what useGuildData already holds; nothing here reads or writes.
//
// Where the spec leaves a choice, this file takes the simplest one it suggests:
//  1. Phase: the one the caller passes (the current phase, currentPhaseNo). Only that phase's priorities are sent, never a hidden one (5.1).
//  2. Priorities: every priority of that phase that is not hidden, in the order given. With `zones`, only those whose zoneId is in it, plus every
//     priority with no zoneId (one typed by hand has no zone, so a zone filter cannot say whether it belongs).
//  3. Roster: the whole roster, in the order given (5.1, "simplest"), with `k` counting from 1 in that order. `locked` comes from the caller's list of
//     ids (the night's starting roster, RAID-001) when there is one; without it no entry is locked.
//  4. Raid: the one the caller passes, or none. Its name is left out when blank; an id or date the spec refuses leaves the raid out, with a warning.
//  5. Marks: listingProgress over every award of every phase (removed ones included, it skips them itself), priorityLookup over every priority
//     (hidden and other phases included) and makeWho over the whole roster, as AwardModal.tsx does (5.1).
//  6. Lines: a character line whose makeWho key is a roster character becomes `{k}`; any other becomes a name-only line with its stored name. A note
//     with blank text is left out: it says nothing, and the addon would skip the whole priority for it (a blank note is a row error).
//  7. Known: every award of the phase with sourceKind 'addon', a valid sourceId and a sourceRev of 1 or more, removed ones included (section 7), one
//     entry per sourceId with the highest sourceRev, in the order given. The award fields arrive with the importer (LOOT-005); until then the list is
//     empty and left out.
//  8. Bosses: every creature of the drop tables (`tables`, the phase's merged tables) whose zone is the zoneId of a priority in the string, in table
//     order, the first of each npcId. Left out when there are none.
//  9. Empty optional values are left out: an empty encounter or council note, a blank surname (it counts as none, section 2), an empty class or role,
//     an empty known or bosses list. An optional game id that is not a whole number from 1 to 100,000,000 is left out too.
// 10. A text over its limit, a blank required text or an id the spec refuses is sent as it is, with a warning: the addon then skips that row and says
//     so, which is better than a silently cut note or a changed name.
// 11. Over 100,000 characters (section 11, the paste limit tested in the game) the string is refused, and the leader is asked to narrow the zones.

import { listingProgress, priorityLookup } from '../../shared/game/completion.ts'
import { makeWho, readLines } from '../../shared/game/candidates.ts'
import { phaseNoOf } from '../../shared/game/phases.ts'
import { encodeNight, type NightBoss, type NightKnown, type NightLine, type NightModel, type NightPlayer, type NightPriority, type NightRaid } from './nightString.ts'

// Structural types, so Node runs the tests directly. PlayerRecord, PriorityRecord, AwardRecord, RaidRecord (guildApi.ts) and LootTableCapture
// (shared/game/lootTables.ts) satisfy them.
type Player = { id: string; name: string; surname?: string; className: string; role?: string; mainId?: string }
type Priority = { id: string; item: string; encounter: string; rankedPlayers: string[]; rankedIds?: string[]; councilNote: string; itemId?: number; zoneId?: number; npcId?: number; phaseNo?: number; carriedFrom?: string; hidden?: true }
type Award = { id?: string; priorityId?: string; item: string; recipient: string; recipientId?: string; awardedAt?: string; createdAt?: unknown; phaseNo?: number; status?: unknown; sourceKind?: string; sourceId?: string; sourceRev?: number }
type Raid = { id: string; date: string; name: string; size: 10 | 20 | 40 }
type Table = { zoneId: number; sources: readonly { npcId: number; name: string }[] }

export type NightInput = {
  /** This string's own id, new each time (newNightId). */
  id: string
  /** When it is made, in whole seconds since 1970 (UTC). */
  at: number
  /** The producer, `RaidDesk/<version>`. Never a person's name. */
  by: string
  /** The phase to copy: the current one. */
  phase: number
  roster: readonly Player[]
  /** Every priority, of every phase, hidden ones included: the marks follow carried-over priorities. */
  priorities: readonly Priority[]
  /** Every award, of every phase, removed ones included. */
  awards: readonly Award[]
  raid?: Raid
  /** The ids of the night's locked roster, when the app has one. */
  locked?: Iterable<string>
  /** The phase's drop tables, for the bosses the addon can name from a corpse. */
  tables?: readonly Table[]
  /** Narrow the priorities to these zones (a priority with no zone stays). */
  zones?: Iterable<number>
}

export type NightResult = { model: NightModel; warnings: string[] }

// Limits of section 2, in code points.
export const NIGHT_LIMITS = { rosterName: 60, fullName: 121, item: 120, encounter: 120, note: 500, lineText: 500, lines: 60, classRole: 40, raidName: 120, by: 60 } as const
/** The longest string "Copy for addon" makes (section 11). */
export const NIGHT_STRING_MAX = 100_000

const ID = /^[A-Za-z0-9_-]{1,64}$/
const DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/
export const isExchangeId = (value: unknown): value is string => typeof value === 'string' && ID.test(value)
const isGameId = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 100_000_000
/** Length in Unicode code points, as every side counts it (section 2). */
export const codePoints = (text: string) => [...text].length
/** Blank: empty after removing leading and trailing ASCII spaces only (section 2). */
const isBlank = (text: string) => text.replace(/^ +| +$/g, '') === ''
const present = (text: string | undefined) => (text === undefined || isBlank(text) ? undefined : text)
const gameId = (value: number | undefined) => (isGameId(value) ? value : undefined)

/** A new id for a night string: `n-` and twelve random letters and digits. */
export function newNightId(random: (bytes: Uint8Array<ArrayBuffer>) => Uint8Array = (bytes) => crypto.getRandomValues(bytes)): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  return 'n-' + [...random(new Uint8Array(12))].map((byte) => alphabet[byte % alphabet.length]).join('')
}

export function buildNight(input: NightInput): NightResult {
  const warnings: string[] = []
  const tooLong = (text: string | undefined, limit: number, what: string) => {
    if (text !== undefined && codePoints(text) > limit) warnings.push(`${what} is longer than ${limit} characters; the addon will skip it.`)
    if (text?.includes('\u0000')) warnings.push(`${what} contains a NUL character; the addon will skip it.`)
  }
  const required = (text: string, limit: number, what: string) => {
    if (isBlank(text)) warnings.push(`${what} is blank; the addon will skip it.`)
    else tooLong(text, limit, what)
  }

  // Roster (choice 3).
  const locked = new Set(input.locked ?? [])
  const kOf = new Map<string, number>()
  input.roster.forEach((player, index) => { if (!kOf.has(player.id)) kOf.set(player.id, index + 1) })
  const roster: NightPlayer[] = input.roster.map((player, index) => {
    const k = index + 1
    const who = `Roster entry ${k} (${player.name})`
    if (!isExchangeId(player.id)) warnings.push(`${who} has an id the addon cannot read; the addon will skip it.`)
    else if (kOf.get(player.id) !== k) warnings.push(`${who} repeats another entry's id; the addon will skip it.`)
    required(player.name, NIGHT_LIMITS.rosterName, `${who}'s name`)
    tooLong(player.surname, NIGHT_LIMITS.rosterName, `${who}'s surname`)
    tooLong(player.className, NIGHT_LIMITS.classRole, `${who}'s class`)
    tooLong(player.role, NIGHT_LIMITS.classRole, `${who}'s role`)
    const surname = present(player.surname)
    if (surname === undefined) warnings.push(`${player.name} has no surname, so the addon matches no game character to them.`)
    const main = player.mainId !== undefined && player.mainId !== player.id ? kOf.get(player.mainId) : undefined
    return {
      k,
      id: player.id,
      name: player.name,
      surname,
      class: player.className === '' ? undefined : player.className,
      role: player.role === '' ? undefined : player.role,
      main,
      locked: locked.has(player.id) ? true : undefined,
    }
  })

  // Priorities (choices 1, 2, 5, 6).
  const zones = input.zones === undefined ? undefined : new Set(input.zones)
  const sent = input.priorities.filter((priority) => phaseNoOf(priority) === input.phase && !priority.hidden && (zones === undefined || !isGameId(priority.zoneId) || zones.has(priority.zoneId)))
  const lookup = priorityLookup([...input.priorities])
  const who = makeWho(input.roster)
  const awards = [...input.awards]
  const seenPriority = new Set<string>()
  const priorities: NightPriority[] = sent.map((priority) => {
    const label = `The priority "${priority.item}"`
    if (!isExchangeId(priority.id) || seenPriority.has(priority.id)) warnings.push(`${label} has an id the addon cannot read or that repeats; the addon will skip it.`)
    seenPriority.add(priority.id)
    required(priority.item, NIGHT_LIMITS.item, `${label}'s item name`)
    tooLong(priority.encounter, NIGHT_LIMITS.encounter, `${label}'s encounter`)
    tooLong(priority.councilNote, NIGHT_LIMITS.note, `${label}'s council note`)
    const progress = listingProgress(priority, awards, lookup, who)
    const lines = readLines(priority).flatMap((line, index): NightLine[] => {
      const awarded = progress.received[index] ? true : undefined
      if (line.kind === 'note') {
        if (isBlank(line.text)) return []
        tooLong(line.text, NIGHT_LIMITS.lineText, `${label}'s note "${line.text}"`)
        return [{ text: line.text, done: line.done ? true : undefined }]
      }
      const key = who.lineKey(line)
      const k = key?.startsWith('id:') ? kOf.get(key.slice(3)) : undefined
      if (k !== undefined) return [{ k, awarded }]
      required(line.name, NIGHT_LIMITS.fullName, `${label}'s line "${line.name}"`)
      return [{ name: line.name, awarded }]
    })
    if (lines.length > NIGHT_LIMITS.lines) warnings.push(`${label} has more than ${NIGHT_LIMITS.lines} lines; the addon will skip it.`)
    return {
      id: priority.id,
      item: priority.item,
      itemId: gameId(priority.itemId),
      encounter: priority.encounter === '' ? undefined : priority.encounter,
      npcId: gameId(priority.npcId),
      zoneId: gameId(priority.zoneId),
      note: present(priority.councilNote),
      lines,
    }
  })

  // Known addon awards (choice 7).
  const known = new Map<string, number>()
  for (const award of input.awards) {
    if (award.sourceKind !== 'addon' || phaseNoOf(award) !== input.phase) continue
    const rev = award.sourceRev
    if (!isExchangeId(award.sourceId) || typeof rev !== 'number' || !Number.isSafeInteger(rev) || rev < 1) {
      warnings.push(`An addon award${award.id ? ` (${award.id})` : ''} has no usable source id or revision; the addon may count it again.`)
      continue
    }
    known.set(award.sourceId, Math.max(known.get(award.sourceId) ?? 0, rev))
  }
  const knownList: NightKnown[] = [...known].map(([id, rev]) => ({ id, rev }))

  // Bosses (choice 8).
  const priorityZones = new Set(priorities.flatMap((priority) => (priority.zoneId === undefined ? [] : [priority.zoneId])))
  const npcs = new Set<number>()
  const bosses: NightBoss[] = []
  for (const table of input.tables ?? []) {
    if (!priorityZones.has(table.zoneId)) continue
    for (const source of table.sources) {
      if (!isGameId(source.npcId) || npcs.has(source.npcId) || isBlank(source.name) || codePoints(source.name) > NIGHT_LIMITS.encounter || source.name.includes('\u0000')) continue
      npcs.add(source.npcId)
      bosses.push({ npcId: source.npcId, name: source.name, zoneId: table.zoneId })
    }
  }

  // Raid (choice 4).
  let raid: NightRaid | undefined
  if (input.raid) {
    const { id, date, name, size } = input.raid
    if (!isExchangeId(id) || !DATE.test(date)) warnings.push(`The raid "${name}" has an id or date the addon cannot read, so the string names no raid.`)
    else {
      tooLong(name, NIGHT_LIMITS.raidName, `The raid's name`)
      raid = { id, date, name: present(name), size }
    }
  }

  const model: NightModel = {
    schema: 1,
    id: input.id,
    at: input.at,
    by: input.by,
    phase: input.phase,
    raid,
    known: knownList.length > 0 ? knownList : undefined,
    roster,
    bosses: bosses.length > 0 ? bosses : undefined,
    priorities,
  }
  return { model, warnings }
}

export type CopyResult = { ok: true; text: string; model: NightModel; warnings: string[] } | { ok: false; error: string; warnings: string[] }

/** The night string for the input, or why it cannot be made: a top-level field the addon would refuse, or a string over NIGHT_STRING_MAX. */
export function copyForAddon(input: NightInput): CopyResult {
  if (!isExchangeId(input.id)) return { ok: false, error: 'The night id is not a valid id.', warnings: [] }
  if (!Number.isSafeInteger(input.at) || !Number.isSafeInteger(input.phase) || input.phase < 0) return { ok: false, error: 'The time or the phase is not a whole number.', warnings: [] }
  if (isBlank(input.by) || codePoints(input.by) > NIGHT_LIMITS.by || input.by.includes('\u0000')) return { ok: false, error: 'The producer name is blank, too long or has a NUL.', warnings: [] }
  const { model, warnings } = buildNight(input)
  let text: string
  try {
    text = encodeNight(model)
  } catch (error) {
    return { ok: false, error: `The night string could not be written (${error instanceof Error ? error.message : String(error)}).`, warnings }
  }
  if (text.length > NIGHT_STRING_MAX) return { ok: false, error: `The night string is ${text.length.toLocaleString('en-US')} characters, over the ${NIGHT_STRING_MAX.toLocaleString('en-US')} the game takes. Narrow the zones and copy again.`, warnings }
  return { ok: true, text, model, warnings }
}
