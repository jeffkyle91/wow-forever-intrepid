// Deploys main to Firebase: checks, then Firestore rules (only if they changed), then hosting.
// Run it only when a deploy was asked for: npm run release [-- --dry-run] [-- --skip-tests]
import { spawnSync } from 'node:child_process'

const PROJECT = 'intrepid-wow-forever'
const TAG = 'last-deploy'
const args = new Set(process.argv.slice(2))
const dryRun = args.has('--dry-run')

function run(command, { quiet = false } = {}) {
  const result = spawnSync(command, { shell: true, encoding: 'utf8', stdio: quiet ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'inherit', 'inherit'] })
  return { ok: result.status === 0, out: (result.stdout ?? '').trim() }
}

function step(command) {
  console.log(`\n> ${command}`)
  if (!run(command).ok) {
    console.error(`\nStopped: "${command}" failed. Nothing after it was run.`)
    process.exit(1)
  }
}

function fail(message) {
  console.error(`\nStopped: ${message}`)
  process.exit(1)
}

if (run('git branch --show-current', { quiet: true }).out !== 'main') fail('switch to main first (git checkout main).')
if (run('git status --porcelain', { quiet: true }).out) fail('the working tree has uncommitted changes.')
step('git pull --ff-only')
step('git fetch origin --tags --force')
if (run('git rev-parse HEAD', { quiet: true }).out !== run('git rev-parse origin/main', { quiet: true }).out) fail('local main does not match origin/main.')

const hasTag = run(`git rev-parse -q --verify refs/tags/${TAG}`, { quiet: true }).ok
const rulesChanged = !hasTag || !run(`git diff --quiet ${TAG} HEAD -- firestore.rules`, { quiet: true }).ok
const head = run('git rev-parse --short HEAD', { quiet: true }).out
console.log(`\nDeploying ${head} to ${PROJECT}. Rules: ${rulesChanged ? 'changed, will deploy first' : 'unchanged, skipped'}. Hosting: yes.`)
if (dryRun) {
  console.log('Dry run: nothing was built or deployed.')
  process.exit(0)
}

step('npm run build')
step('npm run lint')
if (!args.has('--skip-tests')) step('npm run test:rules')
if (rulesChanged) step(`npx --yes firebase-tools@latest deploy --only firestore:rules --project ${PROJECT} --non-interactive`)
step(`npx --yes firebase-tools@latest deploy --only hosting --project ${PROJECT} --non-interactive`)
step(`git tag -f ${TAG}`)
step(`git push origin -f refs/tags/${TAG}`)
console.log(`\nDone. ${head} is live at https://${PROJECT}.web.app`)
