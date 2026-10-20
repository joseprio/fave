import { render, STYLES } from './engine.js';
import { STROKE, PIXEL } from './fonts.js';
import { rasterize, canvasToPng, buildIco, svgDataUrl } from './raster.js';
const DEFAULTS = {
    text: 'F',
    style: 'round',
    weight: 1.8,
    letterSpacing: 1.4,
    lineGap: 1.6,
    align: 'center',
    slant: 0,
    stretch: false,
    pad: 6,
    outline: 0.9,
    pixelGrid: '16',
    shape: 'rounded',
    radius: 8,
    bg: '#5b3fd9',
    gradient: false,
    bg2: '#d93f8e',
    gradAngle: 135,
    fg: '#ffffff',
    fgGradient: false,
    fg2: '#ffd36e',
    fgAngle: 180,
    shadow: 'none',
    shColor: '#000000',
    shOpacity: 0.35,
    shX: 1,
    shY: 1.5,
    shBlur: 0.8,
    shLength: 24,
};
const $ = (sel, root = document) => root.querySelector(sel);
let state = { ...DEFAULTS, ...readHash() };
function readHash() {
    try {
        return location.hash.length > 1 ? JSON.parse(decodeURIComponent(location.hash.slice(1))) : {};
    }
    catch {
        return {};
    }
}
function writeHash() {
    const diff = {};
    for (const k of Object.keys(DEFAULTS))
        if (state[k] !== DEFAULTS[k])
            diff[k] = state[k];
    const h = Object.keys(diff).length ? '#' + encodeURIComponent(JSON.stringify(diff)) : location.pathname + location.search;
    history.replaceState(null, '', h);
}
// ---------------------------------------------------------------- controls
/** Show a control only when its predicate holds for the current state. */
const visibility = [];
function bindAll() {
    document.querySelectorAll('[data-show]').forEach(el => {
        const expr = el.dataset.show;
        // tiny expression language: "key=value|value" or "key!=value"
        const m = /^(\w+)(!?=)(.+)$/.exec(expr);
        const [, key, op, vals] = m;
        const set = vals.split('|');
        visibility.push([el, s => (op === '=') === set.includes(String(s[key]))]);
    });
    document.querySelectorAll('[data-key]').forEach(el => {
        const key = el.dataset.key;
        const isNum = el instanceof HTMLInputElement && el.type === 'range';
        const isBool = el instanceof HTMLInputElement && el.type === 'checkbox';
        el.addEventListener('input', () => {
            let v = isBool ? el.checked : isNum ? parseFloat(el.value) : el.value;
            if (el instanceof HTMLInputElement && el.type === 'text') {
                // hex colour field: ignore partial input, expand #abc to #aabbcc for the colour picker
                const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(el.value.trim());
                if (!m)
                    return;
                v = '#' + (m[1].length === 3 ? [...m[1]].map(c => c + c).join('') : m[1]).toLowerCase();
            }
            state[key] = v;
            update();
        });
    });
    document.querySelectorAll('[data-seg]').forEach(group => {
        const key = group.dataset.seg;
        group.addEventListener('click', e => {
            const b = e.target.closest('button[data-value]');
            if (!b)
                return;
            state[key] = b.dataset.value;
            update();
        });
    });
    $('#shuffle').addEventListener('click', () => {
        const h = Math.floor(Math.random() * 360);
        state.bg = hslHex(h, 0.65, 0.5);
        state.bg2 = hslHex((h + 40 + Math.random() * 60) % 360, 0.7, 0.55);
        state.fg = Math.random() < 0.8 ? '#ffffff' : hslHex((h + 180) % 360, 0.9, 0.85);
        state.fg2 = hslHex((h + 160 + Math.random() * 60) % 360, 0.9, 0.75);
        update();
    });
    $('#reset').addEventListener('click', () => { state = { ...DEFAULTS }; update(); });
    $('#copy-svg').addEventListener('click', e => copy(lastSvg, e.currentTarget));
    $('#copy-dataurl').addEventListener('click', e => copy(svgDataUrl(lastSvg), e.currentTarget));
    $('#copy-html').addEventListener('click', e => copy($('#html-snippet').textContent, e.currentTarget));
    $('#preview-bg').addEventListener('click', e => {
        const b = e.target.closest('button[data-bg]');
        if (!b)
            return;
        $('#sizes').dataset.bg = b.dataset.bg;
        $('#preview-bg').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    });
    $('#dl-svg').addEventListener('click', () => download(new Blob([lastSvg], { type: 'image/svg+xml' }), 'icon.svg'));
    $('#dl-ico').addEventListener('click', async () => download(await buildIco(lastSvg, [16, 32, 48]), 'favicon.ico'));
    $('#dl-apple').addEventListener('click', async () => download(await png(appleSvg(), 180), 'apple-touch-icon.png'));
    $('#dl-192').addEventListener('click', async () => download(await png(lastSvg, 192), 'icon-192.png'));
    $('#dl-512').addEventListener('click', async () => download(await png(lastSvg, 512), 'icon-512.png'));
    $('#dl-manifest').addEventListener('click', () => download(new Blob([manifest()], { type: 'application/manifest+json' }), 'manifest.webmanifest'));
}
function syncControls() {
    document.querySelectorAll('[data-key]').forEach(el => {
        const v = state[el.dataset.key];
        if (el instanceof HTMLInputElement && el.type === 'checkbox')
            el.checked = Boolean(v);
        else if (el !== document.activeElement)
            el.value = String(v);
        const out = el.closest('label')?.querySelector('output');
        if (out)
            out.textContent = el instanceof HTMLInputElement && el.type === 'range' ? String(v) : '';
    });
    document.querySelectorAll('[data-seg]').forEach(group => {
        const v = String(state[group.dataset.seg]);
        group.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.value === v)));
    });
    for (const [el, show] of visibility)
        el.hidden = !show(state);
}
// ---------------------------------------------------------------- rendering
let lastSvg = '';
let rasterToken = 0;
function update() {
    syncControls();
    const res = render(state);
    lastSvg = res.svg;
    const url = svgDataUrl(res.svg);
    $('#big').innerHTML = res.svg;
    document.querySelectorAll('img[data-live]').forEach(img => (img.src = url));
    $('link[rel=icon]').href = url;
    $('#code').textContent = res.svg;
    $('#bytes').textContent = `${new Blob([res.svg]).size} bytes`;
    $('#stroke-info').textContent = res.strokeWidth ? `stroke ≈ ${res.strokeWidth.toFixed(2)} / 32` : '';
    const warn = $('#unsupported');
    warn.hidden = !res.unsupported.length;
    warn.textContent = res.unsupported.length ? `Not in this font: ${res.unsupported.map(c => (c === ' ' ? 'space' : c)).join(' ')}` : '';
    renderStyleButtons();
    renderSpecimen();
    writeHash();
    // Pixel-accurate previews: rasterise and blow up without smoothing.
    const token = ++rasterToken;
    queueMicrotask(async () => {
        for (const el of document.querySelectorAll('canvas[data-raster]')) {
            const s = Number(el.dataset.raster);
            const c = await rasterize(res.svg, s);
            if (token !== rasterToken)
                return;
            el.width = el.height = s;
            const ctx = el.getContext('2d');
            ctx.clearRect(0, 0, s, s);
            ctx.drawImage(c, 0, 0);
        }
    });
}
let styleKey = '';
function renderStyleButtons() {
    // Only re-render the samples when something that affects them changes.
    const key = JSON.stringify([state.weight, state.slant, state.outline, state.letterSpacing]);
    if (key === styleKey)
        return;
    styleKey = key;
    const box = $('#styles');
    box.innerHTML = '';
    Object.keys(STYLES).forEach(id => {
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.value = id;
        const { svg } = render({ ...state, text: 'Ag5', style: id, shape: 'none', shadow: 'none', pad: 1, fg: 'currentColor', fgGradient: false, w: 48, h: 24, idPrefix: `s-${id}-`, stretch: false, pixelGrid: 'off' });
        b.innerHTML = `${svg}<span>${STYLES[id].name}</span>`;
        box.append(b);
    });
    syncControls();
}
let specimenKey = '';
function renderSpecimen() {
    const key = JSON.stringify([state.style, state.weight, state.slant, state.outline]);
    if (key === specimenKey)
        return;
    specimenKey = key;
    const font = state.style === 'pixel' ? PIXEL : STROKE;
    const text = ['ABCDEFGHIJKLM', 'NOPQRSTUVWXYZ', '0123456789', "!?.,:'-+=*#/()&@"]
        .map(l => [...l].filter(c => font[c]).join('')).join('\n');
    const { svg } = render({ ...state, text, shape: 'none', shadow: 'none', pad: 2, fg: 'currentColor', fgGradient: false, w: 360, h: 140, idPrefix: 'spec-', stretch: false, pixelGrid: 'off', align: 'left', letterSpacing: Math.max(state.letterSpacing, 1.6), lineGap: 4 });
    $('#specimen').innerHTML = svg;
    $('#specimen-name').textContent = STYLES[state.style].name;
}
function appleSvg() {
    // iOS adds its own rounded corners and dislikes transparency: use a full square.
    return render({ ...state, shape: 'square' }).svg;
}
async function png(svg, size) {
    return canvasToPng(await rasterize(svg, size));
}
function manifest() {
    return JSON.stringify({
        icons: [
            { src: '/icon-192.png', type: 'image/png', sizes: '192x192' },
            { src: '/icon-512.png', type: 'image/png', sizes: '512x512' },
        ],
    }, null, 2);
}
// ---------------------------------------------------------------- utils
function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
async function copy(text, btn) {
    await navigator.clipboard.writeText(text);
    const label = btn.textContent;
    btn.textContent = 'Copied';
    setTimeout(() => (btn.textContent = label), 1200);
}
function hslHex(h, s, l) {
    const f = (n) => {
        const k = (n + h / 30) % 12;
        const c = l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
        return Math.round(c * 255).toString(16).padStart(2, '0');
    };
    return `#${f(0)}${f(8)}${f(4)}`;
}
bindAll();
update();
