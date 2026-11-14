// Writes the golden snapshots: GOLDEN_WRITE=1 node test/golden/write.mjs (from the plugin folder).
// Empties each snapshot module, runs the tests, turns their GOLDEN lines into the modules and runs
// the tests again. Only on unchanged production code: a snapshot written over a change locks it.
import { execFileSync, spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

if (process.env.GOLDEN_WRITE !== '1') {
  console.error('Refusing to write snapshots without GOLDEN_WRITE=1.')
  process.exit(1)
}
const GROUPS = ['config', 'log', 'notes', 'prompts', 'stats']
const dir = new URL('./', import.meta.url)
const save = (group, data) =>
  writeFileSync(new URL(`${group}.ts`, dir), `// Golden snapshot, written by write.mjs. Do not edit by hand.\nexport default ${JSON.stringify(data, null, 2)} as Record<string, unknown>\n`)

for (const g of GROUPS) save(g, {})
const run = spawnSync('claude', ['plugin', 'test', '.'], { encoding: 'utf8', maxBuffer: 1 << 30 })
const found = Object.fromEntries(GROUPS.map(g => [g, {}]))
for (const line of `${run.stdout}\n${run.stderr}`.split('\n')) {
  const m = /^GOLDEN\t([^/]+)\/([^\t]+)\t(.*)$/.exec(line)
  if (!m) continue
  if (!(m[1] in found)) throw new Error(`unknown group ${m[1]}`)
  if (m[2] in found[m[1]]) throw new Error(`duplicate key ${m[1]}/${m[2]}`)
  found[m[1]][m[2]] = JSON.parse(m[3])
}
for (const g of GROUPS) save(g, found[g])
console.log(GROUPS.map(g => `${g}: ${Object.keys(found[g]).length}`).join(', '))
execFileSync('claude', ['plugin', 'test', '.'], { stdio: 'inherit' })
