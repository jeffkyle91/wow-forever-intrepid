// Seeds the local emulators with an invented 40-player guild (every class and specialization) and three sign-ins. Run by `npm run dev:emulator`
// after the emulators start. Every name and address is made up: this repository is public.
import { initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { doc, setDoc } from 'firebase/firestore'
import { classSpecializations } from '../src/shared/game/classes.ts'
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
  for (const user of USERS) {
    const uid = await createUser(user.email)
    await set(`${g}/members/${uid}`, { email: user.email, displayName: user.displayName, role: user.role, playerId: null })
  }
  for (const [i, player] of seedRoster.entries()) {
    const role = classSpecializations[player.className]?.find((option) => option.name === player.specialization)?.role
    if (!role) throw new Error(`Unknown class or specialization: ${player.className} ${player.specialization}`)
    const id = `player-${i + 1}`
    await set(`${g}/roster/${id}`, { name: player.name, className: player.className, specialization: player.specialization, role })
    await set(`${g}/teamAssignments/${id}`, { team: player.team })
  }
})
await env.cleanup()
console.log(`\nSeeded guild "${GUILD}". Sign in with ${USERS.map((u) => `${u.email} (${u.role})`).join(', ')}; password: ${PASSWORD}\n`)
