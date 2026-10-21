import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Timestamp } from 'firebase/firestore'
import {
  buildSnapshotInvitationRows,
  buildSnapshotReportRoster,
  buildSnapshotReports,
  readSnapshotAccount,
  readSnapshotCharacter,
  readSnapshotLineup,
  readSnapshotManifest,
  SnapshotDataError,
  sortSnapshotReports,
} from '../../src/features/raid-history/history.ts'

const scheduledStartAt = Timestamp.fromDate(new Date('2026-10-20T01:00:00.000Z'))
const capturedAt = Timestamp.fromDate(new Date('2026-10-20T01:01:00.000Z'))
const groupKeys = {
  10: ['blue', 'yellow', 'red', 'white'],
  20: ['green', 'pink'],
  40: ['brown'],
} as const

function manifest(raidId = 'raid-a', lineupSizes: (10 | 20 | 40)[] = [10, 20, 40]) {
  return readSnapshotManifest(raidId, {
    schemaVersion: 1,
    status: 'complete',
    raidId,
    raid: { name: 'Test raid night', date: '2026-10-19' },
    scheduledStartAt,
    capturedAt,
    lineupSizes,
    counts: { lineups: lineupSizes.length, characters: 2, accounts: 1 },
  })
}

function lineup(size: 10 | 20 | 40, teamCharacters: Record<string, string[]> = {}, bench: string[] = []) {
  return readSnapshotLineup(size, {
    size,
    teams: groupKeys[size].map((key) => ({ key, name: key[0].toUpperCase() + key.slice(1), characterIds: teamCharacters[key] ?? [] })),
    bench,
  })
}

describe('published raid history helpers', () => {
  it('expands a single snapshot into separate reports for every captured team and size', () => {
    const sizes = [10, 20, 40] as const
    const reports = buildSnapshotReports(
      'guilds/guild-a/raids/raid-a/snapshots/start',
      manifest('raid-a', [...sizes]),
      sizes.map((size) => lineup(size)),
    )
    assert.equal(reports.length, 7)
    assert.deepEqual(reports.map((report) => report.label), [
      '10-19-26 Blue 10M',
      '10-19-26 Yellow 10M',
      '10-19-26 Red 10M',
      '10-19-26 White 10M',
      '10-19-26 Green 20M',
      '10-19-26 Pink 20M',
      '10-19-26 Brown 40M',
    ])
    assert.equal(new Set(reports.map((report) => report.snapshotPath)).size, 1)
    assert.equal(reports[0].scheduledStartAt.toMillis(), scheduledStartAt.toMillis())
    assert.equal(reports[0].capturedAt.toMillis(), capturedAt.toMillis())
  })

  it('sorts reports newest first and deterministically orders sizes and teams within a raid', () => {
    const earlier = buildSnapshotReports('snapshot-a', manifest('raid-a', [10]), [lineup(10)])
    const laterManifest = manifest('raid-b', [10])
    laterManifest.scheduledStartAt = Timestamp.fromMillis(scheduledStartAt.toMillis() + 60_000)
    const later = buildSnapshotReports('snapshot-b', laterManifest, [lineup(10)])
    assert.deepEqual(sortSnapshotReports([...earlier, ...later]).map((report) => report.raidId), [
      'raid-b', 'raid-b', 'raid-b', 'raid-b', 'raid-a', 'raid-a', 'raid-a', 'raid-a',
    ])
    assert.deepEqual(earlier.map((report) => report.teamKey), ['blue', 'yellow', 'red', 'white'])
  })

  it('maps only captured team and bench character records into a read-only report roster', () => {
    const report = buildSnapshotReports('snapshot-a', manifest('raid-a', [10]), [
      lineup(10, { blue: ['char-blue'] }, ['char-bench']),
    ])[0]
    const team = readSnapshotCharacter('char-blue', {
      id: 'char-blue', name: 'Briar', surname: 'Thorn', className: 'Druid', specialization: 'Balance', role: 'Ranged',
      accountUid: 'account-a', placements: [{ size: 10, teamKey: 'blue', teamName: 'Blue', bench: false }],
    })
    const bench = readSnapshotCharacter('char-bench', {
      id: 'char-bench', name: 'Elara', surname: null, className: 'Priest', specialization: 'Holy', role: 'Healer',
      accountUid: null, placements: [{ size: 10, teamKey: null, teamName: null, bench: true }],
    })
    assert.deepEqual(buildSnapshotReportRoster(report, new Map([[team.id, team], [bench.id, bench]])), {
      team: [team],
      bench: [bench],
    })
    assert.throws(() => buildSnapshotReportRoster(report, new Map([[team.id, team]])), SnapshotDataError)
  })

  it('preserves invitation identity and signup response independently', () => {
    const account = readSnapshotAccount('account-a', {
      uid: 'account-a', displayName: 'Aster Vale', invited: true, invitationOrder: 0,
      invitationMainId: 'char-main', signup: { characterId: 'char-alt', status: 'bench', benchKind: 'self' },
    })
    const main = readSnapshotCharacter('char-main', {
      id: 'char-main', name: 'Aster', surname: 'Vale', className: 'Warrior', specialization: 'Arms', role: 'Melee',
      accountUid: 'account-a', placements: [],
    })
    const alt = readSnapshotCharacter('char-alt', {
      id: 'char-alt', name: 'Lark', surname: null, className: 'Druid', specialization: 'Restoration', role: 'Healer',
      accountUid: 'account-a', placements: [],
    })
    const [row] = buildSnapshotInvitationRows([account], new Map([[main.id, main], [alt.id, alt]]))
    assert.equal(row.account.displayName, 'Aster Vale')
    assert.equal(row.invitationCharacter?.id, 'char-main')
    assert.equal(row.signupCharacter?.id, 'char-alt')
    assert.equal(row.account.signup?.status, 'bench')
    assert.equal(row.account.signup?.benchKind, 'self')
  })

  it('rejects incomplete manifests, lineups, characters, and account records', () => {
    assert.throws(() => readSnapshotManifest('raid-a', { ...manifestRaw(), capturedAt: undefined }), SnapshotDataError)
    assert.throws(() => readSnapshotLineup(10, { ...lineupRaw(10), teams: [] }), SnapshotDataError)
    assert.throws(() => readSnapshotCharacter('char-a', { id: 'char-a', placements: [] }), SnapshotDataError)
    assert.throws(() => readSnapshotAccount('account-a', { uid: 'account-a', invited: true }), SnapshotDataError)
  })
})

function manifestRaw() {
  return {
    schemaVersion: 1,
    status: 'complete',
    raidId: 'raid-a',
    raid: { name: 'Test raid night', date: '2026-10-19' },
    scheduledStartAt,
    capturedAt,
    lineupSizes: [10],
    counts: { lineups: 1, characters: 0, accounts: 0 },
  }
}

function lineupRaw(size: 10 | 20 | 40) {
  return {
    size,
    teams: groupKeys[size].map((key) => ({ key, name: key, characterIds: [] })),
    bench: [],
  }
}
