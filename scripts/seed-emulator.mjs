// Seeds the local emulators with an invented guild and scheduled-raid review scenarios. Run by `npm run dev:emulator`
// after the emulators start. Every name and address is made up: this repository is public.
import { initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { doc, serverTimestamp, setDoc, Timestamp } from 'firebase/firestore'
import { classSpecializations } from '../src/shared/game/classes.ts'
import { raidStartDate } from '../src/shared/lib/raidStart.ts'
import { seedRoster } from './seedRoster.ts'
import { createRequire } from 'node:module'
import { initializePlanning } from '../functions/raidPlanning.js'

if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:18080' || process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:19099') {
  throw new Error('Seeding requires the local review emulators. Run npm run dev:emulator; never point this script at a cloud project.')
}

const PROJECT_ID = 'demo-intrepid'
const GUILD = 'guild-local'
const PASSWORD = 'password123'
const USERS = [
  { email: 'leader@example.test', displayName: 'Local Leader', role: 'Guild Leader', playerId: 'player-2' },
  { email: 'raider@example.test', displayName: 'Local Raider', role: 'Raid Leader', playerId: 'player-3' },
  { email: 'member@example.test', displayName: 'Local Member', role: 'Member', playerId: 'player-1' },
  { email: 'reserve@example.test', displayName: 'Local Reserve', role: 'Member', playerId: 'player-reserve' },
]

async function createUser(email) {
  const response = await fetch('http://127.0.0.1:19099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD, returnSecureToken: false }),
  })
  const body = await response.json()
  if (!body.localId) throw new Error(`Could not create ${email}: ${JSON.stringify(body)}`)
  return body.localId
}

const env = await initializeTestEnvironment({ projectId: PROJECT_ID, firestore: { host: '127.0.0.1', port: 18080 } })
const accountByCharacter = new Map()
let leaderUid
await env.withSecurityRulesDisabled(async (context) => {
  const db = context.firestore()
  const set = (path, data) => setDoc(doc(db, path), data)
  const g = `guilds/${GUILD}`
  await set(g, { name: 'Local Guild' })
  const uids = {}
  for (const user of USERS) {
    const uid = await createUser(user.email)
    if (user.role === 'Guild Leader') leaderUid = uid
    uids[user.email] = uid
    accountByCharacter.set(user.playerId, uid)
    await set(`${g}/members/${uid}`, { email: user.email, displayName: user.displayName, role: user.role, playerId: user.playerId })
  }
  for (const [i, player] of seedRoster.entries()) {
    const role = classSpecializations[player.className]?.find((option) => option.name === player.specialization)?.role
    if (!role) throw new Error(`Unknown class or specialization: ${player.className} ${player.specialization}`)
    const id = `player-${i + 1}`
    const uid = accountByCharacter.get(id) ?? `local-account-${i + 1}`
    accountByCharacter.set(id, uid)
    if (!USERS.some((user) => user.playerId === id)) await set(`${g}/members/${uid}`, { email: `raider${i + 1}@example.test`, displayName: player.name, role: 'Member', playerId: id })
    await set(`${g}/roster/${id}`, { name: player.name, className: player.className, specialization: player.specialization, role, linkedUid: uid })
    await set(`${g}/characterReadiness/${id}`, { ready: ![4, 5].includes(i + 1), updatedBy: leaderUid, updatedAt: serverTimestamp() })
    await set(`${g}/teamAssignments/${id}`, { team: player.team })
  }
  await set(`${g}/roster/player-alt`, { name: 'Elowen', className: 'Druid', specialization: 'Restoration', role: 'Healer', mainId: 'player-1' })
  await set(`${g}/characterReadiness/player-alt`, { ready: true, updatedBy: leaderUid, updatedAt: serverTimestamp() })
  await set(`${g}/roster/player-5-alt`, { name: 'Thistle', className: 'Priest', specialization: 'Holy', role: 'Healer', mainId: 'player-5' })
  await set(`${g}/characterReadiness/player-5-alt`, { ready: true, updatedBy: leaderUid, updatedAt: serverTimestamp() })
  await set(`${g}/roster/player-reserve`, { name: 'Briar', className: 'Paladin', specialization: 'Holy', role: 'Healer', linkedUid: accountByCharacter.get('player-reserve') })
  await set(`${g}/characterReadiness/player-reserve`, { ready: true, updatedBy: leaderUid, updatedAt: serverTimestamp() })
  await set(`${g}/roster/player-not-ready`, { name: 'Moss', className: 'Rogue', specialization: 'Combat', role: 'Melee' })
  const date = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)
  const zones = [{ id: 'zone-a', name: 'Test Deeps', size: 10 }, { id: 'zone-b', name: 'Test Summit', size: 20 }, { id: 'zone-c', name: 'Test Lair', size: 40 }]
  for (const { id, ...zone } of zones) await set(`${g}/raidZones/${id}`, zone)
  await set(`${g}/raids/raid-preview`, {
    name: 'Test raid night', date, time: '21:00', size: 40, zones,
    startsAt: Timestamp.fromDate(raidStartDate(date, '21:00')), createdBy: leaderUid, createdAt: serverTimestamp(),
  })
  await set(`${g}/raids/raid-preview/signups/${uids['leader@example.test']}`, { characterId: 'player-2', status: 'accept', updatedAt: serverTimestamp() })
  await set(`${g}/raids/raid-preview/signups/${uids['raider@example.test']}`, { characterId: 'player-3', status: 'tentative', updatedAt: serverTimestamp() })
  await set(`${g}/raids/raid-legacy`, {
    name: 'Test legacy raid', date, size: 20, createdBy: leaderUid, createdAt: serverTimestamp(),
  })
  for (const [raidId, fields] of [['raid-cancelled', { status: 'cancelled', cancelReason: 'Local cancellation example' }], ['raid-started', { startsAt: Timestamp.fromMillis(Date.now() - 3_600_000) }]]) {
    await set(`${g}/raids/${raidId}`, { name: raidId === 'raid-cancelled' ? 'Cancelled review raid' : 'Started review raid', date, time: '21:00', size: 10, zones: [zones[0]], startsAt: Timestamp.fromDate(raidStartDate(date, '21:00')), createdBy: leaderUid, createdAt: serverTimestamp(), ...fields })
  }
})
await env.cleanup()
const require = createRequire(new URL('../functions/package.json', import.meta.url))
const { initializeApp, deleteApp } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')
const app = initializeApp({ projectId: PROJECT_ID }, 'local-planning-seed')
try {
  await initializePlanning(getFirestore(app), { auth: { uid: leaderUid }, data: { guildId: GUILD, raidId: 'raid-preview' } })
} finally { await deleteApp(app) }
console.log(`\nSeeded guild "${GUILD}". Sign in with ${USERS.map((u) => `${u.email} (${u.role})`).join(', ')}; password: ${PASSWORD}\n`)
