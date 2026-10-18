// The module the table fuzz tests run against: src/shared/game/guildTables.ts, or (to prove the fuzz can fail) a changed copy of it named by the
// environment variable GUILD_TABLES_MODULE.
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type * as Tables from '../../../src/shared/game/guildTables.ts'

const override = process.env.GUILD_TABLES_MODULE
export const tables = (await import(override ? pathToFileURL(resolve(override)).href : '../../../src/shared/game/guildTables.ts')) as typeof Tables
