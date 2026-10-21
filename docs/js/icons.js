/*
 * A hand-picked set of Material Symbols (Google, Apache 2.0), bundled in
 * docs/icons.json by scripts/icons.mjs and loaded the first time icon mode opens.
 */
/** order of the path variants in IconEntry.d: each style unfilled, then filled */
const STYLES = ['outlined', 'rounded', 'sharp'];
let icons = null;
export function loadIcons() {
    icons ?? (icons = fetch('icons.json').then(async (r) => {
        if (!r.ok)
            throw new Error(`${r.status} for icons.json`);
        return (await r.json()).icons;
    }));
    icons.catch(() => (icons = null));
    return icons;
}
export function iconPath(e, style, fill) {
    return e.d[STYLES.indexOf(style) * 2 + (fill ? 1 : 0)];
}
/** Icons matching every word of the query; matches on the name come first. */
export function search(list, query) {
    const q = query.toLowerCase().trim().split(/[\s_-]+/).filter(Boolean);
    if (!q.length)
        return list;
    const byName = [], byTag = [];
    for (const e of list) {
        const name = e.name.split('_'), tags = e.tags.split(' ');
        if (q.every(w => name.some(x => x.startsWith(w))))
            byName.push(e);
        else if (q.every(w => name.some(x => x.startsWith(w)) || tags.some(x => x.startsWith(w))))
            byTag.push(e);
    }
    return [...byName, ...byTag];
}
