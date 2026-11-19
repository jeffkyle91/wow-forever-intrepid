import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { canonicalJson, crc32, encodeNight, envelope, type NightModel } from '../../src/features/loot/nightString.ts'

// The fixtures of docs/spec/fixtures/ are the authority (docs/spec/exchange-v0.md section 12). Every name in them and here is invented.
const fixture = (name: string) => readFileSync(new URL(`../../docs/spec/fixtures/${name}`, import.meta.url), 'utf8')
const model = (name: string) => JSON.parse(fixture(`${name}.model.json`)) as NightModel

// The payload of a well-formed envelope: `length` characters after the fourth colon.
function payloadOf(text: string) {
  const parts = text.split(':', 4)
  const start = parts.join(':').length + 1
  return text.slice(start, start + Number(parts[3]))
}

const empty: NightModel = { schema: 1, id: 'n-test', at: 1796862600, by: 'RaidDesk/test', phase: 0, roster: [], priorities: [] }
const withName = (name: string, note?: string): NightModel => ({
  ...empty,
  roster: [{ k: 1, id: 'p1', name }],
  priorities: [{ id: 'pr1', item: 'Test Item', note, lines: [{ k: 1 }] }],
})
// Printable ASCII without `|`: what the whole envelope must be (section 1).
const SAFE = /^[\x20-\x7b\x7d\x7e]*$/

describe('encodeNight and the fixtures', () => {
  for (const name of ['night-small', 'night-empty']) {
    it(`writes ${name}.j.txt byte for byte from its model`, () => {
      assert.equal(encodeNight(model(name)), fixture(`${name}.j.txt`))
    })
  }

  it('rewrites the synthetic night byte for byte from its own payload', () => {
    // This file ends with a line break (the strings in fixtures/ do not); readers remove it (section 1.1, step 1).
    const text = fixture('synthetic/night.j.txt').trimEnd()
    assert.equal(encodeNight(JSON.parse(payloadOf(text))), text)
  })

  it('writes the fields in canonical order, whatever order the model has them in', () => {
    const small = model('night-small')
    const reversed = Object.fromEntries(Object.entries(small).reverse()) as NightModel
    reversed.roster = small.roster.map((player) => Object.fromEntries(Object.entries(player).reverse()) as NightModel['roster'][number])
    assert.equal(encodeNight(reversed), fixture('night-small.j.txt'))
  })
})

describe('crc32', () => {
  const vectors = JSON.parse(fixture('crc32-vectors.json')) as { text: string; crc32: string }[]
  for (const vector of vectors) {
    it(`gives ${vector.crc32} for ${JSON.stringify(vector.text)}`, () => assert.equal(crc32(vector.text), vector.crc32))
  }

  it('writes values with the high bit set as 8 lowercase hex digits', () => {
    assert.match(crc32('IM1:night:j:2:{}:'), /^[0-9a-f]{8}$/)
    assert.equal(crc32('123456789'), 'cbf43926')
  })

  it('ends every envelope with the checksum of everything before it', () => {
    const text = envelope('night', '{}')
    assert.equal(text, 'IM1:night:j:2:{}:578c47fe')
  })
})

describe('canonical JSON', () => {
  it('escapes quotes and backslashes', () => {
    assert.equal(canonicalJson({ a: 'say "hi" \\ back' }), '{"a":"say \\"hi\\" \\\\ back"}')
  })

  it('writes the short escapes and \\u00xx for other control characters', () => {
    assert.equal(canonicalJson({ a: '\b\f\n\r\t\u0001\u001f' }), '{"a":"\\b\\f\\n\\r\\t\\u0001\\u001f"}')
  })

  it('escapes |, DEL and every non-ASCII character in lowercase hex, and leaves / alone', () => {
    assert.equal(canonicalJson({ a: '|x|\u007f/Zoë Ærinwald  ' }), '{"a":"\\u007cx\\u007c\\u007f/Zo\\u00eb \\u00c6rinwald\\u00a0\\u2028"}')
  })

  it('writes a character above U+FFFF as a surrogate pair', () => {
    assert.equal(canonicalJson({ a: '\u{1F409}' }), '{"a":"\\ud83d\\udc09"}')
  })

  it('refuses a lone surrogate, which every reader refuses', () => {
    assert.throws(() => canonicalJson({ a: 'x\ud83dy' }), /lone surrogate/)
    assert.throws(() => canonicalJson({ a: '\udc09' }), /lone surrogate/)
  })

  it('refuses a number that is not an integer', () => {
    assert.throws(() => canonicalJson({ a: 2.5 }), /not an integer/)
    assert.throws(() => canonicalJson({ a: 1e21 }), /not an integer/)
    assert.throws(() => canonicalJson({ a: Number.NaN }), /not an integer/)
  })
})

describe('encodeNight', () => {
  it('keeps a whole envelope in printable ASCII without | whatever the names hold', () => {
    const text = encodeNight(withName('Zoë "Quill" \\ |Æ| \u{1F409}', 'see |notes|\nline two'))
    assert.match(text, SAFE)
    assert.equal(Number(text.split(':')[3]), payloadOf(text).length)
  })

  it('reads back to the same values', () => {
    const night = withName('Zoë "Quill" \\ |Æ| \u{1F409}', 'see |notes|\tline two')
    assert.deepEqual(JSON.parse(payloadOf(encodeNight(night))), night)
  })

  it('leaves out absent values, null and false, and writes true', () => {
    const night = { ...empty, roster: [{ k: 1, id: 'p1', name: 'Tess', surname: undefined, locked: true as const }], priorities: [{ id: 'pr1', item: 'Test Item', note: null, lines: [{ text: 'open', done: false }, { k: 1, awarded: true }] }] }
    const payload = payloadOf(encodeNight(night as unknown as NightModel))
    assert.equal(payload, '{"schema":1,"id":"n-test","at":1796862600,"by":"RaidDesk/test","phase":0,"roster":[{"k":1,"id":"p1","name":"Tess","locked":true}],"priorities":[{"id":"pr1","item":"Test Item","lines":[{"text":"open"},{"k":1,"awarded":true}]}]}')
  })

  it('writes empty roster and priority lists, and an empty list of lines', () => {
    const payload = payloadOf(encodeNight({ ...empty, priorities: [{ id: 'pr1', item: 'Test Item', lines: [] }] }))
    assert.equal(payload, '{"schema":1,"id":"n-test","at":1796862600,"by":"RaidDesk/test","phase":0,"roster":[],"priorities":[{"id":"pr1","item":"Test Item","lines":[]}]}')
  })

  it('refuses a field the spec does not have', () => {
    assert.throws(() => encodeNight({ ...empty, extra: 1 } as unknown as NightModel), /unknown fields extra/)
    assert.throws(() => encodeNight({ ...empty, roster: [{ k: 1, id: 'p1', name: 'Tess', mainId: 'p2' }] } as unknown as NightModel), /roster\[0\]: unknown fields mainId/)
  })

  it('counts the length in characters of the escaped payload, which is ASCII', () => {
    const text = encodeNight(withName('Ærin'))
    const payload = payloadOf(text)
    assert.ok(payload.includes('\\u00c6rin'))
    assert.equal(new TextEncoder().encode(payload).length, payload.length)
  })
})
