// Random but deterministic test data for the loot table fuzz tests: a seeded generator, random captures and documents of the guild, a compact printer for a
// failing case, and a shrinker. Every name and number is invented. Nothing here uses Math.random: a case is a pure function of its seed and options.
import type { LootTableDoc, SourceTableDoc, ZoneTableDoc } from '../../../src/shared/game/guildTables.ts'
import type { LootSourceKind, LootTableCapture } from '../../../src/shared/game/lootTables.ts'

export function makeRng(seed: number) {
  let state = seed >>> 0
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0 // mulberry32
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const int = (count: number) => Math.floor(next() * count)
  const chance = (probability: number) => next() < probability
  const pick = <T>(list: readonly T[]): T => list[int(list.length)]
  const shuffle = <T>(list: readonly T[]): T[] => {
    const copy = [...list]
    for (let index = copy.length - 1; index > 0; index -= 1) {
      const other = int(index + 1)
      ;[copy[index], copy[other]] = [copy[other], copy[index]]
    }
    return copy
  }
  const sample = <T>(list: readonly T[], count: number): T[] => shuffle(list).slice(0, count)
  return { next, int, chance, pick, shuffle, sample }
}
export type Rng = ReturnType<typeof makeRng>

export type CaseOptions = {
  hostile?: boolean // documents the rules would refuse: both lists naming one item, removed on a capture creature or the zone-wide list
  sparseIntro?: boolean // the first document of a guild creature or custom zone does not set every attribute
  density?: number // how likely a document is for a key in a phase (default 0.4)
  reachable?: boolean // only what the client can write: no creature that looks like a capture creature but is in no capture, no zone outside the captures and the custom range, and nothing before a creature or zone is named
}
export type TableCase = { captures: LootTableCapture[]; docs: LootTableDoc[]; phases: number[]; options: CaseOptions }

const ZONE_NAMES = ['Alder Hollow', 'Bramble Keep', 'Cinder Vault', 'Dusk Mine']
const CREATURE_NAMES = ['Ash', 'Bog', 'Cinder', 'Dusk', 'Ember', 'Frost'] // few names, so ties in the order are common
const KINDS: LootSourceKind[] = ['boss', 'rare', 'trash']
const CAPTURE_ZONE_IDS = [1, 10, 20, 49_999_999]
const CUSTOM_ZONE_IDS = [50_000_000, 50_000_001, 99_999_999, 100_000_000]
const FOREIGN_ZONE_IDS = [7, 49_999_998] // neither a capture nor a custom zone
const GUILD_KEYS = ['ca', 'cb', 'cc', 'cd']
const STALE_KEYS = ['npc7', 'npc8'] // look like a capture creature but are in no capture
const PHASE_SETS = [[0, 1, 2, 3, 4, 5, 6], [0, 1, 2, 3, 4, 5, 6], [1, 2, 3], [2, 10, 11], [0, 2, 10, 31], [3, 4, 5, 6, 7], [1, 2, 9, 10, 12, 31]]

const sourceDoc = (zoneId: number, key: string, phaseNo: number, fields: Partial<SourceTableDoc>): SourceTableDoc =>
  ({ id: `s${zoneId}_${key}_${phaseNo}`, type: 'source', zoneId, key, phaseNo, itemIds: [], hiddenItemIds: [], rev: 1, ...fields })
const zoneDoc = (zoneId: number, phaseNo: number, fields: Partial<ZoneTableDoc>): ZoneTableDoc =>
  ({ id: `z${zoneId}_${phaseNo}`, type: 'zone', zoneId, phaseNo, rev: 1, ...fields })

function genCapture(rng: Rng, zoneId: number, universe: number[]): LootTableCapture {
  const count = 1 + rng.int(4)
  const npcIds = rng.sample([1, 2, 3, 4, 5, 6], count)
  const lists: number[][] = npcIds.map(() => [])
  const zoneWide: number[] = []
  for (const id of rng.shuffle(universe)) {
    const target = rng.int(count + 2) // a creature, the zone-wide list, or nothing: an item is in at most one place of a capture
    if (target < count) lists[target].push(id)
    else if (target === count) zoneWide.push(id)
  }
  lists.forEach((list, index) => {
    if (list.length === 0) list.push(zoneWide.pop() ?? 900 + index) // a capture creature has at least one item
  })
  const fromPhase = rng.chance(0.35) ? rng.pick([0, 1, 2, 3, 5, 6, 7]) : undefined
  return {
    format: 1, zoneId, name: rng.pick(ZONE_NAMES), kind: rng.pick(['dungeon', 'raid'] as const), players: rng.pick([5, 10, 20, 40]), source: 'https://example.test/zone', capturedAt: '2026-10-16',
    sources: npcIds.map((npcId, index) => ({ npcId, name: rng.pick(CREATURE_NAMES), kind: rng.pick(KINDS), itemIds: lists[index] })),
    zoneWideItemIds: zoneWide,
    ...(fromPhase === undefined ? {} : { fromPhase }),
  }
}

type KeyKind = 'capture' | 'zonewide' | 'guild' | 'stale'

export function genCase(rng: Rng, options: CaseOptions = {}): TableCase {
  const density = options.density ?? 0.4
  const phases = rng.pick(PHASE_SETS)
  const universe = Array.from({ length: 6 + rng.int(9) }, (_, index) => 101 + index) // few items, so the same item turns up everywhere
  const captureIds = rng.sample(CAPTURE_ZONE_IDS, 1 + rng.int(3))
  const captures = captureIds.map((zoneId) => genCapture(rng, zoneId, universe))
  const customIds = rng.sample(CUSTOM_ZONE_IDS, rng.int(3))
  const foreignIds = options.reachable ? [] : rng.sample(FOREIGN_ZONE_IDS, rng.int(2))
  const docs: LootTableDoc[] = []

  const itemLists = (captureItems: number[]) => {
    const itemIds = rng.sample(universe, rng.pick([0, 0, 1, 1, 2, 3]))
    const hiddenPool = captureItems.length > 0 && rng.chance(0.5) ? captureItems : universe
    const hiddenItemIds = rng.sample(hiddenPool.filter((id) => !itemIds.includes(id)), rng.pick([0, 0, 1, 1, 2, 3]))
    if (rng.chance(0.04) && itemIds.length > 0) itemIds.push(itemIds[0]) // a repeat inside one list
    if (rng.chance(0.04) && hiddenItemIds.length > 0) hiddenItemIds.push(hiddenItemIds[0])
    if (options.hostile && rng.chance(0.15) && hiddenItemIds.length > 0) itemIds.push(hiddenItemIds[0]) // one item in both lists of one document
    return { itemIds, hiddenItemIds }
  }

  const genZoneDocs = (zoneId: number, custom: boolean, foreign: boolean): number | undefined => {
    const introPhase = custom && rng.chance(0.85) ? rng.pick(phases) : undefined
    for (const phaseNo of phases) {
      const forced = phaseNo === introPhase
      if (custom && options.reachable && (introPhase === undefined || phaseNo < introPhase)) continue
      if (!forced && !rng.chance(density)) continue
      const fields: Partial<ZoneTableDoc> = {}
      if (!custom && !foreign) {
        if (rng.chance(0.85)) fields.removed = rng.chance(0.5) // a built-in zone document says only removed (an empty one is neutral)
      } else {
        const named = forced || (introPhase !== undefined && phaseNo > introPhase && rng.chance(0.3)) || foreign
        if (named) fields.name = rng.pick(ZONE_NAMES)
        if ((forced && !options.sparseIntro) || rng.chance(0.3)) fields.kind = rng.pick(['dungeon', 'raid'] as const)
        if ((forced && !options.sparseIntro) || rng.chance(0.3)) fields.players = rng.pick([5, 10, 25, 40])
        if (rng.chance(0.3)) fields.removed = rng.chance(0.5)
      }
      docs.push(zoneDoc(zoneId, phaseNo, fields))
    }
    return introPhase
  }

  const genSourceDocs = (zoneId: number, key: string, keyKind: KeyKind, captureItems: number[], zoneFrom = 0) => {
    const introChoices = phases.filter((phaseNo) => !options.reachable || phaseNo >= zoneFrom)
    const introPhase = (keyKind === 'guild' || keyKind === 'stale') && introChoices.length > 0 && rng.chance(0.85) ? rng.pick(introChoices) : undefined
    for (const phaseNo of phases) {
      const forced = phaseNo === introPhase
      if (options.reachable && phaseNo < zoneFrom) continue
      if (options.reachable && (keyKind === 'guild' || keyKind === 'stale') && (introPhase === undefined || phaseNo < introPhase)) continue
      if (!forced && !rng.chance(density)) continue
      const fields: Partial<SourceTableDoc> = itemLists(captureItems)
      const guildLike = keyKind === 'guild' || keyKind === 'stale'
      const afterIntro = introPhase !== undefined && phaseNo > introPhase
      if (guildLike) {
        if (forced || (afterIntro && rng.chance(0.2))) fields.name = rng.pick(CREATURE_NAMES)
        if ((forced && !options.sparseIntro) || rng.chance(0.2)) fields.kind = rng.pick(KINDS)
        if ((forced && !options.sparseIntro) || rng.chance(0.25)) fields.order = rng.int(13) * 5
        if (rng.chance(forced ? 0.4 : 0.15)) fields.npcId = 50 + rng.int(10)
        if (rng.chance(0.25)) fields.removed = keyKind === 'stale' && !options.hostile ? false : rng.chance(0.5) // the rules forbid removed true on an npc key
      } else if (keyKind === 'capture') {
        if (rng.chance(0.12)) fields.name = rng.pick(CREATURE_NAMES)
        if (rng.chance(0.12)) fields.kind = rng.pick(KINDS)
        if (rng.chance(0.2)) fields.order = rng.int(13) * 5
        if (rng.chance(0.1)) fields.npcId = 50 + rng.int(10) // a capture creature's number is the capture's, whatever a document says
        if (rng.chance(options.hostile ? 0.15 : 0.08)) fields.removed = options.hostile ? rng.chance(0.7) : false
      } else {
        if (rng.chance(0.08)) fields.name = rng.pick(CREATURE_NAMES)
        if (rng.chance(0.15)) fields.kind = 'zonewide'
        if (rng.chance(options.hostile ? 0.15 : 0.05)) fields.removed = options.hostile ? rng.chance(0.7) : false
      }
      docs.push(sourceDoc(zoneId, key, phaseNo, fields))
    }
  }

  // `zoneFrom`: the first phase of the zone itself (a custom zone), before which the client cannot write anything about its creatures.
  const genKeys = (zoneId: number, capture: LootTableCapture | undefined, zoneFrom = 0) => {
    for (const entry of capture?.sources ?? []) genSourceDocs(zoneId, `npc${entry.npcId}`, 'capture', entry.itemIds, zoneFrom)
    genSourceDocs(zoneId, 'zonewide', 'zonewide', capture?.zoneWideItemIds ?? [], zoneFrom)
    for (const key of rng.sample(GUILD_KEYS, rng.int(4))) genSourceDocs(zoneId, key, 'guild', [], zoneFrom)
    if (!options.reachable) for (const key of rng.sample(STALE_KEYS, rng.int(2))) genSourceDocs(zoneId, key, 'stale', [], zoneFrom)
  }
  for (const capture of captures) {
    genZoneDocs(capture.zoneId, false, false)
    genKeys(capture.zoneId, capture)
  }
  for (const zoneId of customIds) {
    const from = genZoneDocs(zoneId, true, false)
    if (!options.reachable || from !== undefined) genKeys(zoneId, undefined, from ?? 0)
  }
  for (const zoneId of foreignIds) {
    genZoneDocs(zoneId, true, true)
    genKeys(zoneId, undefined)
  }
  return { captures, docs: rng.shuffle(docs), phases, options }
}

// The phases to ask the lists of for a case: 0..7, every phase a document has, and the one after it.
export const phasesToCheck = (docs: LootTableDoc[]): number[] => {
  const asked = new Set<number>([0, 1, 2, 3, 4, 5, 6, 7])
  for (const doc of docs) {
    asked.add(doc.phaseNo)
    asked.add(Math.min(doc.phaseNo + 1, 31))
  }
  return [...asked].sort((a, b) => a - b)
}

// Freezes the inputs for good, so a merge that changes its arguments (a sort in place, a push) throws instead of passing silently.
export function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const inner of Object.values(value)) deepFreeze(inner)
  }
  return value
}

// A compact, readable account of a case for a failure message.
export function formatCase(captures: LootTableCapture[], docs: LootTableDoc[]): string {
  const lines: string[] = []
  for (const capture of captures) {
    lines.push(`capture zone ${capture.zoneId} "${capture.name}" ${capture.kind} ${capture.players}p${capture.fromPhase === undefined ? '' : ` fromPhase=${capture.fromPhase}`} zonewide=[${capture.zoneWideItemIds}]`)
    capture.sources.forEach((entry, index) => lines.push(`  #${index} npc${entry.npcId} "${entry.name}" ${entry.kind} items=[${entry.itemIds}]`))
  }
  const sorted = [...docs].sort((a, b) => a.zoneId - b.zoneId || a.phaseNo - b.phaseNo || a.id.localeCompare(b.id))
  for (const doc of sorted) {
    if (doc.type === 'zone') {
      const parts = [doc.name !== undefined && `name="${doc.name}"`, doc.kind !== undefined && `kind=${doc.kind}`, doc.players !== undefined && `players=${doc.players}`, doc.removed !== undefined && `removed=${doc.removed}`].filter(Boolean)
      lines.push(`doc ${doc.id}: ${parts.join(' ') || '(empty)'}`)
    } else {
      const parts = [
        doc.itemIds.length > 0 && `add=[${doc.itemIds}]`, doc.hiddenItemIds.length > 0 && `hide=[${doc.hiddenItemIds}]`, doc.name !== undefined && `name="${doc.name}"`, doc.kind !== undefined && `kind=${doc.kind}`,
        doc.order !== undefined && `order=${doc.order}`, doc.npcId !== undefined && `npcId=${doc.npcId}`, doc.removed !== undefined && `removed=${doc.removed}`,
      ].filter(Boolean)
      lines.push(`doc ${doc.id}: ${parts.join(' ') || '(empty)'}`)
    }
  }
  return lines.join('\n')
}

// Makes a failing case smaller: drops documents, zones, creatures, fields and items one at a time while `fails` stays true.
export function shrinkCase(captures: LootTableCapture[], docs: LootTableDoc[], fails: (captures: LootTableCapture[], docs: LootTableDoc[]) => boolean): { captures: LootTableCapture[]; docs: LootTableDoc[] } {
  let current = { captures: structuredClone(captures), docs: structuredClone(docs) as LootTableDoc[] }
  const attempt = (candidate: { captures: LootTableCapture[]; docs: LootTableDoc[] }) => {
    if (!fails(candidate.captures, candidate.docs)) return false
    current = candidate
    return true
  }
  const copy = () => ({ captures: structuredClone(current.captures), docs: structuredClone(current.docs) as LootTableDoc[] })
  for (let round = 0; round < 8; round += 1) {
    let changed = false
    for (let index = current.docs.length - 1; index >= 0; index -= 1) {
      const next = copy()
      next.docs.splice(index, 1)
      changed = attempt(next) || changed
    }
    for (let index = current.captures.length - 1; index >= 0; index -= 1) {
      const next = copy()
      next.captures.splice(index, 1)
      changed = attempt(next) || changed
    }
    for (let zone = 0; zone < current.captures.length; zone += 1) {
      for (let index = current.captures[zone].sources.length - 1; index >= 0; index -= 1) {
        const next = copy()
        next.captures[zone].sources.splice(index, 1)
        changed = attempt(next) || changed
      }
      const withoutFrom = copy()
      delete withoutFrom.captures[zone].fromPhase
      changed = (current.captures[zone].fromPhase !== undefined && attempt(withoutFrom)) || changed
    }
    for (let index = 0; index < current.docs.length; index += 1) {
      const doc = current.docs[index]
      const fieldNames = (doc.type === 'zone' ? ['name', 'kind', 'players', 'removed'] : ['name', 'kind', 'npcId', 'order', 'removed']) as string[]
      for (const field of fieldNames) {
        if ((doc as Record<string, unknown>)[field] === undefined) continue
        const next = copy()
        delete (next.docs[index] as Record<string, unknown>)[field]
        changed = attempt(next) || changed
      }
      if (doc.type === 'source') {
        for (const list of ['itemIds', 'hiddenItemIds'] as const) {
          for (let item = current.docs[index].type === 'source' ? (current.docs[index] as SourceTableDoc)[list].length - 1 : -1; item >= 0; item -= 1) {
            const next = copy()
            ;(next.docs[index] as SourceTableDoc)[list].splice(item, 1)
            changed = attempt(next) || changed
          }
        }
      }
    }
    for (let zone = 0; zone < current.captures.length; zone += 1) {
      for (let source = 0; source < current.captures[zone].sources.length; source += 1) {
        for (let item = current.captures[zone].sources[source].itemIds.length - 1; item >= 0; item -= 1) {
          const next = copy()
          next.captures[zone].sources[source].itemIds.splice(item, 1)
          changed = attempt(next) || changed
        }
      }
      for (let item = current.captures[zone].zoneWideItemIds.length - 1; item >= 0; item -= 1) {
        const next = copy()
        next.captures[zone].zoneWideItemIds.splice(item, 1)
        changed = attempt(next) || changed
      }
    }
    if (!changed) break
  }
  return current
}
