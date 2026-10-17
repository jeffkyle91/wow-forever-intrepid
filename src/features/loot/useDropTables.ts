import { useMemo } from 'react'
import { dropTablesOf, mergeTables, type LootTableDoc } from '../../shared/game/guildTables'
import { bossOrderOf } from './bossOrder'
import { dropTables as builtIn } from './dropTables'

// The drop lists as they stand in one phase: the built-in captures with the guild's own documents of that phase and earlier applied
// (shared/game/guildTables.ts). `lootTables` is `data.lootTables` from useGuildData; the lists are rebuilt only when it or the phase changes.
export const useMergedTables = (lootTables: LootTableDoc[], phaseNo: number) => useMemo(() => mergeTables(builtIn, lootTables, phaseNo), [lootTables, phaseNo])
export const useDropTables = (lootTables: LootTableDoc[], phaseNo: number) => useMemo(() => dropTablesOf(builtIn, lootTables, phaseNo), [lootTables, phaseNo])
export const useBossOrder = (lootTables: LootTableDoc[], phaseNo: number) => {
  const tables = useDropTables(lootTables, phaseNo)
  return useMemo(() => bossOrderOf(tables), [tables])
}
