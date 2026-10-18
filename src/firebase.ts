import { getApp, getApps, initializeApp } from 'firebase/app'
import { connectAuthEmulator, getAuth } from 'firebase/auth'
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore'
import { connectFunctionsEmulator, getFunctions } from 'firebase/functions'
import { connectStorageEmulator, getStorage } from 'firebase/storage'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

// Cloud Storage holds the zone artwork. The bucket is VITE_FIREBASE_STORAGE_BUCKET when it is set; otherwise it is the one a new Firebase project gets, <project>.firebasestorage.app
// (a project made before late 2024 has <project>.appspot.com and needs the variable). Storage has to be turned on once in the console; until then an upload fails with a message.
export const storageBucket = import.meta.env.VITE_FIREBASE_STORAGE_BUCKET?.trim() || (firebaseConfig.projectId?.trim() ? `${firebaseConfig.projectId.trim()}.firebasestorage.app` : '')

export const guildId = import.meta.env.VITE_GUILD_ID?.trim() ?? ''
export const firebaseConfigured = Object.values(firebaseConfig).every((value) => Boolean(value?.trim())) && Boolean(guildId)

const app = firebaseConfigured
  ? getApps().length ? getApp() : initializeApp(firebaseConfig)
  : null

export const auth = app ? getAuth(app) : null
export const db = app ? getFirestore(app) : null
export const functions = app ? getFunctions(app, 'us-central1') : null
export const storage = app && storageBucket ? getStorage(app, `gs://${storageBucket}`) : null

// `npm run dev:emulator` (vite --mode emulator) points the app at the local emulators instead of the live project.
if (import.meta.env.DEV && import.meta.env.VITE_USE_EMULATORS === 'true' && auth && db && !(auth as { emulatorConfig?: unknown }).emulatorConfig) {
  connectAuthEmulator(auth, 'http://127.0.0.1:19099', { disableWarnings: true })
  connectFirestoreEmulator(db, '127.0.0.1', 18080)
  if (functions) connectFunctionsEmulator(functions, '127.0.0.1', 15001)
  if (storage) connectStorageEmulator(storage, '127.0.0.1', 19199)
}
