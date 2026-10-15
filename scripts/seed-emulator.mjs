// Seeds the local emulators with a small invented guild and three sign-ins. Run by `npm run dev:emulator`
// after the emulators start. Every name and address is made up: this repository is public.
import { initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { doc, setDoc } from 'firebase/firestore'

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
  const roster = [
    ['Aldric', 'Warrior', 'Protection', 'Tank'],
    ['Brienne', 'Priest', 'Holy', 'Healer'],
    ['Cormac', 'Mage', 'Fire', 'Ranged'],
    ['Delia', 'Rogue', 'Combat', 'Melee'],
  ]
  for (const [i, [name, className, specialization, role]] of roster.entries()) await set(`${g}/roster/player-${i + 1}`, { name, className, specialization, role })
  await set(`${g}/teamAssignments/player-1`, { team: 'blue' })
  await set(`${g}/teamAssignments/player-2`, { team: 'blue' })
})
await env.cleanup()
console.log(`\nSeeded guild "${GUILD}". Sign in with ${USERS.map((u) => `${u.email} (${u.role})`).join(', ')}; password: ${PASSWORD}\n`)
