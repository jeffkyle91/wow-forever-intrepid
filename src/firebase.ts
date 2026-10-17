import { getApp, getApps, initializeApp } from 'firebase/app'
import { connectAuthEmulator, getAuth } from 'firebase/auth'
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore'
import { connectFunctionsEmulator, getFunctions } from 'firebase/functions'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

export const guildId = import.meta.env.VITE_GUILD_ID?.trim() ?? ''
export const firebaseConfigured = Object.values(firebaseConfig).every((value) => Boolean(value?.trim())) && Boolean(guildId)

const app = firebaseConfigured
  ? getApps().length ? getApp() : initializeApp(firebaseConfig)
  : null

export const auth = app ? getAuth(app) : null
export const db = app ? getFirestore(app) : null
export const functions = app ? getFunctions(app, 'us-central1') : null

// `npm run dev:emulator` (vite --mode emulator) points the app at the local emulators instead of the live project.
if (import.meta.env.DEV && import.meta.env.VITE_USE_EMULATORS === 'true' && auth && db && !(auth as { emulatorConfig?: unknown }).emulatorConfig) {
  connectAuthEmulator(auth, 'http://127.0.0.1:19099', { disableWarnings: true })
  connectFirestoreEmulator(db, '127.0.0.1', 18080)
  if (functions) connectFunctionsEmulator(functions, '127.0.0.1', 15001)
}
