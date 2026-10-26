// Mains get loot priority over alts (LOOT-006): who is still waiting when an alt is about to receive an item, and the words and the note the dialogs use.
// Names are invented: this repository is public.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { makeWho } from '../../src/shared/game/candidates.ts'
import { ALT_RUN_NOTE, AWARD_NOTE_MAX, mainsFirstText, waitingMains, withAltRunNote } from '../../src/features/loot/mainsFirst.ts'

const roster = [
  { id: 'm1', name: 'Aria', className: 'Mage', mainId: undefined },
  { id: 'm2', name: 'Brock', className: 'Warrior', mainId: undefined },
  { id: 'a1', name: 'Aria-Alt', className: 'Druid', mainId: 'm1' },
  { id: 'a2', name: 'Brock-Alt', className: 'Rogue', mainId: 'm2' },
  { id: 'x1', name: 'Orphan-Alt', className: 'Priest', mainId: 'gone' },
]
const who = makeWho(roster as never)
const list = (names: string[], ids: string[]) => ({ rankedPlayers: names, rankedIds: ids })

describe('the mains still waiting when an alt gets the item', () => {
  it('names the mains on the list who have not received it', () => {
    assert.deepEqual(waitingMains(list(['Aria', 'Brock', 'Aria-Alt'], ['m1', 'm2', 'a1']), [false, false, false], who, roster, 'a1'), ['Aria', 'Brock'])
  })
  it('is nobody when the recipient is a main: a main may always be given it', () => {
    assert.deepEqual(waitingMains(list(['Aria', 'Brock'], ['m1', 'm2']), [false, false], who, roster, 'm2'), [])
  })
  it('does not count a main who has received it, and counts one whose second listing is still open', () => {
    assert.deepEqual(waitingMains(list(['Aria', 'Brock', 'Aria-Alt'], ['m1', 'm2', 'a1']), [true, false, false], who, roster, 'a1'), ['Brock'])
    assert.deepEqual(waitingMains(list(['Aria', 'Aria', 'Aria-Alt'], ['m1', 'm1', 'a1']), [true, false, false], who, roster, 'a1'), ['Aria'])
  })
  it('counts a main listed twice once', () => {
    assert.deepEqual(waitingMains(list(['Aria', 'Aria', 'Aria-Alt'], ['m1', 'm1', 'a1']), [false, false, false], who, roster, 'a1'), ['Aria'])
  })
  it('is nobody when every main on the list has it, or there are no mains on the list', () => {
    assert.deepEqual(waitingMains(list(['Aria', 'Aria-Alt'], ['m1', 'a1']), [true, false], who, roster, 'a2'), [])
    assert.deepEqual(waitingMains(list(['Aria-Alt', 'Brock-Alt'], ['a1', 'a2']), [false, false], who, roster, 'a1'), [])
  })
  it('does not count another alt, a note, or a name the roster does not have', () => {
    const noted = { rankedPlayers: ['Aria-Alt', 'Brock-Alt', 'Any mage who did not get it', 'Stranger', 'Brock'], rankedIds: ['a1', 'a2', '', '', 'm2'] }
    assert.deepEqual(waitingMains(noted, [false, false, false, false, false], who, roster, 'a1'), ['Brock'])
    assert.deepEqual(waitingMains({ rankedPlayers: ['Aria-Alt', 'Stranger'] }, [false, false], who, roster, 'a1'), [])
  })
  it('reads a line with only a name by the roster\'s name', () => {
    assert.deepEqual(waitingMains({ rankedPlayers: ['Aria', 'Aria-Alt'] }, [false, false], who, roster, 'a1'), ['Aria'])
  })
  it('treats an alt linked to a missing main as a main, and a recipient it makes an alt only by the roster\'s rule', () => {
    assert.deepEqual(waitingMains(list(['Orphan-Alt', 'Aria-Alt'], ['x1', 'a1']), [false, false], who, roster, 'a1'), ['Orphan-Alt'])
    assert.deepEqual(waitingMains(list(['Aria', 'Aria-Alt'], ['m1', 'a1']), [false, false], who, roster, 'x1'), [])
  })
  it('counts the recipient\'s own main: the main still comes first', () => {
    assert.deepEqual(waitingMains(list(['Aria', 'Aria-Alt'], ['m1', 'a1']), [false, false], who, roster, 'a1'), ['Aria'])
  })
  it('is nobody when there is no recipient or the recipient is not on the roster', () => {
    assert.deepEqual(waitingMains(list(['Aria'], ['m1']), [false], who, roster, undefined), [])
    assert.deepEqual(waitingMains(list(['Aria'], ['m1']), [false], who, roster, 'zz'), [])
  })
})

describe('the words and the note', () => {
  it('says the rule and who is waiting, in the singular and the plural', () => {
    assert.equal(mainsFirstText(['Aria']), 'Mains get loot prio over alts. 1 main on this list still needs it: Aria.')
    assert.equal(mainsFirstText(['Aria', 'Brock']), 'Mains get loot prio over alts. 2 mains on this list still need it: Aria, Brock.')
  })
  it('shows at most five names and counts the rest', () => {
    assert.equal(mainsFirstText(['A', 'B', 'C', 'D', 'E', 'F', 'G']), 'Mains get loot prio over alts. 7 mains on this list still need it: A, B, C, D, E and 2 more.')
  })
  it('starts the award note with the alt-only run, once, and keeps what was written', () => {
    assert.equal(withAltRunNote(''), ALT_RUN_NOTE)
    assert.equal(withAltRunNote('  rolled 98  '), 'Alt-only run. rolled 98')
    assert.equal(withAltRunNote('Alt-only run. rolled 98'), 'Alt-only run. rolled 98')
    assert.equal(withAltRunNote('this was an ALT-ONLY RUN night'), 'Alt-only run. this was an ALT-ONLY RUN night', 'only a note that starts with it is kept as it is')
    assert.equal(withAltRunNote('alt-only run, rolled 98'), 'alt-only run, rolled 98')
  })
  it('never cuts what the leader wrote: a note that no longer fits is left for the dialogs to refuse', () => {
    const long = 'x'.repeat(490)
    assert.equal(withAltRunNote(long), `${ALT_RUN_NOTE} ${long}`)
    assert.ok(withAltRunNote(long).length > AWARD_NOTE_MAX)
    assert.equal(withAltRunNote('x'.repeat(AWARD_NOTE_MAX - ALT_RUN_NOTE.length - 1)).length, AWARD_NOTE_MAX, 'the longest note that fits, with the mark')
  })
})
