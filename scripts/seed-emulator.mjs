// Seeds the local emulators with an invented 40-player guild (every class and specialization) and three sign-ins. Run by `npm run dev:emulator`
// after the emulators start. Every name and address is made up: this repository is public.
import { initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { doc, serverTimestamp, setDoc, Timestamp } from 'firebase/firestore'
import { classSpecializations } from '../src/shared/game/classes.ts'
import { raidStartDate } from '../src/shared/lib/raidStart.ts'
import { seedRoster } from './seedRoster.ts'

const PROJECT_ID = 'demo-intrepid'
const GUILD = 'guild-local'
const PASSWORD = 'password123'
const USERS = [
  { email: 'leader@example.test', displayName: 'Local Leader', role: 'Guild Leader' },
  { email: 'raider@example.test', displayName: 'Local Raider', role: 'Raid Leader' },
  { email: 'member@example.test', displayName: 'Local Member', role: 'Member' },
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
await env.withSecurityRulesDisabled(async (context) => {
  const db = context.firestore()
  const set = (path, data) => setDoc(doc(db, path), data)
  const g = `guilds/${GUILD}`
  await set(g, { name: 'Local Guild' })
  const uids = {}
  for (const user of USERS) {
    const uid = await createUser(user.email)
    uids[user.role] = uid
    await set(`${g}/members/${uid}`, { email: user.email, displayName: user.displayName, role: user.role, playerId: user.role === 'Member' ? 'player-1' : null })
  }
  for (const [i, player] of seedRoster.entries()) {
    const role = classSpecializations[player.className]?.find((option) => option.name === player.specialization)?.role
    if (!role) throw new Error(`Unknown class or specialization: ${player.className} ${player.specialization}`)
    const id = `player-${i + 1}`
    // player-1 (Aldric) is the main linked to the Member sign-in.
    await set(`${g}/roster/${id}`, { name: player.name, className: player.className, specialization: player.specialization, role, ...(i === 0 ? { linkedUid: uids.Member } : {}) })
    await set(`${g}/teamAssignments/${id}`, { team: player.team })
  }
  await set(`${g}/roster/player-alt`, { name: 'Elowen', className: 'Druid', specialization: 'Restoration', role: 'Healer', mainId: 'player-1' })
  await set(`${g}/teamAssignments/player-alt`, { team: 'red' })
  const date = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)
  const zones = [{ id: 'zone-a', name: 'Test Deeps', size: 10 }, { id: 'zone-b', name: 'Test Summit', size: 20 }, { id: 'zone-c', name: 'Test Lair', size: 40 }]
  for (const { id, ...zone } of zones) await set(`${g}/raidZones/${id}`, zone)
  await set(`${g}/raids/raid-preview`, {
    name: 'Test raid night', date, time: '21:00', size: 40, zones,
    startsAt: Timestamp.fromDate(raidStartDate(date, '21:00')), createdBy: uids['Guild Leader'], createdAt: serverTimestamp(),
  })
  await set(`${g}/raids/raid-legacy`, {
    name: 'Test legacy raid', date, size: 20, createdBy: uids['Guild Leader'], createdAt: serverTimestamp(),
  })})
await env.cleanup()
console.log(`\nSeeded guild "${GUILD}". Sign in with ${USERS.map((u) => `${u.email} (${u.role})`).join(', ')}; password: ${PASSWORD}\n`)
