// Downloads the DoodleNet model (Quick, Draw! doodle recogniser, MIT, from ml5-data-and-models)
// into public/models/doodlenet so the tablet can recognise drawings offline, without the CDN.
// Usage: npm run fetch-model
import { mkdir, writeFile } from 'node:fs/promises';

const BASE = 'https://cdn.jsdelivr.net/gh/ml5js/ml5-data-and-models@master/models/doodlenet/';
const OUT = new URL('../public/models/doodlenet/', import.meta.url);

await mkdir(OUT, { recursive: true });
const res = await fetch(BASE + 'model.json');
if (!res.ok) throw new Error('model.json: HTTP ' + res.status);
const model = await res.json();
await writeFile(new URL('model.json', OUT), JSON.stringify(model));
for (const group of model.weightsManifest) for (const path of group.paths) {
  const r = await fetch(BASE + path);
  if (!r.ok) throw new Error(path + ': HTTP ' + r.status);
  await writeFile(new URL(path, OUT), Buffer.from(await r.arrayBuffer()));
  console.log('saved', path);
}
console.log('DoodleNet saved to public/models/doodlenet');
