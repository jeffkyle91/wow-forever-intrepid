import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildNight, copyForAddon, newNightId, NIGHT_STRING_MAX, type NightInput } from '../../src/features/loot/copyForAddon.ts'

// Every name here is invented: this repository is public.
const roster = [
  { id: 'PlayerTessAAAAAAAAA1', name: 'Tess', surname: 'Marrowind', className: 'Warrior', role: 'Tank' as const },
  { id: 'PlayerOrrinAAAAAAAA2', name: 'Orrin', surname: 'Vale', className: 'Priest', role: 'Healer' as const },
  { id: 'PlayerOrrinAltAAAAA3', name: 'Quill', surname: 'Vale', className: 'Rogue', role: 'Melee' as const, mainId: 'PlayerOrrinAAAAAAAA2' },
  { id: 'PlayerZoeAAAAAAAAAA4', name: 'Zoë', className: 'Mage', role: 'Ranged' as const },
]
const priority = (id: string, item: string, rankedPlayers: string[], rankedIds: string[] | undefined, extra: Record<string, unknown> = {}) => ({ id, item, encounter: 'Test Hold · Grimjaw', rankedPlayers, rankedIds, councilNote: '', phaseNo: 1, ...extra })
const blade = priority('pr-blade', 'Blade of Testing', ['Tess', 'Orrin', 'any warlock', 'Tess', 'done note'], ['PlayerTessAAAAAAAAA1', 'PlayerOrrinAAAAAAAA2', '', 'PlayerTessAAAAAAAAA1', '!'], { itemId: 900001, zoneId: 991, npcId: 990001, councilNote: 'Tanks "first", then |DPS|' })
// Names only (from before roster ids): Quill is a roster name, Garrick is not.
const cloak = priority('pr-cloak', 'Cloak of Commas', ['Quill', 'Garrick Vole', 'Zoë'], undefined, { itemId: 900002, zoneId: 992 })
const award = (recipientId: string, recipient: string, extra: Record<string, unknown> = {}) => ({ id: `a-${recipient}`, priorityId: 'pr-blade', item: 'Blade of Testing', recipient, recipientId, awardedAt: '2026-12-02', phaseNo: 1, ...extra })

const base = (): NightInput => ({
  id: 'n-testnight01',
  at: 1796862600,
  by: 'RaidDesk/test',
  phase: 1,
  roster,
  priorities: [
    blade,
    cloak,
    priority('pr-hidden', 'Hidden Helm', ['Tess'], undefined, { hidden: true }),
    priority('pr-old', 'Old Gloves', ['Tess'], undefined, { phaseNo: 0 }),
    priority('pr-typed', 'Typed Ring', ['Orrin'], undefined, { encounter: '' }),
  ],
  awards: [award('PlayerTessAAAAAAAAA1', 'Tess')],
  raid: { id: 'raid-1209', date: '2026-12-09', name: 'Wednesday Test Night', size: 20 },
  locked: ['PlayerTessAAAAAAAAA1', 'PlayerOrrinAAAAAAAA2'],
  tables: [
    { zoneId: 991, sources: [{ npcId: 990001, name: 'Grimjaw' }, { npcId: 990002, name: 'Second Boss' }] },
    { zoneId: 993, sources: [{ npcId: 990009, name: 'Elsewhere' }] },
  ],
})

describe('buildNight', () => {
  it('sends the whole roster, numbered from 1, with surnames, classes, mains and the locked roster', () => {
    const { model } = buildNight(base())
    assert.deepEqual(model.roster, [
      { k: 1, id: 'PlayerTessAAAAAAAAA1', name: 'Tess', surname: 'Marrowind', class: 'Warrior', role: 'Tank', main: undefined, locked: true },
      { k: 2, id: 'PlayerOrrinAAAAAAAA2', name: 'Orrin', surname: 'Vale', class: 'Priest', role: 'Healer', main: undefined, locked: true },
      { k: 3, id: 'PlayerOrrinAltAAAAA3', name: 'Quill', surname: 'Vale', class: 'Rogue', role: 'Melee', main: 2, locked: undefined },
      { k: 4, id: 'PlayerZoeAAAAAAAAAA4', name: 'Zoë', surname: undefined, class: 'Mage', role: 'Ranged', main: undefined, locked: undefined },
    ])
  })

  it('warns about a roster entry with no surname, which matches no game character', () => {
    const { warnings } = buildNight(base())
    assert.ok(warnings.some((warning) => warning.startsWith('Zoë has no surname')))
  })

  it('sends only the priorities of the phase that are not hidden', () => {
    assert.deepEqual(buildNight(base()).model.priorities.map((p) => p.id), ['pr-blade', 'pr-cloak', 'pr-typed'])
    assert.deepEqual(buildNight({ ...base(), phase: 0 }).model.priorities.map((p) => p.id), ['pr-old'])
  })

  it('narrows by zone, keeping priorities that have no zone', () => {
    assert.deepEqual(buildNight({ ...base(), zones: [992] }).model.priorities.map((p) => p.id), ['pr-cloak', 'pr-typed'])
  })

  it('writes character lines, name-only lines and notes, with the awarded marks', () => {
    const { model } = buildNight(base())
    const [first, second, third] = model.priorities
    assert.deepEqual(first, {
      id: 'pr-blade', item: 'Blade of Testing', itemId: 900001, encounter: 'Test Hold · Grimjaw', npcId: 990001, zoneId: 991, note: 'Tanks "first", then |DPS|',
      lines: [{ k: 1, awarded: true }, { k: 2, awarded: undefined }, { text: 'any warlock', done: undefined }, { k: 1, awarded: undefined }, { text: 'done note', done: true }],
    })
    // A name the roster has becomes its character; one it does not have stays a name.
    assert.deepEqual(second?.lines, [{ k: 3, awarded: undefined }, { name: 'Garrick Vole', awarded: undefined }, { k: 4, awarded: undefined }])
    assert.equal(third?.encounter, undefined)
    assert.equal(third?.note, undefined)
  })

  it('marks as the award dialog does: two awards mark both listings, a removed one and an alt\'s award mark nothing', () => {
    const twice = buildNight({ ...base(), awards: [award('PlayerTessAAAAAAAAA1', 'Tess'), award('PlayerTessAAAAAAAAA1', 'Tess', { id: 'a2', awardedAt: '2026-12-09' })] })
    assert.deepEqual(twice.model.priorities[0]?.lines.filter((line) => 'k' in line).map((line) => 'awarded' in line && line.awarded === true), [true, false, true])
    const removed = buildNight({ ...base(), awards: [award('PlayerTessAAAAAAAAA1', 'Tess', { status: 'removed' })] })
    assert.ok(removed.model.priorities[0]?.lines.every((line) => !('awarded' in line) || line.awarded === undefined))
    const alt = buildNight({ ...base(), awards: [award('PlayerOrrinAltAAAAA3', 'Quill')] })
    assert.ok(alt.model.priorities[0]?.lines.every((line) => !('awarded' in line) || line.awarded === undefined))
  })

  it('marks a name-only line from an award to that name, and counts an award made in an earlier phase on a carried-over priority', () => {
    const named = buildNight({ ...base(), awards: [{ item: 'Cloak of Commas', recipient: 'Garrick Vole', phaseNo: 1 }] })
    assert.deepEqual(named.model.priorities[1]?.lines[1], { name: 'Garrick Vole', awarded: true })
    const carried = { ...base(), priorities: [priority('pr-blade-0', 'Blade of Testing', ['Tess'], ['PlayerTessAAAAAAAAA1'], { phaseNo: 0, hidden: true }), { ...blade, carriedFrom: 'pr-blade-0' }], awards: [award('PlayerTessAAAAAAAAA1', 'Tess', { priorityId: 'pr-blade-0', phaseNo: 0 })] }
    assert.deepEqual(buildNight(carried).model.priorities[0]?.lines[0], { k: 1, awarded: true })
  })

  it('turns a line whose character left the roster into a name-only line with its stored name', () => {
    const gone = priority('pr-gone', 'Gone Belt', ['Hesper Quillon'], ['PlayerGoneAAAAAAAAA9'])
    assert.deepEqual(buildNight({ ...base(), priorities: [gone] }).model.priorities[0]?.lines, [{ name: 'Hesper Quillon', awarded: undefined }])
  })

  it('leaves out a note with no text, which would make the addon skip the priority', () => {
    const blank = priority('pr-blank', 'Blank Note Bracers', ['Tess', '  '], ['PlayerTessAAAAAAAAA1', ''])
    assert.deepEqual(buildNight({ ...base(), priorities: [blank] }).model.priorities[0]?.lines, [{ k: 1, awarded: undefined }])
  })

  it('lists the addon awards of the phase, removed ones included, once each at their highest revision', () => {
    const addon = (sourceId: string, sourceRev: number, extra: Record<string, unknown> = {}) => ({ id: `addon-${sourceId}-${sourceRev}`, priorityId: '', item: 'Cloak of Commas', recipient: 'Quill', recipientId: 'PlayerOrrinAltAAAAA3', phaseNo: 1, sourceKind: 'addon', sourceId, sourceRev, ...extra })
    const { model, warnings } = buildNight({ ...base(), awards: [addon('s-tpt2u0-q4tz-1', 1796866530), addon('s-tpt2u0-q4tz-2', 1796866600, { status: 'removed' }), addon('s-tpt2u0-q4tz-1', 1796866900), addon('s-old-1', 5, { phaseNo: 0 }), { ...award('PlayerTessAAAAAAAAA1', 'Tess'), sourceKind: 'sheet', sourceId: 'sheet-1' }, addon('bad id', 3)] })
    assert.deepEqual(model.known, [{ id: 's-tpt2u0-q4tz-1', rev: 1796866900 }, { id: 's-tpt2u0-q4tz-2', rev: 1796866600 }])
    assert.ok(warnings.some((warning) => warning.includes('no usable source id')))
    assert.equal(buildNight(base()).model.known, undefined)
  })

  it('names the bosses of the zones the priorities are in', () => {
    assert.deepEqual(buildNight(base()).model.bosses, [{ npcId: 990001, name: 'Grimjaw', zoneId: 991 }, { npcId: 990002, name: 'Second Boss', zoneId: 991 }])
    assert.equal(buildNight({ ...base(), tables: [] }).model.bosses, undefined)
  })

  it('names the raid, and leaves out one the addon could not read', () => {
    assert.deepEqual(buildNight(base()).model.raid, { id: 'raid-1209', date: '2026-12-09', name: 'Wednesday Test Night', size: 20 })
    const bad = buildNight({ ...base(), raid: { id: 'raid.1209', date: '2026-12-09', name: 'Dotted', size: 20 } })
    assert.equal(bad.model.raid, undefined)
    assert.ok(bad.warnings.some((warning) => warning.includes('names no raid')))
    assert.equal(buildNight({ ...base(), raid: undefined }).model.raid, undefined)
  })

  it('warns about texts over the spec\'s limits, counted in code points', () => {
    const long = priority('pr-long', 'Long Note Shield', [], [], { councilNote: '\u{1F409}'.repeat(500) })
    assert.deepEqual(buildNight({ ...base(), priorities: [long] }).warnings.filter((w) => w.includes('council note')), [])
    const longer = priority('pr-long', 'Long Note Shield', [], [], { councilNote: 'é'.repeat(501) })
    assert.ok(buildNight({ ...base(), priorities: [longer] }).warnings.some((w) => w.includes('council note is longer than 500')))
    const name = buildNight({ ...base(), roster: [{ ...roster[0]!, name: 'N'.repeat(61) }] })
    assert.ok(name.warnings.some((w) => w.includes('name is longer than 60')))
    const lines = priority('pr-many', 'Many Lines Ring', Array(61).fill('Tess'), Array(61).fill('PlayerTessAAAAAAAAA1'))
    assert.ok(buildNight({ ...base(), priorities: [lines] }).warnings.some((w) => w.includes('more than 60 lines')))
  })
})

describe('copyForAddon', () => {
  it('makes a night string in printable ASCII without |, with names and notes that hold quotes, backslashes and accents', () => {
    const input = { ...base(), roster: [...roster, { id: 'PlayerOddAAAAAAAAAA5', name: 'O"Brae\\n', surname: 'Ærinwald|x', className: 'Druid' }] }
    const result = copyForAddon(input)
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.match(result.text, /^IM1:night:j:\d+:\{.*\}:[0-9a-f]{8}$/)
    assert.match(result.text, /^[\x20-\x7b\x7d\x7e]*$/)
    const payload = result.text.slice(result.text.indexOf('{'), result.text.lastIndexOf(':'))
    assert.deepEqual(JSON.parse(payload).roster[4], { k: 5, id: 'PlayerOddAAAAAAAAAA5', name: 'O"Brae\\n', surname: 'Ærinwald|x', class: 'Druid' })
    assert.equal(JSON.parse(payload).priorities[0].note, 'Tanks "first", then |DPS|')
  })

  it('makes an empty night when the phase has no priorities and there is no roster', () => {
    const result = copyForAddon({ id: 'n-empty00001', at: 1796862600, by: 'RaidDesk/2026.12.09', phase: 0, roster: [], priorities: [], awards: [] })
    assert.equal(result.ok && result.text, 'IM1:night:j:113:{"schema":1,"id":"n-empty00001","at":1796862600,"by":"RaidDesk/2026.12.09","phase":0,"roster":[],"priorities":[]}:409d3f47')
  })

  it('refuses a string over 100,000 characters and asks to narrow the zones', () => {
    const many = Array.from({ length: 400 }, (_, index) => priority(`pr-${index}`, `Item ${index} of a Long Night`, Array(8).fill('Tess'), Array(8).fill('PlayerTessAAAAAAAAA1'), { councilNote: 'x'.repeat(200) }))
    const result = copyForAddon({ ...base(), priorities: many })
    assert.equal(result.ok, false)
    assert.ok(!result.ok && result.error.includes('Narrow the zones'))
    assert.ok(!result.ok && result.error.includes(NIGHT_STRING_MAX.toLocaleString('en-US')))
  })

  it('refuses a night id, producer or phase the addon would refuse as a whole', () => {
    assert.equal(copyForAddon({ ...base(), id: 'n.bad' }).ok, false)
    assert.equal(copyForAddon({ ...base(), by: '   ' }).ok, false)
    assert.equal(copyForAddon({ ...base(), by: 'R'.repeat(61) }).ok, false)
    assert.equal(copyForAddon({ ...base(), phase: -1 }).ok, false)
    assert.equal(copyForAddon({ ...base(), at: 1.5 }).ok, false)
  })
})

describe('newNightId', () => {
  it('makes a valid id, new each time', () => {
    const one = newNightId()
    assert.match(one, /^n-[A-Za-z0-9]{12}$/)
    assert.notEqual(newNightId(), one)
    assert.equal(newNightId((bytes) => bytes.fill(0)), 'n-aaaaaaaaaaaa')
  })
})
