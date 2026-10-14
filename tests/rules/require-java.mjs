// Run by `npm run test:rules` before the Firestore emulator starts. The emulator is a Java program, and
// without a JDK firebase-tools fails with a stack trace, so say what is missing and how to fix it instead.
// Plain JavaScript and no dependencies: it has to work before anything else is set up.
import { spawnSync } from 'node:child_process'

const REQUIRED_MAJOR = 21

const result = spawnSync('java', ['-version'], { encoding: 'utf8' })
const banner = `${result.stdout ?? ''}${result.stderr ?? ''}` // `java -version` prints to stderr
// "21.0.12" and "21-ea" give 21; the old "1.8.0_402" scheme gives 8.
const major = Number(/version "(?:1\.)?(\d+)/.exec(banner)?.[1])

if (result.error || result.status !== 0 || !Number.isInteger(major)) {
  fail('The Firestore emulator needs a JDK, and `java` was not found on your PATH.')
}
if (major < REQUIRED_MAJOR) {
  fail(`The Firestore emulator needs JDK ${REQUIRED_MAJOR} or newer, but \`java\` on your PATH is version ${major}.`)
}

function fail(problem) {
  console.error(`
${problem}

Install JDK ${REQUIRED_MAJOR} (Temurin from https://adoptium.net is fine), make sure \`java -version\` works
in this terminal, then run \`npm run test:rules\` again.

  macOS with Homebrew:  brew install openjdk@${REQUIRED_MAJOR}
                        It is keg-only, so also add it to your PATH, for example:
                        export PATH="$(brew --prefix openjdk@${REQUIRED_MAJOR})/bin:$PATH"
  Debian or Ubuntu:     sudo apt install openjdk-${REQUIRED_MAJOR}-jdk
  Windows:              run the Temurin ${REQUIRED_MAJOR} installer from https://adoptium.net, then open a new terminal.
`)
  process.exit(1)
}
