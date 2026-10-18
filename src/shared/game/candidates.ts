// The candidates of a loot priority, as lines. A priority stores names (`rankedPlayers`, what each line said when it was written) and, since roster
// ids (LOOT-003), a parallel list `rankedIds`: element i says what line i is.
//   a roster character's id   a character line: a person, matched by id so a rename does not break it
//   ''                        an open note: an idea such as "any warlock who didn't get X", not a person
//   '!'                       a finished note, shown crossed off
// A priority written before this change has names only: every line is then a character matched by name, as it always was. Nothing here imports
// anything, so Node runs its tests directly. docs/design/audit-first-loot.md and PR-texts/Design-loot-003-roster-ids.md describe the model.

type RosterPlayer = { id: string; name: string; surname?: string; className: string }

export type Line = { kind: 'character'; name: string; id?: string } | { kind: 'note'; text: string; done: boolean }
export type Fields = { rankedPlayers: string[]; rankedIds?: string[] }

export const OPEN_NOTE = ''
export const FINISHED_NOTE = '!'

/** A name compared without case and without extra spaces. */
export function nameKey(name: string) {
  return name.trim().replace(/\s+/g, ' ').toLowerCase()
}

/**
 * The lines of a priority. Reads tolerantly: ids that are not a list as long as the names (an app from before this change edited the names and left
 * the ids, say) are ignored as a whole, and the priority reads as names only. Never throws.
 */
export function readLines(priority: { rankedPlayers: readonly string[]; rankedIds?: unknown }): Line[] {
  const names = priority.rankedPlayers
  const ids = Array.isArray(priority.rankedIds) && priority.rankedIds.length === names.length ? (priority.rankedIds as unknown[]) : undefined
  return names.map((name, index): Line => {
    const id = ids?.[index]
    if (id === OPEN_NOTE) return { kind: 'note', text: name, done: false }
    if (id === FINISHED_NOTE) return { kind: 'note', text: name, done: true }
    return typeof id === 'string' && id !== '' ? { kind: 'character', name, id } : { kind: 'character', name }
  })
}

/** Whether a priority has any line that is not a plain name: a character by id or a note. Such a priority stores ids. */
export function hasIds(lines: readonly Line[]) {
  return lines.some((line) => line.kind === 'note' || line.id !== undefined)
}

/**
 * What to store for lines. Names only when no line is a character by id or a note (a priority nobody has converted stays as it was). Otherwise
 * ids too: a character without an id in such a list is stored as an open note, because the two lists could not say anything else for it.
 * An empty list stores no ids.
 */
export function lineFields(lines: readonly Line[]): Fields {
  const rankedPlayers = lines.map((line) => (line.kind === 'note' ? line.text : line.name))
  if (!hasIds(lines)) return { rankedPlayers }
  return { rankedPlayers, rankedIds: lines.map((line) => (line.kind === 'note' ? (line.done ? FINISHED_NOTE : OPEN_NOTE) : line.id ?? OPEN_NOTE)) }
}

/**
 * What to write to change a priority's lines to `lines`: the names, and the ids as lineFields says. When the new lines store no ids but the priority
 * has some (a list that was not read because it did not line up with the names), the ids are taken away so they cannot be left stale.
 */
export function lineChanges(current: { rankedIds?: unknown }, lines: readonly Line[]): { rankedPlayers: string[]; rankedIds?: string[] | undefined } {
  const fields = lineFields(lines)
  if (fields.rankedIds || current.rankedIds === undefined) return fields
  return { rankedPlayers: fields.rankedPlayers, rankedIds: undefined }
}

/** The roster looked at by id and by name, to give each line and award one key for "the same person" and to show current names. */
export function makeWho<P extends RosterPlayer>(roster: readonly P[]) {
  const byId = new Map(roster.map((player) => [player.id, player]))
  // A name (or name and surname) that two characters share belongs to nobody: it cannot say which.
  const byName = new Map<string, P | null>()
  const addName = (key: string, player: P) => {
    const known = byName.get(key)
    byName.set(key, known !== undefined && known?.id !== player.id ? null : player)
  }
  for (const player of roster) {
    addName(nameKey(player.name), player)
    if (player.surname) addName(nameKey(`${player.name} ${player.surname}`), player)
  }
  const named = (name: string) => byName.get(nameKey(name)) ?? undefined
  const personOf = (id: string | undefined, name: string) => {
    if (id !== undefined) return `id:${id}`
    const player = named(name)
    return player ? `id:${player.id}` : `name:${nameKey(name)}`
  }
  return {
    /** The roster character with this id. */
    player: (id: string) => byId.get(id),
    /** The one roster character with this name (or name and surname), when there is exactly one. */
    byName: named,
    /** One key per person: the id when a line or award has one or its name is a roster character's, else the name. A note has none. */
    lineKey: (line: Line) => (line.kind === 'note' ? undefined : personOf(line.id, line.name)),
    awardKey: (award: { recipient: string; recipientId?: string }) => personOf(award.recipientId, award.recipient),
    /** The name to show: the roster's current name for a character by id, else the name the line has. */
    nameOf: (line: Line) => (line.kind === 'note' ? line.text : (line.id !== undefined ? byId.get(line.id)?.name : undefined) ?? line.name),
    /** The class of a character line: by id, else by name; none for a note or for someone who is not on the roster. */
    classOf: (line: Line) => (line.kind === 'note' ? undefined : (line.id !== undefined ? byId.get(line.id) : named(line.name))?.className),
    /** Whether a character line is someone the roster has (by id, else by name). */
    known: (line: Line) => line.kind === 'character' && (line.id !== undefined ? byId.has(line.id) : named(line.name) !== undefined),
  }
}
export type Who<P extends RosterPlayer = RosterPlayer> = ReturnType<typeof makeWho<P>>

/** The same lines with each character that has no id given the roster character of that name, and anything else turned into an open note. */
export function convertLegacy(lines: readonly Line[], who: Who): Line[] {
  return lines.map((line): Line => {
    if (line.kind !== 'character' || line.id !== undefined) return line
    const player = who.byName(line.name)
    return player ? { kind: 'character', name: player.name, id: player.id } : { kind: 'note', text: line.name, done: false }
  })
}

export const characterLine = (player: { id: string; name: string }): Line => ({ kind: 'character', name: player.name, id: player.id })

/** Characters added at the end, in the order given. */
export const addCharacters = (lines: readonly Line[], players: readonly { id: string; name: string }[]): Line[] => [...lines, ...players.map(characterLine)]
export const addNote = (lines: readonly Line[], text: string): Line[] => (text.trim() === '' ? [...lines] : [...lines, { kind: 'note', text: text.trim(), done: false }])
export const removeLine = (lines: readonly Line[], index: number): Line[] => lines.filter((_, at) => at !== index)

/** A line moved one place up (-1) or down (1). Out of range changes nothing. */
export function moveLine(lines: readonly Line[], index: number, direction: -1 | 1): Line[] {
  const target = index + direction
  const next = [...lines]
  if (index < 0 || index >= next.length || target < 0 || target >= next.length) return next
  ;[next[index], next[target]] = [next[target]!, next[index]!]
  return next
}

/** A note's text or its finished mark changed. The text is kept as typed (cleanLines trims it when the lines are saved). */
export function setNote(lines: readonly Line[], index: number, change: { text?: string; done?: boolean }): Line[] {
  return lines.map((line, at) => (at === index && line.kind === 'note' ? { ...line, ...(change.text !== undefined ? { text: change.text } : {}), ...(change.done !== undefined ? { done: change.done } : {}) } : line))
}

/** The lines ready to save: note text trimmed and a note with no text left out. */
export function cleanLines(lines: readonly Line[]): Line[] {
  return lines.flatMap((line): Line[] => (line.kind === 'note' ? (line.text.trim() === '' ? [] : [{ ...line, text: line.text.trim() }]) : [line]))
}

/**
 * Someone receives an item through an open note: they become a character line at the note's place and the note moves down one line, so the next
 * receipt through it comes after this one. Anything but an open note at that index changes nothing.
 */
export function receiveThroughNote(lines: readonly Line[], noteIndex: number, player: { id: string; name: string }): Line[] {
  const note = lines[noteIndex]
  if (note?.kind !== 'note' || note.done) return [...lines]
  return [...lines.slice(0, noteIndex), characterLine(player), ...lines.slice(noteIndex)]
}

/** The roster as a person picks from it: by class then name (the order that groups the class colors), or by name alone. */
export function sortPlayers<T extends { name: string; className: string }>(players: readonly T[], by: 'class' | 'name'): T[] {
  const byName = (a: T, b: T) => a.name.localeCompare(b.name)
  return [...players].sort(by === 'class' ? (a, b) => a.className.localeCompare(b.className) || byName(a, b) : byName)
}
