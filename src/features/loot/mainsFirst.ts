import { altIds } from '../../shared/game/alts.ts'
import { readLines, type Who } from '../../shared/game/candidates.ts'

// Mains get loot priority over alts (LOOT-006). When an item goes to an alt while a main who is on its list has not yet received it, the award dialogs say so. It is a
// warning only: the council decides, and nothing here can stop an award. Pure, so Node tests it; the dialogs only lay it out.
export const ALT_RUN_NOTE = 'Alt-only run.'

type ListedPriority = { rankedPlayers: readonly string[]; rankedIds?: unknown }

/**
 * The mains on a priority list who are still waiting for the item, when `recipientId` is an alt (otherwise nobody: a main may always be given it). A main is a roster
 * character that is not an alt by the roster's own rule (`altIds`); a line is waiting when its listing has not been received (`received`, the positional completion
 * the list shows, one entry per line of the priority). A main listed twice counts once, notes and characters the roster does not have are ignored, and the recipient
 * never counts. Each name is the roster's current one.
 */
export function waitingMains(priority: ListedPriority, received: readonly boolean[], who: Who, roster: readonly { id: string; mainId?: string }[], recipientId: string | undefined): string[] {
  if (recipientId === undefined) return []
  const alts = altIds([...roster])
  if (!alts.has(recipientId)) return []
  const seen = new Set<string>()
  const names: string[] = []
  readLines(priority).forEach((line, index) => {
    if (line.kind !== 'character' || received[index]) return
    const player = line.id !== undefined ? who.player(line.id) : who.byName(line.name)
    if (!player || player.id === recipientId || alts.has(player.id) || seen.has(player.id)) return
    seen.add(player.id)
    names.push(player.name)
  })
  return names
}

/** The sentence the dialogs show: the loot owner's rule, then who is still waiting (up to five names). */
export function mainsFirstText(names: readonly string[]): string {
  const shown = names.slice(0, 5).join(', ') + (names.length > 5 ? ` and ${names.length - 5} more` : '')
  return `Mains get loot prio over alts. ${names.length} ${names.length === 1 ? 'main on this list still needs' : 'mains on this list still need'} it: ${shown}.`
}

/** The award note of an alt-only run: "Alt-only run." first, so the reason is in the permanent record. Said once, and cut at the rules' limit. */
export function withAltRunNote(note: string, max = 500): string {
  const text = note.trim()
  if (/alt-only run/i.test(text)) return text
  return (text ? `${ALT_RUN_NOTE} ${text}` : ALT_RUN_NOTE).slice(0, max)
}
