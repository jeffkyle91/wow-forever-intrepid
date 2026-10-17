// The guild's own loot tables: what leaders add to, take off or change in the drop lists of Browse drops, kept in Firestore (`lootTables`, see
// firestore.rules) and merged here with the built-in captures in data/loot/.
//
// The lists belong to a PHASE. A document carries the phase number it was written in and means "from this phase on, until a later phase's
// document says otherwise". The lists of phase N are the built-in captures with every document of phase N or earlier applied in phase order, so
// a phase with no documents has the lists of the phase before it, and a change made in phase N never reaches an earlier phase. Only the current
// and the next phase are written (the rules), so a finished phase's lists are a record.
//
// A document says only what its phase changes: the items it adds and the items it takes off, and a creature's or zone's name, kind, place or size
// only when that phase sets them (so a later correction in an earlier phase still reaches the phases after it). The documents come in two
// kinds: a zone (`zone`) and a creature (`source`; the zone-wide list is a creature with the key "zonewide"). A zone document for a zone of the
// built-in captures can only say whether the zone is in the lists from its phase on (`removed`). A document is never deleted.
// No runtime imports, so Node runs its tests directly.
import type { LootSourceKind, LootTableCapture } from './lootTables.ts'

export const CUSTOM_ZONE_MIN = 50_000_000 // the rules keep a custom zone's number clear of the game's own
export const CUSTOM_ZONE_MAX = 99_999_999
export const TABLE_ITEMS_MAX = 80 // items a creature document can add, and items it can take off, each (the rules cap both lists)
export const TABLE_NAME_MAX = 100
export const TABLE_ORDER_MAX = 100_000
export const GAME_ID_MAX = 100_000_000
export const TABLE_PHASE_MAX = 31 // 30 finished phases at most, so the next phase can be 31 (see PHASE_HISTORY_MAX in phases.ts)
export const ZONE_WIDE_KEY = 'zonewide'
export const ZONE_WIDE_NAME = 'Any creature in the zone'

export type TableSourceKind = LootSourceKind | 'zonewide'
export type ZoneKind = 'dungeon' | 'raid'
// A zone document of a custom zone may carry name, kind and players (only what its phase sets); one for a zone of the built-in captures has at most
// `removed`. `removed` is true when the zone is out of the lists from this phase on and false when it is back in.
export type ZoneTableDoc = { id: string; type: 'zone'; zoneId: number; phaseNo: number; name?: string; kind?: ZoneKind; players?: number; removed?: boolean; rev: number }
export type SourceTableDoc = {
  id: string; type: 'source'; zoneId: number; key: string; phaseNo: number; name?: string; kind?: TableSourceKind; npcId?: number; order?: number
  itemIds: number[]; hiddenItemIds: number[]; removed?: boolean; rev: number
}
export type LootTableDoc = ZoneTableDoc | SourceTableDoc

export const zoneDocId = (zoneId: number, phaseNo: number) => `z${zoneId}_${phaseNo}`
export const sourceDocId = (zoneId: number, key: string, phaseNo: number) => `s${zoneId}_${key}_${phaseNo}`
// The key of a creature of the built-in captures: its game number. A creature the guild adds gets a random key (newCreatureKey).
export const builtInKey = (npcId: number) => `npc${npcId}`
export const newCreatureKey = () => `c${Math.random().toString(36).slice(2, 12)}${Date.now().toString(36)}`.slice(0, 24)
export function newZoneId(taken: Iterable<number>): number {
  const used = new Set(taken)
  for (let tries = 0; tries < 1000; tries += 1) {
    const candidate = CUSTOM_ZONE_MIN + Math.floor(Math.random() * (CUSTOM_ZONE_MAX - CUSTOM_ZONE_MIN))
    if (!used.has(candidate)) return candidate
  }
  throw new Error('No free zone number was found.')
}

const unique = (ids: number[]) => [...new Set(ids)]
/** A name the rules accept: after trimming, at least one character that is more than a space or a control character (the rules treat those as blank). */
export const hasText = (name: string) => [...name.trim()].some((character) => (character.codePointAt(0) ?? 0) > 32)
const sameList = (a: number[], b: number[]) => a.length === b.length && a.every((value, index) => value === b[index])

export type MergedSource = {
  key: string
  docId: string // the id of the document of the phase being looked at (it may not exist yet)
  doc?: SourceTableDoc // the document written in exactly this phase, when there is one
  name: string
  kind: TableSourceKind
  npcId?: number
  order: number
  builtIn: boolean // the creature is in the built-in capture
  introducedAt?: number // the phase a creature the guild added starts to exist in: that of its first document that names it
  beforeItemIds: number[] // what it drops entering this phase: the capture's and what earlier phases' documents added, less what they took off
  addedItemIds: number[] // added by this phase's document (never one it already had)
  hiddenItemIds: number[] // taken off by this phase's document (always ones it had)
  goneItemIds: number[] // items it dropped at some point (the capture's or an earlier phase's) that it does not now, and this phase did not take off
  itemIds: number[] // what it drops in this phase: before, less the taken off, plus the added
  removed: boolean // out of the lists in this phase
}
export type MergedZone = {
  zoneId: number
  phaseNo: number // the phase these lists are those of
  name: string
  kind: ZoneKind
  players: number
  custom: boolean // a zone the guild made; the others come from the built-in capture
  introducedAt?: number // the phase a zone the guild made starts to exist in: that of its first document that names it
  inPhase: boolean // in the lists in this phase (a zone can be left out of a phase, and come back)
  edited: boolean // the guild has written something about this zone in this phase or an earlier one
  doc?: ZoneTableDoc // the zone document written in exactly this phase, when there is one
  builtIn?: LootTableCapture
  sources: MergedSource[] // in the order they are met, removed ones included (the editor shows them)
  zoneWide: MergedSource
}

type Base = { name: string; kind: TableSourceKind; npcId?: number; itemIds: number[]; order: number }

// The items after one document: the ones it takes off must have been there, the ones it adds must not be (an item it both takes off and adds is there).
function applyItems(items: number[], doc: { itemIds: number[]; hiddenItemIds: number[] }) {
  const hidden = unique(doc.hiddenItemIds).filter((id) => items.includes(id))
  const kept = items.filter((id) => !hidden.includes(id))
  const added = unique(doc.itemIds).filter((id) => !kept.includes(id))
  return { hidden, added, items: [...kept, ...added] }
}

const latest = <T>(docs: T[], has: (doc: T) => boolean): T | undefined => [...docs].reverse().find(has)
const byPhase = <T extends { phaseNo: number }>(docs: T[]) => [...docs].sort((a, b) => a.phaseNo - b.phaseNo)

// One creature in one phase: the capture's creature (if any) with its documents of phase `phaseNo` and earlier applied in phase order.
function mergeSource(zoneId: number, key: string, phaseNo: number, base: Base | undefined, docs: SourceTableDoc[]): MergedSource | null {
  const upTo = byPhase(docs.filter((doc) => doc.phaseNo <= phaseNo))
  if (!base && upTo.length === 0) return null // a creature the guild adds does not exist before its first document
  // A creature of a capture keeps the capture's name (decision 2a: built-in creatures are not renamed, so a document that names one is ignored here).
  const named = base ? base.name : latest(upTo, (doc) => typeof doc.name === 'string')?.name
  if (!named) return null // a creature the guild adds that no document names does not exist
  let before = base?.itemIds ?? []
  const ever = new Set(before)
  for (const doc of upTo) if (doc.phaseNo < phaseNo) { before = applyItems(before, doc).items; before.forEach((id) => ever.add(id)) }
  const here = upTo.find((doc) => doc.phaseNo === phaseNo)
  const step = here ? applyItems(before, here) : { hidden: [] as number[], added: [] as number[], items: before }
  step.items.forEach((id) => ever.add(id))
  const latestWith = <K extends keyof SourceTableDoc>(field: K) => latest(upTo, (doc) => doc[field] !== undefined)?.[field]
  // A creature of a capture keeps the game number the capture gives it; one the guild added has the number its latest document gives.
  const npcId = base ? base.npcId : (latestWith('npcId') as number | undefined)
  // A creature of a capture and the zone-wide list cannot be taken out of the lists (a document that says so is ignored here, as the rules refuse it).
  const removed = !(key.startsWith('npc') && base !== undefined) && key !== ZONE_WIDE_KEY && latest(upTo, (doc) => typeof doc.removed === 'boolean')?.removed === true
  return {
    key,
    docId: sourceDocId(zoneId, key, phaseNo),
    ...(here ? { doc: here } : {}),
    name: named,
    kind: (key === ZONE_WIDE_KEY ? 'zonewide' : kindOf(latestWith('kind') as TableSourceKind | undefined)) ?? base?.kind ?? 'trash',
    ...(npcId === undefined ? {} : { npcId }),
    order: (latestWith('order') as number | undefined) ?? base?.order ?? 0,
    builtIn: key.startsWith('npc') && base !== undefined,
    ...(!base ? { introducedAt: (upTo.find((doc) => typeof doc.name === 'string') as SourceTableDoc).phaseNo } : {}),
    beforeItemIds: before,
    addedItemIds: step.added,
    hiddenItemIds: step.hidden,
    goneItemIds: [...ever].filter((id) => !step.items.includes(id) && !step.hidden.includes(id)),
    itemIds: step.items,
    removed,
  }
}

// Only the zone-wide list is of the kind zonewide, and nothing else can be made so.
const kindOf = (kind: TableSourceKind | undefined) => (kind === 'zonewide' ? undefined : kind)

const byOrder = (a: MergedSource, b: MergedSource) => a.order - b.order || a.name.localeCompare(b.name) || a.key.localeCompare(b.key)

/** The lists of one phase: the built-in captures with the guild's documents of that phase and earlier applied. Documents that fit no zone are ignored. */
export function mergeTables(captures: LootTableCapture[], docs: LootTableDoc[], phaseNo: number): MergedZone[] {
  const zoneDocs = new Map<number, ZoneTableDoc[]>()
  const sourceDocs = new Map<string, SourceTableDoc[]>() // by zone and key
  for (const doc of docs) {
    if (doc.phaseNo > phaseNo) continue
    if (doc.type === 'zone') zoneDocs.set(doc.zoneId, [...(zoneDocs.get(doc.zoneId) ?? []), doc])
    else sourceDocs.set(`${doc.zoneId}_${doc.key}`, [...(sourceDocs.get(`${doc.zoneId}_${doc.key}`) ?? []), doc])
  }
  const sourcesOf = (zoneId: number, skip: Set<string>) => [...sourceDocs.values()].filter((list) => list[0].zoneId === zoneId && list[0].key !== ZONE_WIDE_KEY && !skip.has(list[0].key))
  const zoneWideOf = (zoneId: number, table: LootTableCapture | undefined): MergedSource => {
    const merged = mergeSource(zoneId, ZONE_WIDE_KEY, phaseNo, { name: ZONE_WIDE_NAME, kind: 'zonewide', itemIds: table?.zoneWideItemIds ?? [], order: TABLE_ORDER_MAX }, sourceDocs.get(`${zoneId}_${ZONE_WIDE_KEY}`) ?? []) as MergedSource
    return { ...merged, name: ZONE_WIDE_NAME, kind: 'zonewide', builtIn: false }
  }
  // In the lists unless the latest document that says so takes it out; with no such document, a capture zone is in from its `fromPhase` on.
  const presence = (list: ZoneTableDoc[], fromPhase = 0) => { const stated = latest(byPhase(list), (doc) => typeof doc.removed === 'boolean')?.removed; return stated === undefined ? phaseNo >= fromPhase : stated !== true }
  const touched = (zoneId: number) => (zoneDocs.get(zoneId)?.length ?? 0) > 0 || [...sourceDocs.values()].some((list) => list[0].zoneId === zoneId)
  const live = (merged: MergedSource | null): MergedSource[] => (merged ? [merged] : [])

  const zones: MergedZone[] = captures.map((table) => {
    const list = byPhase(zoneDocs.get(table.zoneId) ?? [])
    const used = new Set<string>()
    const fromCapture = table.sources.flatMap((source, index) => {
      const key = builtInKey(source.npcId)
      used.add(key)
      return live(mergeSource(table.zoneId, key, phaseNo, { name: source.name, kind: source.kind, npcId: source.npcId, itemIds: source.itemIds, order: (index + 1) * 10 }, sourceDocs.get(`${table.zoneId}_${key}`) ?? []))
    })
    const added = sourcesOf(table.zoneId, used).flatMap((perKey) => live(mergeSource(table.zoneId, perKey[0].key, phaseNo, undefined, perKey)))
    const here = list.find((doc) => doc.phaseNo === phaseNo)
    return {
      zoneId: table.zoneId, phaseNo, name: table.name, kind: table.kind, players: table.players, custom: false, inPhase: presence(list, table.fromPhase ?? 0), edited: touched(table.zoneId), ...(here ? { doc: here } : {}), builtIn: table,
      sources: [...fromCapture, ...added].sort(byOrder), zoneWide: zoneWideOf(table.zoneId, table),
    }
  })
  for (const [zoneId, unsorted] of zoneDocs) {
    if (zoneId < CUSTOM_ZONE_MIN || zones.some((zone) => zone.zoneId === zoneId)) continue
    const list = byPhase(unsorted)
    const withName = latest(list, (doc) => typeof doc.name === 'string')
    if (!withName) continue // a zone the guild made that no document names does not exist
    const here = list.find((doc) => doc.phaseNo === phaseNo)
    zones.push({
      zoneId, phaseNo, name: withName.name ?? '', kind: latest(list, (doc) => doc.kind !== undefined)?.kind ?? 'dungeon', players: latest(list, (doc) => doc.players !== undefined)?.players ?? 5, custom: true,
      introducedAt: (list.find((doc) => typeof doc.name === 'string') as ZoneTableDoc).phaseNo, inPhase: presence(list), edited: true, ...(here ? { doc: here } : {}),
      sources: sourcesOf(zoneId, new Set()).flatMap((perKey) => live(mergeSource(zoneId, perKey[0].key, phaseNo, undefined, perKey))).sort(byOrder),
      zoneWide: zoneWideOf(zoneId, undefined),
    })
  }
  return zones.sort((a, b) => a.name.localeCompare(b.name) || a.zoneId - b.zoneId)
}

/**
 * A zone as Browse drops reads it: no removed creature, no creature without items, the items as they stand in the phase. An item two creatures of the
 * zone came to have (different phases can each add it somewhere) stays with the first creature in order, as a capture has it only once.
 */
export function effectiveCapture(zone: MergedZone): LootTableCapture {
  const seen = new Set<number>()
  const once = (ids: number[]) => ids.filter((id) => !seen.has(id) && (seen.add(id), true))
  const sources = zone.sources.filter((source) => !source.removed && source.kind !== 'zonewide').map((source) => ({
    npcId: source.npcId ?? 0, name: source.name, kind: source.kind as LootSourceKind, itemIds: once(source.itemIds),
  })).filter((source) => source.itemIds.length > 0)
  return {
    format: 1,
    zoneId: zone.zoneId,
    name: zone.name,
    kind: zone.kind,
    players: zone.players,
    source: zone.builtIn?.source ?? '',
    capturedAt: zone.builtIn?.capturedAt ?? '',
    ...(zone.builtIn?.dataStatus ? { dataStatus: zone.builtIn.dataStatus } : {}),
    ...(zone.builtIn?.notes ? { notes: zone.builtIn.notes } : {}),
    sources,
    zoneWideItemIds: once(zone.zoneWide.itemIds),
    custom: zone.custom,
    edited: zone.edited,
  }
}

/** The drop lists Browse drops shows in one phase: every zone that is in the lists, as it stands in that phase. */
export const dropTablesOf = (captures: LootTableCapture[], docs: LootTableDoc[], phaseNo: number): LootTableCapture[] =>
  mergeTables(captures, docs, phaseNo).filter((zone) => zone.inPhase).map(effectiveCapture)

// ---- Reading a stored document. The rules check sizes only, so what comes back is read tolerantly: a list keeps only whole item numbers, a
// field that is wrong is left out, and a document that fits no id of its own (or has no usable zone or phase) is skipped.

const isGameId = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= GAME_ID_MAX
const isPhase = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= TABLE_PHASE_MAX
const itemList = (value: unknown): number[] => (Array.isArray(value) ? unique(value.filter(isGameId)) : [])
const isName = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= TABLE_NAME_MAX

export function readTableDoc(id: string, data: Record<string, unknown>): LootTableDoc | null {
  if (!isGameId(data.zoneId) || !isPhase(data.phaseNo)) return null
  const rev = typeof data.rev === 'number' && Number.isInteger(data.rev) && data.rev >= 0 ? data.rev : 0
  const removed = typeof data.removed === 'boolean' ? { removed: data.removed } : {}
  const name = isName(data.name) ? { name: data.name } : {}
  if (data.type === 'zone') {
    if (id !== zoneDocId(data.zoneId, data.phaseNo)) return null
    // A zone of the built-in captures has at most the statement whether it is in the lists: its name, kind and size come from the capture.
    if (data.zoneId < CUSTOM_ZONE_MIN) return { id, type: 'zone', zoneId: data.zoneId, phaseNo: data.phaseNo, rev, ...removed }
    const kind: { kind?: ZoneKind } = data.kind === 'raid' ? { kind: 'raid' } : data.kind === 'dungeon' ? { kind: 'dungeon' } : {}
    const players = typeof data.players === 'number' && Number.isInteger(data.players) && data.players >= 1 && data.players <= 40 ? { players: data.players } : {}
    return { id, type: 'zone', zoneId: data.zoneId, phaseNo: data.phaseNo, ...name, ...kind, ...players, rev, ...removed }
  }
  if (data.type !== 'source' || typeof data.key !== 'string' || !/^[A-Za-z0-9]{1,30}$/.test(data.key) || id !== sourceDocId(data.zoneId, data.key, data.phaseNo)) return null
  const kinds: TableSourceKind[] = ['boss', 'rare', 'trash', 'zonewide']
  const kind = kinds.find((candidate) => candidate === data.kind)
  const order = typeof data.order === 'number' && Number.isInteger(data.order) && data.order >= 0 && data.order <= TABLE_ORDER_MAX ? { order: data.order } : {}
  return {
    id, type: 'source', zoneId: data.zoneId, key: data.key, phaseNo: data.phaseNo, ...name, ...(kind ? { kind } : {}), ...(isGameId(data.npcId) ? { npcId: data.npcId } : {}), ...order,
    itemIds: itemList(data.itemIds), hiddenItemIds: itemList(data.hiddenItemIds), rev, ...removed,
  }
}

/** The phase each custom zone and each creature was first written in, for the Log: its first document is "added", later ones are changes. */
export function firstPhases(docs: LootTableDoc[]): { zones: Map<number, number>; sources: Map<string, number> } {
  const zones = new Map<number, number>()
  const sources = new Map<string, number>()
  const keep = (map: Map<string | number, number>, key: string | number, phaseNo: number) => { if (!map.has(key) || (map.get(key) as number) > phaseNo) map.set(key, phaseNo) }
  for (const doc of docs) {
    if (doc.type === 'zone') keep(zones as Map<string | number, number>, doc.zoneId, doc.phaseNo)
    else keep(sources as Map<string | number, number>, `${doc.zoneId}_${doc.key}`, doc.phaseNo)
  }
  return { zones, sources }
}

/**
 * What the guild has written for one phase, in a few words for Settings (starting or reopening a phase changes what raiders see in Browse drops):
 * "adds the zone Molten Core, takes 1 zone out of the lists and changes 14 creatures". Empty when nothing is written for the phase.
 */
export function describePreparedTables(docs: LootTableDoc[], phaseNo: number): string {
  const here = docs.filter((doc) => doc.phaseNo === phaseNo)
  if (!here.length) return ''
  const earlier = new Set(docs.filter((doc) => doc.type === 'zone' && doc.phaseNo < phaseNo).map((doc) => doc.zoneId))
  const added = here.flatMap((doc) => (doc.type === 'zone' && doc.zoneId >= CUSTOM_ZONE_MIN && !earlier.has(doc.zoneId) && doc.name ? [doc.name] : []))
  const out = here.filter((doc) => doc.type === 'zone' && doc.removed === true).length
  const back = here.filter((doc) => doc.type === 'zone' && doc.removed === false).length
  const creatures = new Set(here.filter((doc) => doc.type === 'source').map((doc) => `${doc.zoneId}_${(doc as SourceTableDoc).key}`)).size
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
  const parts = [
    ...(added.length ? [`adds ${added.length === 1 ? 'the zone' : 'the zones'} ${added.join(', ')}`] : []),
    ...(out ? [`takes ${plural(out, 'zone', 'zones')} out of the lists`] : []),
    ...(back ? [`puts ${plural(back, 'zone', 'zones')} back`] : []),
    ...(creatures ? [`changes ${plural(creatures, 'creature', 'creatures')}`] : []),
  ]
  return parts.length ? parts.join(', ').replace(/, ([^,]*)$/, ' and $1') : 'changes the zones'
}

// ---- Reading what a leader pastes

/** Item numbers from pasted text: plain numbers and Wowhead item links (`.../item=872/name`), separated by spaces, commas or lines. */
export function parseItemIds(text: string): { ids: number[]; ignored: string[] } {
  const ids: number[] = []
  const ignored: string[] = []
  for (const token of text.split(/[\s,;]+/).filter(Boolean)) {
    const link = /item=(\d{1,9})/.exec(token)
    const id = link ? Number(link[1]) : /^\d{1,9}$/.test(token) ? Number(token) : NaN
    if (Number.isInteger(id) && id > 0 && id <= GAME_ID_MAX) { if (!ids.includes(id)) ids.push(id) }
    else ignored.push(token)
  }
  return { ids, ignored }
}

// ---- Changes. Each change is one audited write to a document of the phase being edited (`zone.phaseNo`): a new document (`create`) or an edit of
// the one that is already there (`existing` and `changes`). A new document says only what the change says (plus the empty item lists a creature
// document always has), so a phase's first change to something does not copy its name, kind or place and a later correction in an earlier phase
// still reaches this phase. A field of `changes` set to undefined is taken away. The editor builds them and the audited helper in guildApi.ts
// writes them.

export type TableChange = Partial<Record<'name' | 'kind' | 'players' | 'order' | 'npcId' | 'itemIds' | 'hiddenItemIds' | 'removed', unknown>>
export type NewTableDoc = Omit<ZoneTableDoc, 'id' | 'rev'> | Omit<SourceTableDoc, 'id' | 'rev'>
export type TableWrite = { id: string; create: NewTableDoc } | { id: string; existing: LootTableDoc; changes: TableChange }

type SourceFields = { itemIds?: number[]; hiddenItemIds?: number[]; order?: number; name?: string; kind?: TableSourceKind; removed?: boolean }

function writeSource(zone: MergedZone, source: MergedSource, fields: SourceFields): TableWrite {
  if (source.doc) return { id: source.doc.id, existing: source.doc, changes: fields }
  return {
    id: source.docId,
    create: { type: 'source', zoneId: zone.zoneId, key: source.key, phaseNo: zone.phaseNo, itemIds: [], hiddenItemIds: [], ...fields } as NewTableDoc,
  }
}

// What this phase's document would say about items, as the target state: the added list and the taken off list the document should have. Only the
// lists that differ from what the document has now are written. Decided by `before` (what the creature has entering this phase), never by what the
// document happens to list, so a leftover entry cannot make an item impossible to take off.
function itemWrite(zone: MergedZone, source: MergedSource, nextAdded: number[], nextHidden: number[]): TableWrite | null {
  const rawAdded = source.doc?.itemIds ?? []
  const rawHidden = source.doc?.hiddenItemIds ?? []
  const fields: SourceFields = {}
  if (!sameList(nextAdded, rawAdded)) fields.itemIds = nextAdded
  if (!sameList(nextHidden, rawHidden)) fields.hiddenItemIds = nextHidden
  return Object.keys(fields).length ? writeSource(zone, source, fields) : null
}

/** Items the zone has in this phase, by the creature that drops them (the zone's list counts as a creature). One creature per item in a zone. */
export function itemHolders(zone: MergedZone): Map<number, string> {
  const holders = new Map<number, string>()
  for (const source of [...zone.sources.filter((candidate) => !candidate.removed), zone.zoneWide]) for (const id of source.itemIds) if (!holders.has(id)) holders.set(id, source.name)
  return holders
}

export type AddItemsResult = { write: TableWrite | null; added: number[]; alreadyIn: { id: number; where: string }[]; tooMany: boolean }

/**
 * Add items to a creature (or the zone-wide list) in this phase. An item the zone already has stays where it is and is reported; one this phase took
 * off comes back; one an earlier phase took off is added again.
 */
export function addItems(zone: MergedZone, source: MergedSource, wanted: number[]): AddItemsResult {
  const ids = unique(wanted)
  const holders = itemHolders(zone)
  const restore = ids.filter((id) => source.hiddenItemIds.includes(id) && !holders.has(id))
  const fresh = ids.filter((id) => !holders.has(id) && !source.hiddenItemIds.includes(id))
  const alreadyIn = ids.filter((id) => holders.has(id)).map((id) => ({ id, where: holders.get(id) ?? '' }))
  const touched = [...restore, ...fresh]
  const nextAdded = [...unique(source.doc?.itemIds ?? []).filter((id) => !touched.includes(id)), ...fresh]
  const nextHidden = unique(source.doc?.hiddenItemIds ?? []).filter((id) => !touched.includes(id) && source.beforeItemIds.includes(id))
  if (nextAdded.length > TABLE_ITEMS_MAX) return { write: null, added: [], alreadyIn, tooMany: true }
  if (!touched.length) return { write: null, added: [], alreadyIn, tooMany: false }
  return { write: itemWrite(zone, source, nextAdded, nextHidden), added: touched, alreadyIn, tooMany: false }
}

/** Take an item off a creature from this phase on: earlier phases keep it, and an item this phase added is simply not added any more. */
export function takeOffItem(zone: MergedZone, source: MergedSource, id: number): TableWrite | null {
  if (!source.itemIds.includes(id)) return null
  const nextAdded = unique(source.doc?.itemIds ?? []).filter((candidate) => candidate !== id)
  const rawHidden = unique(source.doc?.hiddenItemIds ?? []).filter((candidate) => source.beforeItemIds.includes(candidate))
  const nextHidden = source.beforeItemIds.includes(id) ? [...rawHidden.filter((candidate) => candidate !== id), id] : rawHidden
  if (nextHidden.length > TABLE_ITEMS_MAX) return null
  return itemWrite(zone, source, nextAdded, nextHidden)
}

/** Bring back an item this phase took off. */
export function restoreItem(zone: MergedZone, source: MergedSource, id: number): TableWrite | null {
  if (!source.hiddenItemIds.includes(id)) return null
  return itemWrite(zone, source, unique(source.doc?.itemIds ?? []).filter((candidate) => candidate !== id), unique(source.doc?.hiddenItemIds ?? []).filter((candidate) => candidate !== id && source.beforeItemIds.includes(candidate)))
}

/** A new creature the guild adds to a zone from this phase on, met after the others. The first document of a creature says everything about it. */
export function addCreature(zone: MergedZone, fields: { name: string; kind: LootSourceKind; npcId?: number }, key: string = newCreatureKey()): TableWrite {
  const order = Math.min(TABLE_ORDER_MAX, Math.max(0, ...zone.sources.map((source) => source.order)) + 10)
  return {
    id: sourceDocId(zone.zoneId, key, zone.phaseNo),
    create: { type: 'source', zoneId: zone.zoneId, key, phaseNo: zone.phaseNo, name: fields.name.trim(), kind: fields.kind, ...(fields.npcId === undefined ? {} : { npcId: fields.npcId }), order, itemIds: [], hiddenItemIds: [] },
  }
}

/** A creature the guild added is taken out of the lists from this phase on (its items are kept, so bringing it back restores them), or brought back. Built-in creatures and the zone-wide list stay. */
export const setCreatureRemoved = (zone: MergedZone, source: MergedSource, removed: boolean): TableWrite | null =>
  !source.builtIn && source.key !== ZONE_WIDE_KEY && source.removed !== removed ? writeSource(zone, source, { removed }) : null

/** Rename a creature the guild added (a creature of the built-in lists keeps its name). */
export function renameCreature(zone: MergedZone, source: MergedSource, name: string, kind: TableSourceKind): TableWrite | null {
  if (source.builtIn || source.key === ZONE_WIDE_KEY || !hasText(name)) return null
  const fields: { name?: string; kind?: TableSourceKind } = {}
  if (name.trim() !== source.name) fields.name = name.trim()
  if (kind !== source.kind) fields.kind = kind
  return Object.keys(fields).length ? writeSource(zone, source, fields) : null
}

/**
 * Move a creature one place earlier or later among the creatures met. When the two trade places cleanly (their places differ and no third creature
 * shares either one) they simply swap their places, two writes. Otherwise (a tie would put a third creature in between) every creature from the pair
 * on is given a place just after the one before it where it has to be, so the order that results is exactly the swapped one.
 */
export function moveCreature(zone: MergedZone, source: MergedSource, direction: -1 | 1): TableWrite[] {
  const live = zone.sources.filter((candidate) => !candidate.removed)
  const index = live.findIndex((candidate) => candidate.key === source.key)
  const neighbor = live[index + direction]
  if (index < 0 || !neighbor) return []
  const clean = source.order !== neighbor.order && !live.some((candidate) => candidate !== source && candidate !== neighbor && (candidate.order === source.order || candidate.order === neighbor.order))
  if (clean) {
    const first = direction === -1 ? source : neighbor // the one that ends up earlier
    const second = direction === -1 ? neighbor : source
    const low = Math.min(source.order, neighbor.order)
    const high = Math.max(source.order, neighbor.order)
    return [writeSource(zone, first, { order: low }), writeSource(zone, second, { order: high })]
  }
  const target = [...live]
  target[index] = neighbor
  target[index + direction] = source
  const start = Math.min(index, index + direction)
  let previous = start > 0 ? live[start - 1].order : -1
  const writes: TableWrite[] = []
  for (const creature of target.slice(start)) {
    const order = creature.order > previous ? creature.order : previous + 1
    if (order > TABLE_ORDER_MAX) return []
    if (order !== creature.order) writes.push(writeSource(zone, creature, { order }))
    previous = order
  }
  return writes
}

/**
 * Make this phase follow the one before it again for a creature: everything this phase's document says is taken away. Not offered for a creature that
 * starts in this phase (there is nothing earlier to follow).
 */
export function resetCreature(zone: MergedZone, source: MergedSource): TableWrite | null {
  const doc = source.doc
  if (!doc || (!source.builtIn && source.introducedAt === zone.phaseNo)) return null
  const says = doc.itemIds.length > 0 || doc.hiddenItemIds.length > 0 || doc.name !== undefined || doc.kind !== undefined || doc.order !== undefined || doc.npcId !== undefined || doc.removed !== undefined
  return says ? { id: doc.id, existing: doc, changes: { itemIds: [], hiddenItemIds: [], name: undefined, kind: undefined, order: undefined, npcId: undefined, removed: undefined } } : null
}

/** A zone the guild makes, in the lists from this phase on. The first document of a zone says everything about it. */
export function addZone(fields: { name: string; kind: ZoneKind; players: number }, taken: Iterable<number>, phaseNo: number): { zoneId: number; write: TableWrite } {
  const zoneId = newZoneId(taken)
  return { zoneId, write: { id: zoneDocId(zoneId, phaseNo), create: { type: 'zone', zoneId, phaseNo, name: fields.name.trim(), kind: fields.kind, players: fields.players } } }
}

// A write to the zone's document of this phase: an edit when it exists, otherwise a new one that says only what the change says.
function writeZone(zone: MergedZone, fields: { name?: string; kind?: ZoneKind; players?: number; removed?: boolean }): TableWrite {
  if (zone.doc) return { id: zone.doc.id, existing: zone.doc, changes: fields }
  return { id: zoneDocId(zone.zoneId, zone.phaseNo), create: { type: 'zone', zoneId: zone.zoneId, phaseNo: zone.phaseNo, ...fields } as NewTableDoc }
}

/** Rename or resize a zone the guild made, from this phase on. */
export const editZone = (zone: MergedZone, fields: { name: string; kind: ZoneKind; players: number }): TableWrite | null => {
  if (!zone.custom) return null
  const changes: { name?: string; kind?: ZoneKind; players?: number } = {}
  if (fields.name.trim() !== zone.name) changes.name = fields.name.trim()
  if (fields.kind !== zone.kind) changes.kind = fields.kind
  if (fields.players !== zone.players) changes.players = fields.players
  return Object.keys(changes).length && hasText(fields.name) ? writeZone(zone, changes) : null
}

/** Take a zone out of the lists from this phase on, or put it back. Every zone can be, built-in or not; earlier phases are not touched. */
export const setZoneInPhase = (zone: MergedZone, inPhase: boolean): TableWrite | null => (zone.inPhase === inPhase ? null : writeZone(zone, { removed: !inPhase }))

/** Make this phase follow the one before it again for a zone: what this phase's document says about the zone is taken away. */
export function resetZone(zone: MergedZone): TableWrite | null {
  const doc = zone.doc
  if (!doc || (zone.custom && zone.introducedAt === zone.phaseNo)) return null
  const says = doc.removed !== undefined || doc.name !== undefined || doc.kind !== undefined || doc.players !== undefined
  if (!says) return null
  return { id: doc.id, existing: doc, changes: { removed: undefined, ...(zone.custom ? { name: undefined, kind: undefined, players: undefined } : {}) } }
}
