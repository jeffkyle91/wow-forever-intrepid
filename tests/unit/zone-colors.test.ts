import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ZONE_PALETTE, catalogZoneKey, defaultZoneColor, isHexColor, isZoneKey, readZoneColors, spreadColors, suggestColor, zoneColor } from '../../src/shared/game/zoneColors.ts'

// WCAG relative luminance and contrast, written out here so the test does not lean on the code it checks.
const channel = (value: number) => { const c = value / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
const luminance = (hex: string) => { const n = Number.parseInt(hex.slice(1), 16); return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255) }
const contrast = (a: string, b: string) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05) }

const LIGHT_PANEL = '#ffffff'
const DARK_PANEL = '#182536'

describe('the palette', () => {
  it('has sixteen different colors, each a valid hex color with its own name', () => {
    assert.equal(ZONE_PALETTE.length, 16)
    assert.equal(new Set(ZONE_PALETTE.map((entry) => entry.color)).size, 16)
    assert.equal(new Set(ZONE_PALETTE.map((entry) => entry.name)).size, 16)
    for (const entry of ZONE_PALETTE) assert.ok(isHexColor(entry.color), `${entry.name} ${entry.color}`)
  })

  it('every color is visible (at least 3 to 1) against both the light and the dark panel, so a bar or a dot in it can be seen in either theme', () => {
    for (const entry of ZONE_PALETTE) {
      assert.ok(contrast(entry.color, LIGHT_PANEL) >= 3, `${entry.name} on the light panel: ${contrast(entry.color, LIGHT_PANEL).toFixed(2)}`)
      assert.ok(contrast(entry.color, DARK_PANEL) >= 3, `${entry.name} on the dark panel: ${contrast(entry.color, DARK_PANEL).toFixed(2)}`)
    }
  })
})

// The hue of a color in degrees (0 to 360) and how colorful it is, to check the order the palette is offered in.
const hueAndSaturation = (hex: string) => {
  const n = Number.parseInt(hex.slice(1), 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((value) => value / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const delta = max - min
  const lightness = (max + min) / 2
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1))
  const hue = delta === 0 ? 0 : max === r ? ((g - b) / delta + 6) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4
  return { hue: hue * 60, saturation }
}

describe('the order of the palette', () => {
  it('goes around the rainbow from the reds, with the neutral slate last', () => {
    const colorful = ZONE_PALETTE.slice(0, -1)
    const hues = colorful.map((entry) => (hueAndSaturation(entry.color).hue + 10) % 360) // the reds either side of 0 degrees come first
    for (let index = 1; index < hues.length; index += 1) assert.ok(hues[index] > hues[index - 1], `${colorful[index].name} comes after ${colorful[index - 1].name}`)
    for (const entry of colorful) assert.ok(hueAndSaturation(entry.color).saturation > 0.3, `${entry.name} is a color`)
    assert.equal(ZONE_PALETTE[ZONE_PALETTE.length - 1].name, 'Slate')
    assert.ok(hueAndSaturation(ZONE_PALETTE[ZONE_PALETTE.length - 1].color).saturation < 0.3)
  })
})

const CHROMATIC = ZONE_PALETTE.slice(0, -1).map((entry) => entry.color as string)

describe('zone keys', () => {
  it('a zone number of up to nine digits, or r- and an id, is a zone key; nothing else is', () => {
    for (const good of ['0', '719', '50000001', '999999999', 'r-abc', 'r-0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e', 'r-A_b-9']) assert.ok(isZoneKey(good), good)
    for (const bad of ['', 'x', '-1', '1.5', '1e3', '1234567890', 'r-', 'r-has space', 'R-abc', `r-${'x'.repeat(41)}`, 'r-a/b', 5, null, undefined, ['719']]) assert.ok(!isZoneKey(bad), String(bad))
    assert.equal(catalogZoneKey('abc'), 'r-abc')
  })
})

describe('defaultZoneColor', () => {
  it('is one of the colors of the palette, but not the neutral one, and the same every time', () => {
    for (const zone of [719, 721, 1581, 2437, 50_000_001, 63_212_877, 99_999_999, 'r-abc', 'r-0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e']) {
      const color = defaultZoneColor(zone)
      assert.ok(CHROMATIC.includes(color), `${zone} ${color}`)
      assert.equal(defaultZoneColor(zone), color)
    }
  })

  it('a zone number and its key give the same color', () => {
    assert.equal(defaultZoneColor(719), defaultZoneColor('719'))
  })

  it('names no zone: nothing in the module depends on which zone it is (zones the app ships get colors the same way as any other)', () => {
    const colors = new Set([719, 721, 2437, 491, 796, 209, 1581, 717, 718].map((id) => defaultZoneColor(id)))
    assert.ok(colors.size >= 4, `the nine dungeons got only ${colors.size} different colors`)
  })

  it('spreads zone numbers over every color of the palette', () => {
    const counts = new Map<string, number>()
    for (let index = 0; index < 3000; index += 1) { const color = defaultZoneColor(50_000_000 + index * 7); counts.set(color, (counts.get(color) ?? 0) + 1) }
    assert.equal(counts.size, 15)
    for (const [color, count] of counts) assert.ok(count > 120 && count < 300, `${color} ${count}`)
  })

  it('gives anything that is not a zone key the neutral color', () => {
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '', 'x', '1e3']) assert.equal(defaultZoneColor(bad), '#637f8e', String(bad))
  })
})

describe('zoneColor', () => {
  it('is the automatic color with no choice, and a valid choice wins, in lower case', () => {
    assert.equal(zoneColor(719), defaultZoneColor(719))
    assert.equal(zoneColor(719, {}), defaultZoneColor(719))
    assert.equal(zoneColor(719, { 719: '#AA00BB' }), '#aa00bb')
    assert.equal(zoneColor('719', { 719: '#aa00bb' }), '#aa00bb')
    assert.equal(zoneColor(50_000_005, { '50000005': '#112233' }), '#112233')
    assert.equal(zoneColor('r-abc', { 'r-abc': '#112233' }), '#112233')
  })

  it('ignores a choice that is not a color, so a damaged setting cannot break a page', () => {
    for (const bad of ['red', '#abc', '#12345g', '#1234567', '', 5, null, undefined, ['#112233'], { a: 1 }, true]) {
      assert.equal(zoneColor(719, { 719: bad }), defaultZoneColor(719), JSON.stringify(bad))
    }
  })

  it('only the choice for that zone counts', () => {
    assert.equal(zoneColor(721, { 719: '#112233' }), defaultZoneColor(721))
    assert.equal(zoneColor('r-abc', { abc: '#112233' }), defaultZoneColor('r-abc'))
  })
})

describe('suggestColor', () => {
  it('offers the first color of the palette that no zone has', () => {
    assert.equal(suggestColor([]), '#d05065') // Crimson, the first
    assert.equal(suggestColor(['#d05065']), '#cd5643')
    assert.equal(suggestColor(['#D05065', '#cd5643', '#b76731']), '#a6712c')
  })

  it('skips colors in use wherever they are in the palette, and never offers the neutral slate', () => {
    assert.equal(suggestColor(['#d05065', '#b76731']), '#cd5643')
    assert.ok(!['#637f8e'].includes(suggestColor(['#637f8e'])))
  })

  it('when every color is in use, offers the one the fewest zones have, the first of them', () => {
    assert.equal(suggestColor([...CHROMATIC, ...CHROMATIC]), CHROMATIC[0])
    assert.equal(suggestColor([...CHROMATIC, CHROMATIC[0], CHROMATIC[2]]), CHROMATIC[1])
  })
})

describe('spreadColors', () => {
  it('gives each key a different color while the palette lasts, in the palette order, skipping colors already in use', () => {
    assert.deepEqual(spreadColors(['a', 'b', 'c'], []), { a: CHROMATIC[0], b: CHROMATIC[1], c: CHROMATIC[2] })
    assert.deepEqual(spreadColors(['a', 'b'], [CHROMATIC[0], CHROMATIC[2]]), { a: CHROMATIC[1], b: CHROMATIC[3] })
  })

  it('after the palette is used up, goes round again, so no color is used more than one more time than another', () => {
    const keys = Array.from({ length: 20 }, (_, index) => `k${index}`)
    const result = spreadColors(keys, [])
    const counts = CHROMATIC.map((color) => Object.values(result).filter((given) => given === color).length)
    assert.equal(Math.max(...counts) - Math.min(...counts), 1)
    assert.equal(Object.keys(result).length, 20)
  })

  it('gives nothing for no keys', () => {
    assert.deepEqual(spreadColors([], ['#d05065']), {})
  })
})

describe('readZoneColors', () => {
  it('keeps zone keys with valid colors, in lower case, and a zone number without leading zeros', () => {
    assert.deepEqual(readZoneColors({ 719: '#ABCDEF', '50000001': '#000000', 'r-abc': '#112233', '007': '#445566' }), { 719: '#abcdef', 50000001: '#000000', 'r-abc': '#112233', 7: '#445566' })
  })

  it('drops everything else: keys that are not whole numbers, colors that are not valid, and values that are not a map', () => {
    assert.deepEqual(readZoneColors({ x: '#112233', '-1': '#112233', '1.5': '#112233', '': '#112233', 'r-': '#112233', 'r-a b': '#112233', 5: 'blue', 6: 7 }), {})
    for (const bad of [null, undefined, 'x', 5, ['#112233'], true]) assert.deepEqual(readZoneColors(bad), {})
  })

  it('keeps at most the number asked for', () => {
    const many = Object.fromEntries(Array.from({ length: 300 }, (_, index) => [String(index), '#112233']))
    assert.equal(Object.keys(readZoneColors(many)).length, 200)
    assert.equal(Object.keys(readZoneColors(many, 5)).length, 5)
  })

  it('does not change what it is given', () => {
    const given = Object.freeze({ 719: '#ABCDEF' })
    assert.deepEqual(readZoneColors(given), { 719: '#abcdef' })
    assert.equal(given[719], '#ABCDEF')
  })
})
