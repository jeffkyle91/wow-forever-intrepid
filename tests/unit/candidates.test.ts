import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { addCharacters, addNote, cleanLines, convertLegacy, lineChanges, lineFields, makeWho, moveLine, nameKey, readLines, receiveThroughNote, removeLastCharacter, addCharacterAt, removeLine, setNote, sortPlayers, type Line } from '../../src/shared/game/candidates.ts'

// Every name here is invented: this repository is public.
const roster = [
  { id: 'p-1', name: 'Morrow', className: 'Warlock' },
  { id: 'p-2', name: 'Aurelia', className: 'Mage' },
  { id: 'p-3', name: 'Vex', className: 'Warlock', surname: 'Dunmore' },
  { id: 'p-4', name: 'Aurelia', className: 'Priest' },
]
const who = makeWho(roster)
const character = (name: string, id?: string): Line => ({ kind: 'character', name, ...(id !== undefined ? { id } : {}) })
const note = (text: string, done = false): Line => ({ kind: 'note', text, done })

describe('readLines', () => {
  it('reads a priority with names only as characters without ids', () => {
    assert.deepEqual(readLines({ rankedPlayers: ['Morrow', 'Vex'] }), [character('Morrow'), character('Vex')])
  })
  it('reads ids beside the names: a character by id, an open note, a finished note', () => {
    assert.deepEqual(readLines({ rankedPlayers: ['Morrow', 'Any warlock', 'Old idea'], rankedIds: ['p-1', '', '!'] }), [character('Morrow', 'p-1'), note('Any warlock'), note('Old idea', true)])
  })
  it('ignores ids that are not a list as long as the names, as a whole', () => {
    assert.deepEqual(readLines({ rankedPlayers: ['Morrow', 'Vex'], rankedIds: ['p-1'] }), [character('Morrow'), character('Vex')])
    assert.deepEqual(readLines({ rankedPlayers: ['Morrow'], rankedIds: 'p-1' }), [character('Morrow')])
    assert.deepEqual(readLines({ rankedPlayers: ['Morrow'], rankedIds: null }), [character('Morrow')])
  })
  it('reads an element that is not text as a character without an id, and never throws', () => {
    assert.deepEqual(readLines({ rankedPlayers: ['Morrow', 'Vex'], rankedIds: [5, 'p-3'] }), [character('Morrow'), character('Vex', 'p-3')])
    assert.deepEqual(readLines({ rankedPlayers: [] }), [])
  })
})

describe('lineFields', () => {
  it('stores names only when no line is a character by id or a note, so an old priority stays as it was', () => {
    assert.deepEqual(lineFields([character('Morrow'), character('Vex')]), { rankedPlayers: ['Morrow', 'Vex'] })
    assert.deepEqual(lineFields([]), { rankedPlayers: [] })
  })
  it('stores ids as well otherwise, with the markers for a note', () => {
    assert.deepEqual(lineFields([character('Morrow', 'p-1'), note('Any warlock'), note('Old idea', true)]), { rankedPlayers: ['Morrow', 'Any warlock', 'Old idea'], rankedIds: ['p-1', '', '!'] })
  })
  it('stores a character without an id in a list that has ids as an open note, because nothing else fits', () => {
    assert.deepEqual(lineFields([character('Morrow', 'p-1'), character('Typo')]).rankedIds, ['p-1', ''])
  })
  it('round-trips through readLines', () => {
    const lines = [character('Morrow', 'p-1'), note('Any warlock'), character('Vex', 'p-3'), note('Old idea', true)]
    assert.deepEqual(readLines(lineFields(lines)), lines)
  })
})

describe('lineChanges', () => {
  it('is the fields when the new lines store ids or the priority has none', () => {
    assert.deepEqual(lineChanges({}, [character('Morrow', 'p-1')]), { rankedPlayers: ['Morrow'], rankedIds: ['p-1'] })
    assert.deepEqual(lineChanges({}, [character('Morrow')]), { rankedPlayers: ['Morrow'] })
  })
  it('takes stale ids away when the new lines store none', () => {
    const changes = lineChanges({ rankedIds: ['x'] }, [character('Morrow')])
    assert.deepEqual(Object.keys(changes).sort(), ['rankedIds', 'rankedPlayers'])
    assert.equal(changes.rankedIds, undefined)
  })
})

describe('makeWho', () => {
  it('knows a line by its id, and a line with only a name by the roster character who has that name', () => {
    assert.equal(who.lineKey(character('Anything', 'p-1')), 'id:p-1')
    assert.equal(who.lineKey(character('  morrow ')), 'id:p-1')
    assert.equal(who.lineKey(character('Vex Dunmore')), 'id:p-3')
  })
  it('keeps a name the roster does not have, or two characters share, as a name', () => {
    assert.equal(who.lineKey(character('Stranger')), 'name:stranger')
    assert.equal(who.lineKey(character('Aurelia')), 'name:aurelia')
  })
  it('gives a note no key, and an award the key of its recipient id or its name', () => {
    assert.equal(who.lineKey(note('Any warlock')), undefined)
    assert.equal(who.awardKey({ recipient: 'Morrowind', recipientId: 'p-1' }), 'id:p-1')
    assert.equal(who.awardKey({ recipient: 'Morrow' }), 'id:p-1')
  })
  it('shows the roster\'s current name for an id, else the name the line has, and the text of a note', () => {
    const renamed = makeWho([{ id: 'p-1', name: 'Morrowind', className: 'Warlock' }])
    assert.equal(renamed.nameOf(character('Morrow', 'p-1')), 'Morrowind')
    assert.equal(renamed.nameOf(character('Gone', 'p-9')), 'Gone')
    assert.equal(renamed.nameOf(note('Any warlock')), 'Any warlock')
  })
  it('knows the class of a character line, by id or by name, and of no note or stranger', () => {
    assert.equal(who.classOf(character('x', 'p-2')), 'Mage')
    assert.equal(who.classOf(character('Morrow')), 'Warlock')
    assert.equal(who.classOf(character('Stranger')), undefined)
    assert.equal(who.classOf(note('x')), undefined)
  })
  it('says whether a character line is on the roster', () => {
    assert.equal(who.known(character('x', 'p-2')), true)
    assert.equal(who.known(character('x', 'p-9')), false)
    assert.equal(who.known(character('Morrow')), true)
    assert.equal(who.known(note('x')), false)
  })
})

describe('convertLegacy', () => {
  it('gives each name that is one roster character\'s that character, and turns anything else into an open note', () => {
    const converted = convertLegacy([character('morrow'), character('Vex Dunmore'), character('Aurelia'), character('Vexx'), character('Aurelia', 'p-2')], who)
    assert.deepEqual(converted, [character('Morrow', 'p-1'), character('Vex', 'p-3'), note('Aurelia'), note('Vexx'), character('Aurelia', 'p-2')])
  })
  it('leaves notes and characters that have ids as they are', () => {
    const lines = [character('Old name', 'p-1'), note('Any warlock', true)]
    assert.deepEqual(convertLegacy(lines, who), lines)
  })
})

describe('editing lines', () => {
  const lines = [character('Morrow', 'p-1'), note('Any warlock'), character('Vex', 'p-3')]
  it('adds characters at the end, in the order given, and a note unless it is empty', () => {
    assert.deepEqual(addCharacters(lines, [{ id: 'p-2', name: 'Aurelia' }]).at(-1), character('Aurelia', 'p-2'))
    assert.equal(addNote(lines, '  Any mage ').at(-1)?.kind, 'note')
    assert.equal(addNote(lines, '  ').length, 3)
  })
  it('moves a line one place and changes nothing when it cannot move', () => {
    assert.deepEqual(moveLine(lines, 0, 1), [lines[1], lines[0], lines[2]])
    assert.deepEqual(moveLine(lines, 0, -1), lines)
    assert.deepEqual(moveLine(lines, 2, 1), lines)
    assert.deepEqual(moveLine(lines, 9, 1), lines)
  })
  it('takes a line off, and rewords or finishes a note only', () => {
    assert.deepEqual(removeLine(lines, 1), [lines[0], lines[2]])
    assert.deepEqual(setNote(lines, 1, { text: 'Any mage ', done: true })[1], note('Any mage ', true))
    assert.deepEqual(setNote(lines, 0, { text: 'x' }), lines)
  })
  it('ticking and unticking in the picker: a character is added at the end, and unticking takes the last listing of that character off', () => {
    const ticked = addCharacters(lines, [{ id: 'p-2', name: 'Aurelia' }])
    assert.deepEqual(ticked.map((line) => (line.kind === 'character' ? line.id : 'note')), ['p-1', 'note', 'p-3', 'p-2'])
    assert.deepEqual(removeLastCharacter(ticked, 'p-2'), lines)
  })
  it('a character listed twice keeps the earlier listing when the last is taken off, and notes and other characters are never touched', () => {
    const twice = [character('Morrow', 'p-1'), character('Vex', 'p-3'), note('Any warlock'), character('Morrow', 'p-1')]
    assert.deepEqual(removeLastCharacter(twice, 'p-1'), [character('Morrow', 'p-1'), character('Vex', 'p-3'), note('Any warlock')])
    assert.deepEqual(removeLastCharacter(removeLastCharacter(twice, 'p-1'), 'p-1'), [character('Vex', 'p-3'), note('Any warlock')])
  })
  it('taking off a character who is not on the list changes nothing, and a line typed by name (no id) is not matched by an id', () => {
    assert.deepEqual(removeLastCharacter(lines, 'p-9'), lines)
    assert.deepEqual(removeLastCharacter([character('Morrow')], 'p-1'), [character('Morrow')])
    assert.deepEqual(removeLastCharacter([], 'p-1'), [])
  })
  it('puts a character back where an untick took them from, and at the end when that place is past the end', () => {
    const [first, ...rest] = lines
    assert.deepEqual(addCharacterAt(rest, { id: 'p-1', name: 'Morrow' }, 0), [first, ...rest])
    assert.deepEqual(addCharacterAt(lines, { id: 'p-2', name: 'Aurelia' }, 1).map((line) => (line.kind === 'character' ? line.id : 'note')), ['p-1', 'p-2', 'note', 'p-3'])
    assert.deepEqual(addCharacterAt(lines, { id: 'p-2', name: 'Aurelia' }, 99).at(-1), character('Aurelia', 'p-2'))
    assert.deepEqual(addCharacterAt(lines, { id: 'p-2', name: 'Aurelia' }, -4)[0], character('Aurelia', 'p-2'))
    assert.deepEqual(addCharacterAt([], { id: 'p-2', name: 'Aurelia' }, 3), [character('Aurelia', 'p-2')])
  })
  it('does not change the list it is given', () => {
    const before = JSON.stringify(lines)
    removeLastCharacter(lines, 'p-1')
    addCharacterAt(lines, { id: 'p-2', name: 'Aurelia' }, 1)
    assert.equal(JSON.stringify(lines), before)
  })
  it('trims note text and drops an empty note when the lines are cleaned for saving', () => {
    assert.deepEqual(cleanLines([character('Morrow', 'p-1'), note('  Any mage  '), note('   ')]), [character('Morrow', 'p-1'), note('Any mage')])
  })
})

describe('receiveThroughNote', () => {
  it('puts the winner on a character line where the note was and moves the note down one line', () => {
    const lines = [character('Morrow', 'p-1'), note('Any warlock'), character('Aurelia', 'p-2')]
    assert.deepEqual(receiveThroughNote(lines, 1, { id: 'p-3', name: 'Vex' }), [character('Morrow', 'p-1'), character('Vex', 'p-3'), note('Any warlock'), character('Aurelia', 'p-2')])
  })
  it('does the same again for the next receipt, so each winner is above the note', () => {
    let lines: Line[] = [character('Morrow', 'p-1'), note('Any warlock')]
    lines = receiveThroughNote(lines, 1, { id: 'p-3', name: 'Vex' })
    lines = receiveThroughNote(lines, 2, { id: 'p-2', name: 'Aurelia' })
    assert.deepEqual(lines.map((line) => (line.kind === 'note' ? line.text : line.name)), ['Morrow', 'Vex', 'Aurelia', 'Any warlock'])
  })
  it('changes nothing for a finished note, a character line or an index out of range', () => {
    const lines = [character('Morrow', 'p-1'), note('Old idea', true)]
    assert.deepEqual(receiveThroughNote(lines, 1, { id: 'p-3', name: 'Vex' }), lines)
    assert.deepEqual(receiveThroughNote(lines, 0, { id: 'p-3', name: 'Vex' }), lines)
    assert.deepEqual(receiveThroughNote(lines, 7, { id: 'p-3', name: 'Vex' }), lines)
  })
})

describe('sortPlayers', () => {
  it('sorts by class and then name, or by name alone, without changing the roster it is given', () => {
    const before = [...roster]
    assert.deepEqual(sortPlayers(roster, 'class').map((player) => player.id), ['p-2', 'p-4', 'p-1', 'p-3']) // Mage, Priest, then the two Warlocks by name
    assert.deepEqual(sortPlayers(roster, 'name').map((player) => player.name), ['Aurelia', 'Aurelia', 'Morrow', 'Vex'])
    assert.deepEqual(roster, before)
  })
})

describe('nameKey', () => {
  it('trims, collapses spaces and ignores case', () => {
    assert.equal(nameKey('  Dun   Morogh '), 'dun morogh')
  })
})
