// Recovery test driver: runs apply and dies (SIGKILL, no cleanup) at a named
// checkpoint (on Windows the process ends with no signal name; tests read the
// checkpoint log instead). Usage: node apply-driver.mjs <home> <planId> <killAt> <log>
import { appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const { apply } = await import(pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), '../../scripts/bridge-engine.mjs')).href);
const [home, planId, killAt, log] = process.argv.slice(2);
try {
  const result = apply({ home, planId, checkpoint: name => { appendFileSync(log, name + '\n'); if (name === killAt) process.kill(process.pid, 'SIGKILL'); } });
  console.log(JSON.stringify(result));
} catch (error) { console.error(error.message); process.exitCode = 1; }
