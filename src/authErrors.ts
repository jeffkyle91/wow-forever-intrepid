// Friendly text for Firebase Auth errors, so the screen never shows the raw "Firebase: Error (auth/...)." message.

export function authErrorCode(cause: unknown): string {
  return typeof cause === 'object' && cause !== null && 'code' in cause && typeof cause.code === 'string' ? cause.code : ''
}

export function authErrorMessage(cause: unknown, fallback: string): string {
  const code = authErrorCode(cause)
  switch (code) {
    // With email-enumeration protection (the default for projects created after 2023-09-15) a wrong password and an unknown address both arrive as invalid-credential. The older codes are folded into the same text so the answer never tells the two apart.
    case 'auth/invalid-credential':
    case 'auth/invalid-login-credentials':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'That email and password do not match. Check them and try again, or use "Forgot password?".'
    case 'auth/email-already-in-use':
      return 'An account already exists for that email. Sign in instead.'
    case 'auth/invalid-email':
      return 'Enter a valid email address.'
    case 'auth/too-many-requests':
      return 'Too many attempts. Wait a few minutes and try again.'
    case 'auth/network-request-failed':
      return 'Could not reach the sign-in service. Check your connection and try again.'
    default:
      // The code only, never the email: it is what a bug report needs.
      console.warn('Unhandled auth error:', code || 'no code')
      return fallback
  }
}
