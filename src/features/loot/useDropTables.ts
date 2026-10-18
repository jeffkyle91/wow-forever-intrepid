import { useMemo } from 'react'
import { dropTablesOf, mergeTables, type LootTableDoc } from '../../shared/game/guildTables'
import { bossOrderOf } from './bossOrder'
import { dropTables as builtIn } from '../../shared/lib/dropTables'

// The drop lists as they stand in one phase: the built-in captures with the guild's own documents of the phase and of the phases it follows applied
// (shared/game/guildTables.ts). `lootTables` is `data.lootTables` from useGuildData; the lists are rebuilt only when it or the phase changes. With
// `everything` the documents of every phase up to this one count (the Log names zones and creatures from any phase).
export const useMergedTables = (lootTables: LootTableDoc[], phaseNo: number, everything = false) => useMemo(() => mergeTables(builtIn, lootTables, phaseNo, everything), [lootTables, phaseNo, everything])
export const useDropTables = (lootTables: LootTableDoc[], phaseNo: number) => useMemo(() => dropTablesOf(builtIn, lootTables, phaseNo), [lootTables, phaseNo])
export const useBossOrder = (lootTables: LootTableDoc[], phaseNo: number) => {
  const tables = useDropTables(lootTables, phaseNo)
  return useMemo(() => bossOrderOf(tables), [tables])
}
