// Copies the published plant catalog from openlandscape3d-www into src/lib/catalog/.
//
//   node scripts/build-catalog.mjs [path/to/openlandscape3d-www/catalog/data]
//
// plants.json is required; regions.json, materials.json and schedule-rules.json are copied when
// present (otherwise the current files are kept). Files are validated lightly so a broken
// catalog never replaces a working one.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = resolve(process.argv[2] ?? resolve(root, '../openlandscape3d-www/catalog/data'));
const out = resolve(root, 'src/lib/catalog');

if (!existsSync(resolve(src, 'plants.json'))) {
  console.error(`catalog: ${src}/plants.json not found — keeping the bundled catalog (${JSON.parse(readFileSync(resolve(out, 'plants.json'), 'utf8')).plants.length} plants).`);
  process.exit(1);
}

const files = { 'plants.json': ['plants'], 'regions.json': ['regions'], 'materials.json': ['materials'], 'schedule-rules.json': ['rules'] };
const report = [];
for (const [file, [key]] of Object.entries(files)) {
  const from = resolve(src, file);
  if (!existsSync(from)) { report.push(`${file}: not published yet, kept current`); continue; }
  const data = JSON.parse(readFileSync(from, 'utf8'));
  if (!Array.isArray(data[key]) || !data[key].length) throw new Error(`${file}: expected a non-empty "${key}" array`);
  if (file === 'plants.json') {
    const ids = new Set();
    for (const p of data.plants) {
      for (const f of ['id', 'scientificName', 'genus', 'form', 'leaf', 'mature', 'growthRate', 'sun', 'moisture', 'hardiness', 'spacingM'])
        if (p[f] == null) throw new Error(`plants.json: ${p.id ?? '?'} is missing ${f}`);
      if (ids.has(p.id)) throw new Error(`plants.json: duplicate id ${p.id}`);
      ids.add(p.id);
    }
  }
  writeFileSync(resolve(out, file), JSON.stringify(data) + '\n');
  report.push(`${file}: ${data[key].length} ${key}`);
}
console.log(`catalog from ${src}\n  ${report.join('\n  ')}`);
