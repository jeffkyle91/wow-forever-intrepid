// Applying a TableWrite to a list of documents the way the audited write helper does (a create adds a document with rev 1, an edit patches the stored
// one and a field set to undefined is taken away), and the shape rules of firestore.rules for a table document, written from the spec
// (PR-texts/Design-loot-tables-phases.md, "Documents" and "What the rules check", and PR-texts/Design-zone-editor.md for the phase document), to check that no write would be refused.
import { isDeepStrictEqual } from 'node:util'
import type { LootTableDoc, TableWrite } from '../../../src/shared/game/guildTables.ts'

type Raw = Record<string, unknown>

const withoutUndefined = (raw: Raw): Raw => Object.fromEntries(Object.entries(raw).filter(([, value]) => value !== undefined))

// The documents after the write. Throws when the write itself is malformed: a create over an id that is there, or an edit of a document that is not
// the stored one (a stale or invented `existing`).
export function applyWrite(docs: LootTableDoc[], write: TableWrite): LootTableDoc[] {
  if ('create' in write) {
    if (docs.some((doc) => doc.id === write.id)) throw new Error(`create of ${write.id}, which exists`)
    return [...docs, withoutUndefined({ ...write.create, id: write.id, rev: 1 }) as unknown as LootTableDoc]
  }
  const stored = docs.find((doc) => doc.id === write.id)
  if (!stored) throw new Error(`edit of ${write.id}, which does not exist`)
  if (!isDeepStrictEqual(stored, write.existing)) throw new Error(`edit of ${write.id} from a document that is not the stored one`)
  const patched = withoutUndefined({ ...stored, ...(write.changes as Raw), rev: stored.rev + 1 }) as unknown as LootTableDoc
  return docs.map((doc) => (doc.id === write.id ? patched : doc))
}

const STAMPS = ['id', 'rev', 'updatedBy', 'updatedAt']
const ZONE_REQUIRED = ['type', 'zoneId', 'phaseNo']
const SOURCE_REQUIRED = ['type', 'zoneId', 'key', 'phaseNo', 'itemIds', 'hiddenItemIds']
const isInt = (value: unknown, min: number, max: number) => typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
const isName = (value: unknown) => typeof value === 'string' && value.trim().length >= 1 && value.trim().length <= 100
const isItemList = (value: unknown) => Array.isArray(value) && value.length <= 80 && value.every((id) => isInt(id, 1, 100_000_000))

// What the rules would refuse about a stored table document (`creating`: it was just created, so a built-in zone document must say `removed`).
export function rulesProblems(doc: LootTableDoc, creating: boolean): string[] {
  const raw = doc as unknown as Raw
  const problems: string[] = []
  const has = (field: string) => raw[field] !== undefined
  const keys = Object.keys(raw).filter((field) => raw[field] !== undefined)
  if (raw.type !== 'phase' && !isInt(raw.zoneId, 1, 100_000_000)) problems.push(`zoneId ${String(raw.zoneId)}`)
  if (!isInt(raw.phaseNo, 0, 31)) problems.push(`phaseNo ${String(raw.phaseNo)}`)
  if (raw.type === 'phase') {
    for (const field of ['type', 'phaseNo']) if (!has(field)) problems.push(`phase document lacks ${field}`)
    for (const field of keys) if (!['type', 'phaseNo', 'follows', ...STAMPS].includes(field)) problems.push(`phase document has ${field}`)
    if (has('follows') && !(isInt(raw.follows, 0, 31) && typeof raw.phaseNo === 'number' && (raw.follows as number) < raw.phaseNo)) problems.push(`follows ${String(raw.follows)} (phase ${String(raw.phaseNo)})`)
    if (raw.id !== `p${String(raw.phaseNo)}`) problems.push(`id ${String(raw.id)} does not match the fields`)
  } else if (raw.type === 'zone') {
    const custom = isInt(raw.zoneId, 50_000_000, 100_000_000)
    const allowed = [...ZONE_REQUIRED, ...(custom ? ['name', 'kind', 'players', 'removed'] : ['removed']), ...STAMPS]
    for (const field of ZONE_REQUIRED) if (!has(field)) problems.push(`zone document lacks ${field}`)
    for (const field of keys) if (!allowed.includes(field)) problems.push(`${custom ? 'custom' : 'built-in'} zone document has ${field}`)
    if (!custom && creating && !has('removed')) problems.push('a new built-in zone document must say removed')
    if (has('name') && !isName(raw.name)) problems.push(`name ${JSON.stringify(raw.name)}`)
    if (has('kind') && raw.kind !== 'dungeon' && raw.kind !== 'raid') problems.push(`kind ${String(raw.kind)}`)
    if (has('players') && !isInt(raw.players, 1, 40)) problems.push(`players ${String(raw.players)}`)
    if (has('removed') && typeof raw.removed !== 'boolean') problems.push(`removed ${String(raw.removed)}`)
    if (raw.id !== `z${String(raw.zoneId)}_${String(raw.phaseNo)}`) problems.push(`id ${String(raw.id)} does not match the fields`)
  } else if (raw.type === 'source') {
    const allowed = [...SOURCE_REQUIRED, 'name', 'kind', 'npcId', 'order', 'removed', ...STAMPS]
    for (const field of SOURCE_REQUIRED) if (!has(field)) problems.push(`source document lacks ${field}`)
    for (const field of keys) if (!allowed.includes(field)) problems.push(`source document has ${field}`)
    if (typeof raw.key !== 'string' || !/^[A-Za-z0-9]{1,30}$/.test(raw.key)) problems.push(`key ${String(raw.key)}`)
    if (has('itemIds') && !isItemList(raw.itemIds)) problems.push(`itemIds (${Array.isArray(raw.itemIds) ? raw.itemIds.length : String(raw.itemIds)} entries)`)
    if (has('hiddenItemIds') && !isItemList(raw.hiddenItemIds)) problems.push(`hiddenItemIds (${Array.isArray(raw.hiddenItemIds) ? raw.hiddenItemIds.length : String(raw.hiddenItemIds)} entries)`)
    if (Array.isArray(raw.itemIds) && Array.isArray(raw.hiddenItemIds) && raw.itemIds.some((id) => (raw.hiddenItemIds as unknown[]).includes(id))) problems.push('itemIds and hiddenItemIds share an item')
    if (has('name') && !isName(raw.name)) problems.push(`name ${JSON.stringify(raw.name)}`)
    if (has('kind') && !['boss', 'rare', 'trash', 'zonewide'].includes(raw.kind as string)) problems.push(`kind ${String(raw.kind)}`)
    if (has('npcId') && !isInt(raw.npcId, 1, 100_000_000)) problems.push(`npcId ${String(raw.npcId)}`)
    if (has('order') && !isInt(raw.order, 0, 100_000)) problems.push(`order ${String(raw.order)}`)
    if (has('removed') && typeof raw.removed !== 'boolean') problems.push(`removed ${String(raw.removed)}`)
    if (has('kind') && (raw.key === 'zonewide') !== (raw.kind === 'zonewide')) problems.push(`key ${String(raw.key)} with kind ${String(raw.kind)}`)
    if (raw.removed === true && (raw.key === 'zonewide' || /^npc[0-9]+$/.test(String(raw.key)))) problems.push(`removed true on the key ${String(raw.key)}`)
    if (raw.id !== `s${String(raw.zoneId)}_${String(raw.key)}_${String(raw.phaseNo)}`) problems.push(`id ${String(raw.id)} does not match the fields`)
  } else problems.push(`type ${String(raw.type)}`)
  return problems
}
