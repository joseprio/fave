// Builds docs/icons.json, the Material Symbols bundled with the icon picker:
// the icons named in scripts/icon-list.txt, with search tags from Google's
// metadata and path data for every style, outlined and filled, at weight 400.
//
//   node scripts/icons.mjs [version]   (defaults to the latest @material-symbols/svg-400)
import { readFileSync, writeFileSync } from 'node:fs';

const STYLES = ['outlined', 'rounded', 'sharp'];

const version = process.argv[2] ??
  (await (await fetch('https://data.jsdelivr.com/v1/packages/npm/@material-symbols/svg-400/resolved')).json()).version;
const names = readFileSync(new URL('icon-list.txt', import.meta.url), 'utf8')
  .split('\n').filter(l => !l.startsWith('#')).join(' ').split(/\s+/).filter(Boolean);

const meta = JSON.parse((await (await fetch('https://fonts.google.com/metadata/icons?incomplete=1&key=material_symbols')).text()).replace(/^\)\]\}'/, ''));
const byName = new Map(meta.icons.map(i => [i.name, i]));
// tags shared by most icons ("symbol", "data") only add noise to search;
// broad ones like "food" or "travel" are what people type, so they stay
const STOP = new Set(['ui', 'icon', 'app', 'on', 'off', 'type']);
const freq = {};
for (const i of meta.icons) for (const t of new Set(i.tags.map(t => t.toLowerCase()))) freq[t] = (freq[t] ?? 0) + 1;

async function path(name, style, fill) {
  const url = `https://cdn.jsdelivr.net/npm/@material-symbols/svg-400@${version}/${style}/${name}${fill ? '-fill' : ''}.svg`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return [...(await r.text()).matchAll(/\sd="([^"]+)"/g)].map(m => m[1]).join('');
}

async function icon(name) {
  const info = byName.get(name);
  if (!info) throw new Error(`unknown icon ${name}`);
  const words = name.split('_');
  const tags = [...new Set(info.tags.map(t => t.toLowerCase()))].filter(t => /^[a-z]+$/.test(t) && freq[t] <= 400 && !STOP.has(t) && !words.includes(t));
  // order matches IconStyle x fill in src/icons.ts
  const d = await Promise.all(STYLES.flatMap(s => [path(name, s, false), path(name, s, true)]));
  return { name, tags: tags.join(' '), d };
}

const icons = [];
for (let i = 0; i < names.length; i += 16) icons.push(...await Promise.all(names.slice(i, i + 16).map(icon)));
writeFileSync(new URL('../docs/icons.json', import.meta.url), JSON.stringify({ version, icons }));
console.log(`${icons.length} icons from @material-symbols/svg-400@${version}`);
