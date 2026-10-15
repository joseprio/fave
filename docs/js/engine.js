/*
 * Favicon engine: turns text + options into a self-contained SVG string.
 * Text is converted to path data, so the output never depends on fonts.
 */
import { STROKE, PIXEL } from './fonts.js';
export const STYLES = {
    round: { name: 'Round', cap: 'round', join: 'round' },
    sharp: { name: 'Sharp', cap: 'square', join: 'miter' },
    octo: { name: 'Octo', octo: true, cap: 'square', join: 'miter' },
    outline: { name: 'Outline', outline: true, cap: 'round', join: 'round' },
    pixel: { name: 'Pixel', pixel: true, cap: 'square', join: 'miter' },
};
/** SVG endpoint arc -> centre parameterisation (no x-axis rotation). */
function arcSeg(x1, y1, rx, ry, fa, fs, x2, y2) {
    const x1p = (x1 - x2) / 2, y1p = (y1 - y2) / 2;
    rx = Math.abs(rx);
    ry = Math.abs(ry);
    const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
    if (lambda > 1) {
        rx *= Math.sqrt(lambda);
        ry *= Math.sqrt(lambda);
    }
    const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
    const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
    const co = (fa !== fs ? 1 : -1) * Math.sqrt(Math.max(0, num / den));
    const cxp = (co * rx * y1p) / ry, cyp = (-co * ry * x1p) / rx;
    const cx = cxp + (x1 + x2) / 2, cy = cyp + (y1 + y2) / 2;
    const a0 = Math.atan2((y1p - cyp) / ry, (x1p - cxp) / rx);
    const a1 = Math.atan2((-y1p - cyp) / ry, (-x1p - cxp) / rx);
    let da = a1 - a0;
    if (!fs && da > 0)
        da -= 2 * Math.PI;
    if (fs && da < 0)
        da += 2 * Math.PI;
    return { t: 'A', cx, cy, rx, ry, a0, da, p: [x2, y2] };
}
const parsed = new Map();
function parseGlyph(d) {
    const hit = parsed.get(d);
    if (hit)
        return hit;
    const tok = d.match(/[MLHVAZ]|-?(?:\d+\.?\d*|\.\d+)/gi) ?? [];
    const subs = [];
    let sub = null;
    let x = 0, y = 0, i = 0, cmd = '';
    const n = () => parseFloat(tok[i++]);
    while (i < tok.length) {
        if (/[a-z]/i.test(tok[i]))
            cmd = tok[i++].toUpperCase();
        switch (cmd) {
            case 'M':
                x = n();
                y = n();
                sub = { start: [x, y], segs: [], closed: false };
                subs.push(sub);
                cmd = 'L';
                break;
            case 'L':
                x = n();
                y = n();
                sub.segs.push({ t: 'L', p: [x, y] });
                break;
            case 'H':
                x = n();
                sub.segs.push({ t: 'L', p: [x, y] });
                break;
            case 'V':
                y = n();
                sub.segs.push({ t: 'L', p: [x, y] });
                break;
            case 'A': {
                const rx = n(), ry = n();
                n();
                const fa = n(), fs = n(), x2 = n(), y2 = n();
                sub.segs.push(arcSeg(x, y, rx, ry, fa, fs, x2, y2));
                x = x2;
                y = y2;
                break;
            }
            case 'Z':
                sub.closed = true;
                [x, y] = sub.start;
                break;
            default: i++;
        }
    }
    parsed.set(d, subs);
    return subs;
}
/** Arc -> cubic Béziers (at most 90° each). */
function arcToCubics(a) {
    const n = Math.max(1, Math.ceil(Math.abs(a.da) / (Math.PI / 2) - 1e-9));
    const d = a.da / n, k = (4 / 3) * Math.tan(d / 4);
    const out = [];
    for (let i = 0; i < n; i++) {
        const t0 = a.a0 + i * d, t1 = t0 + d;
        const c0 = Math.cos(t0), s0 = Math.sin(t0), c1 = Math.cos(t1), s1 = Math.sin(t1);
        const p3 = i === n - 1 ? a.p : [a.cx + a.rx * c1, a.cy + a.ry * s1];
        out.push({
            t: 'C',
            c1: [a.cx + a.rx * (c0 - k * s0), a.cy + a.ry * (s0 + k * c0)],
            c2: [a.cx + a.rx * (c1 + k * s1), a.cy + a.ry * (s1 - k * c1)],
            p: p3,
        });
    }
    return out;
}
/**
 * Arc -> octagonal chamfer: the polygon formed by tangent lines at the arc's
 * ends and at every multiple of 45° in between. Straight sides stay straight.
 */
function arcToOcto(a) {
    const step = Math.PI / 4, eps = 1e-3, a1 = a.a0 + a.da;
    const ang = [a.a0];
    if (a.da > 0)
        for (let k = Math.floor((a.a0 + eps) / step) + 1; k * step < a1 - eps; k++)
            ang.push(k * step);
    else
        for (let k = Math.ceil((a.a0 - eps) / step) - 1; k * step > a1 + eps; k--)
            ang.push(k * step);
    ang.push(a1);
    const out = [];
    for (let i = 0; i < ang.length - 1; i++) {
        const mid = (ang[i] + ang[i + 1]) / 2, half = (ang[i + 1] - ang[i]) / 2;
        if (Math.abs(half) < 1e-6)
            continue;
        const r = 1 / Math.cos(half);
        out.push({ t: 'L', p: [a.cx + a.rx * r * Math.cos(mid), a.cy + a.ry * r * Math.sin(mid)] });
    }
    out.push({ t: 'L', p: a.p });
    return out;
}
function glyphCmds(d, octo) {
    const out = [];
    for (const s of parseGlyph(d)) {
        out.push({ t: 'M', p: s.start });
        for (const seg of s.segs) {
            if (seg.t === 'L')
                out.push(seg);
            else
                out.push(...(octo ? arcToOcto(seg) : arcToCubics(seg)));
        }
        if (s.closed)
            out.push({ t: 'Z' });
    }
    return out;
}
// ---------------------------------------------------------------- layout
function normalise(text) {
    const lines = text.replace(/\r/g, '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().split('\n');
    while (lines.length && !lines[lines.length - 1].trim())
        lines.pop();
    while (lines.length && !lines[0].trim())
        lines.shift();
    return lines;
}
function lineOffset(align, lineW, maxW) {
    return align === 'left' ? 0 : align === 'right' ? maxW - lineW : (maxW - lineW) / 2;
}
function layoutStroke(o, st, lines) {
    const wt = o.weight, adv = wt + o.letterSpacing, lineH = 10 + wt + o.lineGap;
    const k = Math.tan((o.slant * Math.PI) / 180);
    const unsupported = new Set();
    const rows = lines.map(l => [...l].filter(c => STROKE[c] || (unsupported.add(c), false)));
    const widths = rows.map(r => r.reduce((s, c, i) => s + STROKE[c][0] + (i ? adv : 0), 0));
    const maxW = Math.max(0, ...widths);
    const cmds = [];
    rows.forEach((row, li) => {
        let x = lineOffset(o.align, widths[li], maxW);
        const y0 = li * lineH;
        const tf = ([px, py]) => [x + px + (10 - py) * k, y0 + py];
        for (const c of row) {
            const [w, d] = STROKE[c];
            for (const cmd of glyphCmds(d, !!st.octo)) {
                if (cmd.t === 'Z')
                    cmds.push(cmd);
                else if (cmd.t === 'C')
                    cmds.push({ t: 'C', c1: tf(cmd.c1), c2: tf(cmd.c2), p: tf(cmd.p) });
                else
                    cmds.push({ t: cmd.t, p: tf(cmd.p) });
            }
            x += w + adv;
        }
    });
    return { cmds, weight: wt, unsupported: [...unsupported] };
}
function layoutPixel(o, lines) {
    // Layout unit = one pixel cell; spacing sliders are in glyph units (10 = 7 cells).
    const gap = Math.max(0, Math.round(o.letterSpacing * 0.7));
    const lineH = 7 + Math.max(0, Math.round(o.lineGap * 0.7));
    const k = Math.tan((o.slant * Math.PI) / 180);
    const unsupported = new Set();
    const rows = lines.map(l => [...l].filter(c => PIXEL[c] || (unsupported.add(c), false)).map(c => PIXEL[c].split(' ')));
    const widths = rows.map(r => r.reduce((s, g, i) => s + g[0].length + (i ? gap : 0), 0));
    const maxW = Math.max(0, ...widths);
    const cells = new Set();
    rows.forEach((row, li) => {
        let x = Math.floor(lineOffset(o.align, widths[li], maxW));
        for (const g of row) {
            g.forEach((bits, ry) => [...bits].forEach((b, cx) => b === '#' && cells.add(`${x + cx},${li * lineH + ry}`)));
            x += g[0].length + gap;
        }
    });
    const cmds = [];
    for (const loop of traceCells(cells)) {
        // slant shears around the baseline of the line the outline belongs to
        const base = Math.floor(Math.min(...loop.map(p => p[1])) / lineH) * lineH + 7;
        loop.forEach(([x, y], i) => cmds.push({ t: i ? 'L' : 'M', p: [x + (base - y) * k, y] }));
        cmds.push({ t: 'Z' });
    }
    return { cmds, weight: 0, unsupported: [...unsupported] };
}
/**
 * Outline of the union of grid cells, as closed loops (outer edges clockwise,
 * holes counter-clockwise). One outline instead of many squares avoids the
 * hairline seams browsers draw between abutting shapes.
 */
function traceCells(cells) {
    const has = (x, y) => cells.has(`${x},${y}`);
    const edges = new Map(); // start -> end points
    const add = (a, b) => {
        const key = `${a[0]},${a[1]}`;
        edges.set(key, [...(edges.get(key) ?? []), b]);
    };
    for (const c of cells) {
        const [x, y] = c.split(',').map(Number);
        if (!has(x, y - 1))
            add([x, y], [x + 1, y]);
        if (!has(x + 1, y))
            add([x + 1, y], [x + 1, y + 1]);
        if (!has(x, y + 1))
            add([x + 1, y + 1], [x, y + 1]);
        if (!has(x - 1, y))
            add([x, y + 1], [x, y]);
    }
    const loops = [];
    for (const [startKey, ends] of edges) {
        while (ends.length) {
            const start = startKey.split(',').map(Number);
            const loop = [start];
            let cur = ends.pop();
            while (`${cur[0]},${cur[1]}` !== startKey) {
                loop.push(cur);
                cur = edges.get(`${cur[0]},${cur[1]}`).pop();
            }
            // drop points in the middle of straight runs
            loops.push(loop.filter((p, i) => {
                const a = loop[(i + loop.length - 1) % loop.length], b = loop[(i + 1) % loop.length];
                return !((a[0] === p[0] && p[0] === b[0]) || (a[1] === p[1] && p[1] === b[1]));
            }));
        }
    }
    return loops;
}
// ---------------------------------------------------------------- output helpers
export function fmt(n) {
    let s = String(Math.round(n * 100) / 100);
    if (s === '-0')
        s = '0';
    return s.replace(/^(-?)0\./, '$1.');
}
const nums = (...a) => a.map(fmt).join(' ').replace(/ -/g, '-');
function shortHex(c) {
    const m = /^#([0-9a-f])\1([0-9a-f])\2([0-9a-f])\3$/i.exec(c);
    return (m ? `#${m[1]}${m[2]}${m[3]}` : c).toLowerCase();
}
function pathFromCmds(cmds) {
    let d = '', cur = ['', ''], start = ['', ''], afterM = false;
    for (const c of cmds) {
        if (c.t === 'Z') {
            d += 'Z';
            cur = start;
            continue;
        }
        const [x, y] = [fmt(c.p[0]), fmt(c.p[1])];
        // drop zero-length lines, except right after M (those draw dots)
        if (c.t === 'L' && !afterM && x === cur[0] && y === cur[1])
            continue;
        afterM = c.t === 'M';
        if (c.t === 'M') {
            d += 'M' + nums(c.p[0], c.p[1]);
            start = [x, y];
        }
        else if (c.t === 'C')
            d += 'C' + nums(...c.c1, ...c.c2, ...c.p);
        else if (y === cur[1])
            d += 'H' + x;
        else if (x === cur[0])
            d += 'V' + y;
        else
            d += 'L' + nums(c.p[0], c.p[1]);
        cur = [x, y];
    }
    return d;
}
function bezierPoint(p0, p1, p2, p3, t) {
    const u = 1 - t;
    return [
        u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
        u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
    ];
}
// ---------------------------------------------------------------- render
export function render(o) {
    const W = o.w ?? 32, H = o.h ?? 32, P = o.idPrefix ?? '';
    const st = STYLES[o.style];
    const lines = normalise(o.text);
    const L = st.pixel ? layoutPixel(o, lines) : layoutStroke(o, st, lines);
    // Points of the geometry, for bounds.
    const pts = [];
    let prev = [0, 0];
    for (const c of L.cmds) {
        if (c.t === 'Z')
            continue;
        if (c.t === 'C')
            for (let t = 0.125; t <= 1; t += 0.125)
                pts.push(bezierPoint(prev, c.c1, c.c2, c.p, t));
        else
            pts.push(c.p);
        prev = c.p;
    }
    // ---- background
    const defs = [];
    const bgFill = o.gradient ? `url(#${P}g)` : shortHex(o.bg);
    if (o.gradient && o.shape !== 'none') {
        const a = ((o.gradAngle - 90) * Math.PI) / 180;
        const dx = Math.cos(a) / 2, dy = Math.sin(a) / 2;
        defs.push(`<linearGradient id="${P}g" x1="${fmt(0.5 - dx)}" y1="${fmt(0.5 - dy)}" x2="${fmt(0.5 + dx)}" y2="${fmt(0.5 + dy)}">` +
            `<stop stop-color="${shortHex(o.bg)}"/><stop offset="1" stop-color="${shortHex(o.bg2)}"/></linearGradient>`);
    }
    const shapeEl = (fill) => {
        const f = fill ? ` fill="${fill}"` : '';
        switch (o.shape) {
            case 'square': return `<rect width="${W}" height="${H}"${f}/>`;
            case 'rounded': return `<rect width="${W}" height="${H}" rx="${fmt(o.radius)}"${f}/>`;
            case 'circle': return `<circle cx="${fmt(W / 2)}" cy="${fmt(H / 2)}" r="${fmt(Math.min(W, H) / 2)}"${f}/>`;
            default: return '';
        }
    };
    const bg = shapeEl(bgFill);
    const open = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">`;
    const finish = (body) => open + (defs.length ? `<defs>${defs.join('')}</defs>` : '') + body + '</svg>';
    if (!pts.length)
        return { svg: finish(bg), strokeWidth: 0, unsupported: L.unsupported };
    // ---- fit
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of pts) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
    }
    const bw = x1 - x0, bh = y1 - y0, wt = L.weight;
    let aw = W - 2 * o.pad, ah = H - 2 * o.pad;
    let sx, sy;
    if (o.shape === 'circle' && !o.stretch) {
        // largest box with this aspect ratio inside the circle
        const R = Math.min(W, H) / 2 - o.pad;
        sx = sy = (2 * R) / Math.hypot(bw + wt, bh + wt);
    }
    else {
        if (o.shape === 'circle')
            aw = ah = (Math.min(W, H) - 2 * o.pad) / Math.SQRT2;
        sx = sy = Math.min(aw / (bw + wt), ah / (bh + wt));
        if (o.stretch) {
            for (let i = 0; i < 6; i++) {
                const sw = wt * Math.min(sx, sy);
                const nx = bw > 0.01 ? (aw - sw) / bw : NaN, ny = bh > 0.01 ? (ah - sw) / bh : NaN;
                sx = isNaN(nx) ? ny : nx;
                sy = isNaN(ny) ? nx : ny;
            }
        }
    }
    sx = Math.max(0, sx);
    sy = Math.max(0, sy);
    let snap = 0;
    if (st.pixel && o.pixelGrid !== 'off') {
        // integer cell sizes keep pixel text crisp at the chosen size
        for (const g of o.pixelGrid === '16' ? [W / 16, W / 32] : [W / 32]) {
            if (Math.floor(sx / g) >= 1 && Math.floor(sy / g) >= 1) {
                sx = Math.floor(sx / g) * g;
                sy = Math.floor(sy / g) * g;
                snap = g;
                break;
            }
        }
    }
    let tx = (W - bw * sx) / 2 - x0 * sx, ty = (H - bh * sy) / 2 - y0 * sy;
    if (snap) {
        tx = Math.round(tx / snap) * snap;
        ty = Math.round(ty / snap) * snap;
    }
    const T = ([x, y]) => [x * sx + tx, y * sy + ty];
    const sw = wt * Math.min(sx, sy);
    // ---- text element (no colour yet; colour attribute is added per use)
    const colorAttr = st.pixel || st.outline ? 'fill' : 'stroke';
    let base;
    const d = pathFromCmds(L.cmds.map(c => c.t === 'Z' ? c : c.t === 'C' ? { t: 'C', c1: T(c.c1), c2: T(c.c2), p: T(c.p) } : { t: c.t, p: T(c.p) }));
    if (st.pixel) {
        base = `<path d="${d}"/>`;
    }
    else {
        const caps = `fill="none" stroke-linecap="${st.cap}" stroke-linejoin="${st.join}"${st.join === 'miter' ? ' stroke-miterlimit="2"' : ''}`;
        if (st.outline) {
            const inner = Math.max(0, sw - 2 * o.outline);
            defs.push(`<path id="${P}p" d="${d}" ${caps}/>` +
                `<mask id="${P}m"><use href="#${P}p" stroke="#fff" stroke-width="${fmt(sw)}"/>` +
                (inner > 0 ? `<use href="#${P}p" stroke="#000" stroke-width="${fmt(inner)}"/>` : '') + `</mask>`);
            base = `<rect width="${W}" height="${H}" mask="url(#${P}m)"/>`;
        }
        else {
            base = `<path d="${d}" ${caps} stroke-width="${fmt(sw)}"/>`;
        }
    }
    const tag = (el, attrs) => el.replace(/^<(\w+)/, `<$1 ${attrs}`);
    const fg = shortHex(o.fg), shc = shortHex(o.shColor);
    // ---- shadow
    let body;
    const op = fmt(o.shOpacity);
    if (o.shadow === 'soft') {
        defs.push(`<filter id="${P}s" x="-50%" y="-50%" width="200%" height="200%">` +
            `<feDropShadow dx="${fmt(o.shX)}" dy="${fmt(o.shY)}" stdDeviation="${fmt(o.shBlur)}" flood-color="${shc}" flood-opacity="${op}"/></filter>`);
        body = `<g filter="url(#${P}s)">${tag(base, `${colorAttr}="${fg}"`)}</g>`;
    }
    else if (o.shadow === 'hard' || o.shadow === 'long') {
        defs.push(tag(base, `id="${P}t"`));
        const use = (x, y) => `<use href="#${P}t" x="${fmt(x)}" y="${fmt(y)}"/>`;
        let copies = '';
        if (o.shadow === 'hard')
            copies = use(o.shX, o.shY);
        else {
            // direction comes from the x/y offsets; length from shLength
            const len = Math.hypot(o.shX, o.shY);
            const ux = len ? o.shX / len : Math.SQRT1_2, uy = len ? o.shY / len : Math.SQRT1_2;
            const n = Math.ceil(o.shLength / 0.5);
            for (let i = n; i >= 1; i--)
                copies += use(ux * i * 0.5, uy * i * 0.5);
        }
        let clip = '';
        if (o.shadow === 'long' && o.shape !== 'none') {
            defs.push(`<clipPath id="${P}c">${shapeEl('')}</clipPath>`);
            clip = ` clip-path="url(#${P}c)"`;
        }
        body = `<g ${colorAttr}="${shc}" opacity="${op}"${clip}>${copies}</g><use href="#${P}t" ${colorAttr}="${fg}"/>`;
    }
    else {
        body = tag(base, `${colorAttr}="${fg}"`);
    }
    return { svg: finish(bg + body), strokeWidth: sw, unsupported: L.unsupported };
}
