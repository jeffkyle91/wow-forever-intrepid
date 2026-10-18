// The color of a zone, used as an accent on everything that belongs to it (the bar and chip of its loot, its dot in the lists). Nothing here names a zone: a zone
// has the color a Guild Leader chose for it in Settings (`overrides`, a map from the zone's key to a color, kept in the settings), and until one is chosen an
// automatic color made from its key, which is the same every time. A zone made in Settings has its color chosen as it is made (suggestColor offers one no other
// zone has yet), and spreadColors gives the zones that have none their own colors in one go.
//
// A zone's key is its number (a zone of the built-in drop lists, or one the guild made) or `r-` and the id of a zone of the older raid zone list.
//
// Every color here is a mid-tone of about the same lightness (a relative luminance near 0.2), so a bar, a dot or a border in it stays visible against both
// the light and the dark panels (at least 3 to 1, the minimum for a graphic; tests/unit/zone-colors.test.ts checks every one). Text is never set in a zone color:
// chips and tints are made from it with color-mix and the text keeps the page's own ink. No imports, so Node runs the tests directly.

/** The colors on offer, named, in color order (the reds first, around the rainbow, and the neutral slate last), as a picker lists them. */
export const ZONE_PALETTE = [
  { name: 'Crimson', color: '#d05065' },
  { name: 'Fire', color: '#cd5643' },
  { name: 'Copper', color: '#b76731' },
  { name: 'Amber', color: '#a6712c' },
  { name: 'Gold', color: '#957828' },
  { name: 'Olive', color: '#608824' },
  { name: 'Lime', color: '#378d25' },
  { name: 'Emerald', color: '#258d55' },
  { name: 'Teal', color: '#278794' },
  { name: 'Sky', color: '#2d85aa' },
  { name: 'Steel blue', color: '#3a7dcb' },
  { name: 'Indigo', color: '#6a72d7' },
  { name: 'Violet', color: '#9761d5' },
  { name: 'Magenta', color: '#c342cd' },
  { name: 'Rose', color: '#ce469c' },
  { name: 'Slate', color: '#637f8e' },
] as const

const CHROMATIC = ZONE_PALETTE.slice(0, -1) // every color but the neutral slate
const NEUTRAL = ZONE_PALETTE[ZONE_PALETTE.length - 1].color

/** The key a zone's color is kept under: a zone's key is a zone number, or `r-` and an id for a zone of the older raid zone list. */
export const ZONE_KEY = /^(?:[0-9]{1,9}|r-[A-Za-z0-9_-]{1,40})$/
export const isZoneKey = (value: unknown): value is string => typeof value === 'string' && ZONE_KEY.test(value)
export const catalogZoneKey = (id: string) => `r-${id}`

/** A color as the settings keep it: # and six hex digits. */
export const isHexColor = (value: unknown): value is string => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)

// A zone number as its key; anything that is not a whole number of 0 or more has no key.
const keyOf = (zone: number | string): string => (typeof zone === 'number' ? (Number.isInteger(zone) && zone >= 0 ? String(zone) : '') : zone)

// FNV-1a over the key: the same number every time, spread well even for keys that are alike.
const hash = (key: string) => { let value = 0x811c9dc5; for (let index = 0; index < key.length; index += 1) { value ^= key.charCodeAt(index); value = Math.imul(value, 0x01000193) >>> 0 } return value }

/** The automatic color of a zone, from its key alone: one of the colors of the palette, the same every time. A key that is not a zone key gets the neutral slate. */
export function defaultZoneColor(zone: number | string): string {
  const key = keyOf(zone)
  return isZoneKey(key) ? CHROMATIC[hash(key) % CHROMATIC.length].color : NEUTRAL
}

/** The color of a zone: the one a leader chose when it is a valid color, else the automatic one. `overrides` is read as it came from the settings, so anything may be in it. */
export function zoneColor(zone: number | string, overrides?: Readonly<Record<string, unknown>>): string {
  const key = keyOf(zone)
  const chosen = isZoneKey(key) ? overrides?.[key] : undefined
  return isHexColor(chosen) ? chosen.toLowerCase() : defaultZoneColor(zone)
}

// The colors of the palette (not the neutral one), each with how many of `taken` use it, in the order the palette lists them.
const usage = (taken: readonly string[]) => CHROMATIC.map((entry) => ({ color: entry.color as string, count: taken.filter((color) => color.toLowerCase() === entry.color).length }))

/** The color to offer for a new zone: the first color of the palette no zone in `taken` has, else the one the fewest have. */
export function suggestColor(taken: readonly string[]): string {
  return usage(taken).reduce((best, candidate) => (candidate.count < best.count ? candidate : best)).color
}

/** A color of its own for each of `keys` (in the order given), as far as the palette goes, then the colors the fewest zones have; `taken` are the colors zones already have. */
export function spreadColors(keys: readonly string[], taken: readonly string[]): Record<string, string> {
  const counts = usage(taken)
  const result: Record<string, string> = {}
  for (const key of keys) {
    const pick = counts.reduce((best, candidate) => (candidate.count < best.count ? candidate : best))
    pick.count += 1
    result[key] = pick.color
  }
  return result
}

/** The colors the settings hold, read safely: only a zone key with a valid color is kept (colors in lower case, a zone number without leading zeros), at most `max` of them. */
export function readZoneColors(value: unknown, max = 200): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  const result: Record<string, string> = {}
  for (const [key, color] of Object.entries(value)) {
    if (Object.keys(result).length >= max) break
    if (isZoneKey(key) && isHexColor(color)) result[/^[0-9]+$/.test(key) ? String(Number(key)) : key] = color.toLowerCase()
  }
  return result
}
