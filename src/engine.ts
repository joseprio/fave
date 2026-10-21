/*
 * Favicon engine: turns text or an icon + options into a self-contained SVG string.
 * Text is converted to path data, so the output never depends on fonts.
 */
import { STROKE, PIXEL } from './fonts.js';
import type { IconStyle } from './icons.js';

export type StyleId = 'round' | 'sharp' | 'octo' | 'outline' | 'pixel';
export type Shape = 'none' | 'square' | 'rounded' | 'circle';
export type ShadowType = 'none' | 'soft' | 'hard' | 'long';
export type Align = 'left' | 'center' | 'right';
export type Mode = 'text' | 'icon';

export interface Options {
  mode: Mode;
  text: string;
  style: StyleId;
  /** stroke weight, in glyph units (cap height = 10) */
  weight: number;
  /** visible gap between letters, glyph units */
  letterSpacing: number;
  /** visible gap between lines, glyph units */
  lineGap: number;
  align: Align;
  /** degrees, positive leans right */
  slant: number;
  stretch: boolean;
  /** padding in output units */
  pad: number;
  /** outline line thickness in output units */
  outline: number;
  /** snap pixel font to a grid of this many cells across ('off' disables) */
  pixelGrid: 'off' | '16' | '32';

  /** Material Symbol name and variant; the engine only uses iconPath */
  icon: string;
  iconStyle: IconStyle;
  iconFill: boolean;

  shape: Shape;
  radius: number;
  bg: string;
  gradient: boolean;
  bg2: string;
  gradAngle: number;
  fg: string;
  fgGradient: boolean;
  fg2: string;
  fgAngle: number;

  shadow: ShadowType;
  shColor: string;
  shOpacity: number;
  shX: number;
  shY: number;
  shBlur: number;
  shLength: number;

  /** viewBox size, defaults to 32x32 */
  w?: number;
  h?: number;
  /** prefix for element ids, needed when several SVGs are inlined in one page */
  idPrefix?: string;
  /** path data of the icon in icon mode, looked up by the caller */
  iconPath?: string;
}

export interface StyleDef {
  name: string;
  pixel?: boolean;
  octo?: boolean;
  outline?: boolean;
  /**
   * Square-cut terminals done by hand instead of stroke-linecap="square":
   * free ends are extended, ends that touch another stroke stay butt, and
   * ends on the cap line / baseline are clipped flat.
   */
  cut?: boolean;
  cap: 'round' | 'butt';
  join: 'round' | 'miter';
}

export const STYLES: Record<StyleId, StyleDef> = {
  round: { name: 'Round', cap: 'round', join: 'round' },
  sharp: { name: 'Sharp', cut: true, cap: 'butt', join: 'miter' },
  octo: { name: 'Octo', octo: true, cut: true, cap: 'butt', join: 'miter' },
  outline: { name: 'Outline', outline: true, cap: 'round', join: 'round' },
  pixel: { name: 'Pixel', pixel: true, cap: 'butt', join: 'miter' },
};

export interface RenderResult {
  svg: string;
  /** stroke width in output units (0 for pixel) */
  strokeWidth: number;
  unsupported: string[];
}

type Pt = [number, number];
type Cmd = { t: 'M' | 'L'; p: Pt } | { t: 'C'; c1: Pt; c2: Pt; p: Pt } | { t: 'Z' };

// ---------------------------------------------------------------- glyph parsing

interface ArcSeg { t: 'A'; cx: number; cy: number; rx: number; ry: number; a0: number; da: number; p: Pt }
interface LineSeg { t: 'L'; p: Pt }
interface SubPath { start: Pt; segs: (ArcSeg | LineSeg)[]; closed: boolean }

/** SVG endpoint arc -> centre parameterisation (no x-axis rotation). */
function arcSeg(x1: number, y1: number, rx: number, ry: number, fa: number, fs: number, x2: number, y2: number): ArcSeg {
  const x1p = (x1 - x2) / 2, y1p = (y1 - y2) / 2;
  rx = Math.abs(rx); ry = Math.abs(ry);
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) { rx *= Math.sqrt(lambda); ry *= Math.sqrt(lambda); }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const co = (fa !== fs ? 1 : -1) * Math.sqrt(Math.max(0, num / den));
  const cxp = (co * rx * y1p) / ry, cyp = (-co * ry * x1p) / rx;
  const cx = cxp + (x1 + x2) / 2, cy = cyp + (y1 + y2) / 2;
  const a0 = Math.atan2((y1p - cyp) / ry, (x1p - cxp) / rx);
  const a1 = Math.atan2((-y1p - cyp) / ry, (-x1p - cxp) / rx);
  let da = a1 - a0;
  if (!fs && da > 0) da -= 2 * Math.PI;
  if (fs && da < 0) da += 2 * Math.PI;
  return { t: 'A', cx, cy, rx, ry, a0, da, p: [x2, y2] };
}

const parsed = new Map<string, SubPath[]>();

function parseGlyph(d: string): SubPath[] {
  const hit = parsed.get(d);
  if (hit) return hit;
  const tok = d.match(/[MLHVAZ]|-?(?:\d+\.?\d*|\.\d+)/gi) ?? [];
  const subs: SubPath[] = [];
  let sub: SubPath | null = null;
  let x = 0, y = 0, i = 0, cmd = '';
  const n = () => parseFloat(tok[i++]);
  while (i < tok.length) {
    if (/[a-z]/i.test(tok[i])) cmd = tok[i++].toUpperCase();
    switch (cmd) {
      case 'M':
        x = n(); y = n();
        sub = { start: [x, y], segs: [], closed: false };
        subs.push(sub);
        cmd = 'L';
        break;
      case 'L': x = n(); y = n(); sub!.segs.push({ t: 'L', p: [x, y] }); break;
      case 'H': x = n(); sub!.segs.push({ t: 'L', p: [x, y] }); break;
      case 'V': y = n(); sub!.segs.push({ t: 'L', p: [x, y] }); break;
      case 'A': {
        const rx = n(), ry = n(); n();
        const fa = n(), fs = n(), x2 = n(), y2 = n();
        sub!.segs.push(arcSeg(x, y, rx, ry, fa, fs, x2, y2));
        x = x2; y = y2;
        break;
      }
      case 'Z': sub!.closed = true; [x, y] = sub!.start; break;
      default: i++;
    }
  }
  parsed.set(d, subs);
  return subs;
}

/** Arc -> cubic Béziers (at most 90° each). */
function arcToCubics(a: ArcSeg): Cmd[] {
  const n = Math.max(1, Math.ceil(Math.abs(a.da) / (Math.PI / 2) - 1e-9));
  const d = a.da / n, k = (4 / 3) * Math.tan(d / 4);
  const out: Cmd[] = [];
  for (let i = 0; i < n; i++) {
    const t0 = a.a0 + i * d, t1 = t0 + d;
    const c0 = Math.cos(t0), s0 = Math.sin(t0), c1 = Math.cos(t1), s1 = Math.sin(t1);
    const p3: Pt = i === n - 1 ? a.p : [a.cx + a.rx * c1, a.cy + a.ry * s1];
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
function arcToOcto(a: ArcSeg): Cmd[] {
  const step = Math.PI / 4, eps = 1e-3, a1 = a.a0 + a.da;
  const ang = [a.a0];
  if (a.da > 0) for (let k = Math.floor((a.a0 + eps) / step) + 1; k * step < a1 - eps; k++) ang.push(k * step);
  else for (let k = Math.ceil((a.a0 - eps) / step) - 1; k * step > a1 + eps; k--) ang.push(k * step);
  ang.push(a1);
  const out: Cmd[] = [];
  for (let i = 0; i < ang.length - 1; i++) {
    const mid = (ang[i] + ang[i + 1]) / 2, half = (ang[i + 1] - ang[i]) / 2;
    if (Math.abs(half) < 1e-6) continue;
    const r = 1 / Math.cos(half);
    out.push({ t: 'L', p: [a.cx + a.rx * r * Math.cos(mid), a.cy + a.ry * r * Math.sin(mid)] });
  }
  out.push({ t: 'L', p: a.p });
  return out;
}

function glyphCmds(d: string, octo: boolean): Cmd[] {
  const out: Cmd[] = [];
  for (const s of parseGlyph(d)) {
    out.push({ t: 'M', p: s.start });
    for (const seg of s.segs) {
      if (seg.t === 'L') out.push(seg);
      else out.push(...(octo ? arcToOcto(seg) : arcToCubics(seg)));
    }
    if (s.closed) out.push({ t: 'Z' });
  }
  return out;
}

// ---------------------------------------------------------------- icon paths

const NUM = /[-+]?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?/iy;

/**
 * Any SVG path -> absolute M/L/C/Z commands. Sub-paths that draw nothing
 * are dropped (Material Symbols end with a stray "m480-480Z" that would
 * otherwise count towards the bounds).
 */
export function parsePath(d: string): Cmd[] {
  let i = 0;
  const skip = () => { while (i < d.length && /[\s,]/.test(d[i])) i++; };
  const more = () => { skip(); return i < d.length && /[-+.\d]/.test(d[i]); };
  const num = () => {
    skip();
    NUM.lastIndex = i;
    const m = NUM.exec(d);
    if (!m) throw new Error(`bad path data at ${i}`);
    i += m[0].length;
    return parseFloat(m[0]);
  };
  // arc flags may be written without separators: "a5 5 0 0110 10"
  const flag = () => { skip(); return d[i++] === '1' ? 1 : 0; };

  const subs: Cmd[][] = [];
  let cur: Cmd[] = [];
  let x = 0, y = 0, sx = 0, sy = 0, ctrl: Pt = [0, 0], prev = '';
  try {
    for (skip(); i < d.length; skip()) {
      const cmd = /[a-z]/i.test(d[i]) ? d[i++] : '';
      if (!cmd) break;
      const C = cmd.toUpperCase(), rel = cmd !== C;
      let first = true;
      do {
        const ox = rel ? x : 0, oy = rel ? y : 0;
        const pt = (): Pt => [ox + num(), oy + num()];
        const reflect = (kinds: string): Pt => prev && kinds.includes(prev) ? [2 * x - ctrl[0], 2 * y - ctrl[1]] : [x, y];
        let p: Pt;
        switch (C) {
          case 'M':
            // further pairs after M are line-tos
            p = pt();
            if (!first) cur.push({ t: 'L', p });
            else { subs.push(cur = [{ t: 'M', p }]); [sx, sy] = p; }
            break;
          case 'L': p = pt(); cur.push({ t: 'L', p }); break;
          case 'H': p = [ox + num(), y]; cur.push({ t: 'L', p }); break;
          case 'V': p = [x, oy + num()]; cur.push({ t: 'L', p }); break;
          case 'C': case 'S': {
            const c1 = C === 'C' ? pt() : reflect('CS'), c2 = pt();
            p = pt();
            cur.push({ t: 'C', c1, c2, p });
            ctrl = c2;
            break;
          }
          case 'Q': case 'T': {
            const q = C === 'Q' ? pt() : reflect('QT');
            p = pt();
            cur.push({ t: 'C', c1: [x + (2 / 3) * (q[0] - x), y + (2 / 3) * (q[1] - y)], c2: [p[0] + (2 / 3) * (q[0] - p[0]), p[1] + (2 / 3) * (q[1] - p[1])], p });
            ctrl = q;
            break;
          }
          case 'A': {
            const rx = num(), ry = num(), rot = num(), fa = flag(), fs = flag();
            p = pt();
            cur.push(...arcCubics([x, y], rx, ry, rot, fa, fs, p));
            break;
          }
          case 'Z':
            cur.push({ t: 'Z' });
            p = [sx, sy];
            break;
          default:
            throw new Error(`unknown path command ${cmd}`);
        }
        [x, y] = p;
        prev = C;
        first = false;
      } while (C !== 'Z' && more());
    }
  } catch {
    // render whatever parsed, like browsers do
  }
  return subs.filter(s => s.some(c => c.t === 'L' || c.t === 'C')).flat();
}

/** Endpoint arc (any rotation) -> cubics, via the ellipse's own frame. */
function arcCubics(p0: Pt, rx: number, ry: number, rot: number, fa: number, fs: number, p: Pt): Cmd[] {
  if (p0[0] === p[0] && p0[1] === p[1]) return [];
  if (!rx || !ry) return [{ t: 'L', p }];
  const a = (rot * Math.PI) / 180, cos = Math.cos(a), sin = Math.sin(a);
  const inv = ([px, py]: Pt): Pt => [px * cos + py * sin, py * cos - px * sin];
  const fwd = ([px, py]: Pt): Pt => [px * cos - py * sin, px * sin + py * cos];
  const [a0, a1] = [inv(p0), inv(p)];
  const out = mapCmds(arcToCubics(arcSeg(a0[0], a0[1], rx, ry, fa, fs, a1[0], a1[1])), fwd);
  (out[out.length - 1] as { p: Pt }).p = p;
  return out;
}

// ---------------------------------------------------------------- cut terminals (sharp, octo)

interface GlyphInfo {
  /** vertical extent of the centre-lines, always covering 0..10 */
  ymin: number;
  ymax: number;
  /** per sub-path: do its start / end touch another stroke? */
  joined: [boolean, boolean][];
}

const infos = new Map<string, GlyphInfo>();

function segDist(p: Pt, a: Pt, b: Pt): number {
  const vx = b[0] - a[0], vy = b[1] - a[1], l2 = vx * vx + vy * vy;
  const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / l2)) : 0;
  return Math.hypot(p[0] - a[0] - t * vx, p[1] - a[1] - t * vy);
}

function glyphInfo(d: string): GlyphInfo {
  const hit = infos.get(d);
  if (hit) return hit;
  const subs = parseGlyph(d);
  // every segment as a polyline, tagged with its sub-path and index
  const polys: { s: number; i: number; pts: Pt[] }[] = [];
  subs.forEach((sub, s) => {
    let prev = sub.start;
    sub.segs.forEach((seg, i) => {
      const pts: Pt[] = seg.t === 'L' ? [prev, seg.p] : Array.from({ length: 17 }, (_, k) =>
        k === 16 ? seg.p : [seg.cx + seg.rx * Math.cos(seg.a0 + (seg.da * k) / 16), seg.cy + seg.ry * Math.sin(seg.a0 + (seg.da * k) / 16)]);
      polys.push({ s, i, pts });
      prev = seg.p;
    });
    if (sub.closed) polys.push({ s, i: sub.segs.length, pts: [prev, sub.start] });
  });
  const ends = subs.map(sub => sub.closed ? [] : [sub.start, sub.segs.length ? sub.segs[sub.segs.length - 1].p : sub.start]);
  const near = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.2;
  // An end is joined when it lands inside another stroke (T's stem, R's leg)
  // or closes its own loop (6, 8). Meeting another stroke's free end at a
  // corner (B's top left) is not a join: both ends are extended to fill it.
  const touches = (p: Pt, s: number, i: number) => polys.some(q => {
    if (q.s === s && q.i === i) return false;
    if (!q.pts.some((a, k) => k > 0 && segDist(p, q.pts[k - 1], a) < 0.2)) return false;
    return q.s === s || !ends[q.s].some(e => near(e, p));
  });
  const ys = polys.flatMap(q => q.pts.map(p => p[1]));
  const info: GlyphInfo = {
    ymin: Math.min(0, ...ys),
    ymax: Math.max(10, ...ys),
    joined: subs.map((sub, s) => {
      const end = sub.segs.length ? sub.segs[sub.segs.length - 1].p : sub.start;
      return [touches(sub.start, s, 0), touches(end, s, sub.segs.length - 1)];
    }),
  };
  infos.set(d, info);
  return info;
}

function unit(x: number, y: number): Pt {
  const l = Math.hypot(x, y);
  return l > 1e-9 ? [x / l, y / l] : [0, 0];
}

/** Keep the part of a polygon between two horizontal lines. */
function clipY(poly: Pt[], lo: number, hi: number): Pt[] {
  for (const [lim, sgn] of [[lo, 1], [hi, -1]]) {
    const inside = (p: Pt) => (p[1] - lim) * sgn >= 0;
    poly = poly.flatMap((p, i) => {
      const q = poly[(i + 1) % poly.length], out: Pt[] = inside(p) ? [p] : [];
      if (inside(p) !== inside(q)) {
        const t = (lim - p[1]) / (q[1] - p[1]);
        out.push([p[0] + t * (q[0] - p[0]), lim]);
      }
      return out;
    });
  }
  return poly;
}

/**
 * Rewrites one glyph's (layout space) commands for cut terminals, appending
 * them to `out`. Returns the band [top, bottom] the glyph is clipped to and
 * pushes outline points of mitred corners to `bounds` (inset by h so the
 * usual stroke margin in the fit still applies).
 */
function cutGlyph(g: Cmd[], joined: [boolean, boolean][], top: number, bot: number, h: number, out: Cmd[], bounds: Pt[]): [number, number] {
  let lo = top - h, hi = bot + h;
  const corners: [Pt, Pt, Pt][] = []; // in-direction, vertex, out-direction
  const ext = (p: Pt, dir: Pt, joined: boolean): Pt => {
    if (joined) return p;
    const [dx, dy] = unit(...dir);
    if (!dx && !dy) return [p[0], p[1] + h];
    let t = h;
    if ((Math.abs(p[1] - top) < 1e-4 || Math.abs(p[1] - bot) < 1e-4) && Math.abs(dy) >= 0.5) {
      // long enough that both edges cross the band edge, which then cuts it flat
      t = (h * (1 + Math.abs(dx))) / Math.abs(dy) + 0.01;
    } else {
      // square cap: widen the band so its corners survive the clip
      const yc = p[1] + dy * t;
      lo = Math.min(lo, yc - Math.abs(dx) * h);
      hi = Math.max(hi, yc + Math.abs(dx) * h);
    }
    return [p[0] + dx * t, p[1] + dy * t];
  };
  const sub: Cmd[] = [];
  let si = 0;
  const flush = () => {
    if (!sub.length) return;
    const [sj, ej] = joined[si++] ?? [true, true];
    const closed = sub[sub.length - 1].t === 'Z';
    const pts = sub.filter((c): c is Exclude<Cmd, { t: 'Z' }> => c.t !== 'Z');
    // direction leaving / entering each drawn point
    const inDir = (k: number): Pt => {
      const c = pts[k], p = pts[k - 1].p;
      const from = c.t === 'C' ? (c.c2[0] !== c.p[0] || c.c2[1] !== c.p[1] ? c.c2 : c.c1) : p;
      return [c.p[0] - from[0], c.p[1] - from[1]];
    };
    const outDir = (k: number): Pt => {
      const c = pts[k + 1], p = pts[k].p;
      const to = c.t === 'C' ? (c.c1[0] !== p[0] || c.c1[1] !== p[1] ? c.c1 : c.c2) : c.p;
      return [to[0] - p[0], to[1] - p[1]];
    };
    for (let k = 1; k < pts.length - 1; k++) corners.push([inDir(k), pts[k].p, outDir(k)]);
    if (closed || pts.length < 2) { out.push(...sub); sub.length = 0; return; }
    const s = pts[0].p, e = pts[pts.length - 1].p;
    const o0 = outDir(0), i1 = inDir(pts.length - 1);
    const s2 = ext(s, [-o0[0], -o0[1]], sj), e2 = ext(e, i1, ej);
    if (s2 !== s) out.push({ t: 'M', p: s2 }, { t: 'L', p: s });
    else out.push(pts[0]);
    out.push(...sub.slice(1));
    if (e2 !== e) out.push({ t: 'L', p: e2 });
    sub.length = 0;
  };
  for (const c of g) {
    if (c.t === 'M') flush();
    sub.push(c);
  }
  flush();

  // Mitred corners (miter limit 4) can reach past the usual stroke margin.
  for (const [a0, v, b0] of corners) {
    const a = unit(...a0), b = unit(...b0);
    const cos = -(a[0] * b[0] + a[1] * b[1]);
    if (cos < -0.999 || cos > 0.999) continue;
    const ratio = 1 / Math.sin(Math.acos(cos) / 2);
    if (ratio > 4) continue;
    const m = unit(a[0] - b[0], a[1] - b[1]);
    const side = (d: Pt): Pt => {
      const n: Pt = [-d[1], d[0]];
      return n[0] * m[0] + n[1] * m[1] > 0 ? n : [-n[0], -n[1]];
    };
    const na = side(a), nb = side(b);
    const poly: Pt[] = [
      [v[0] + na[0] * h, v[1] + na[1] * h],
      [v[0] + m[0] * ratio * h, v[1] + m[1] * ratio * h],
      [v[0] + nb[0] * h, v[1] + nb[1] * h],
    ];
    for (const [x, y] of clipY(poly, lo, hi)) {
      const ix = x > v[0] ? Math.max(v[0], x - h) : Math.min(v[0], x + h);
      const iy = y > v[1] ? Math.max(v[1], y - h) : Math.min(v[1], y + h);
      bounds.push([ix, iy]);
    }
  }
  return [lo, hi];
}

// ---------------------------------------------------------------- layout

function mapCmds(cmds: Cmd[], f: (p: Pt) => Pt): Cmd[] {
  return cmds.map(c => c.t === 'Z' ? c : c.t === 'C' ? { t: 'C', c1: f(c.c1), c2: f(c.c2), p: f(c.p) } : { t: c.t, p: f(c.p) });
}

/** A laid-out glyph for cut terminals; y values in layout space. */
interface CutGlyph { cmds: Cmd[]; joined: [boolean, boolean][]; top: number; bot: number; base: number; x0: number; x1: number }

function normalise(text: string): string[] {
  const lines = text.replace(/\r/g, '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().split('\n');
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  while (lines.length && !lines[0].trim()) lines.shift();
  return lines;
}

interface Layout {
  /** shapes in layout space */
  cmds: Cmd[];
  /** extra bound points (already inset by half the weight) */
  bounds?: Pt[];
  /** cut-terminal styles: glyphs per line, re-cut in output space after the fit */
  cut?: { rows: CutGlyph[][]; adv: number; k: number };
  weight: number;
  unsupported: string[];
}

function lineOffset(align: Align, lineW: number, maxW: number): number {
  return align === 'left' ? 0 : align === 'right' ? maxW - lineW : (maxW - lineW) / 2;
}

function layoutStroke(o: Options, st: StyleDef, lines: string[]): Layout {
  const wt = o.weight, adv = wt + o.letterSpacing, lineH = 10 + wt + o.lineGap;
  const k = Math.tan((o.slant * Math.PI) / 180);
  const unsupported = new Set<string>();
  const rows = lines.map(l => [...l].filter(c => STROKE[c] || (unsupported.add(c), false)));
  const widths = rows.map(r => r.reduce((s, c, i) => s + STROKE[c][0] + (i ? adv : 0), 0));
  const maxW = Math.max(0, ...widths);
  const cmds: Cmd[] = [], bounds: Pt[] = [];
  const cutRows = rows.map((row, li) => {
    let x = lineOffset(o.align, widths[li], maxW);
    const y0 = li * lineH;
    const tf = ([px, py]: Pt): Pt => [x + px + (10 - py) * k, y0 + py];
    const glyphs: CutGlyph[] = [];
    for (const c of row) {
      const [w, d] = STROKE[c];
      const g = mapCmds(glyphCmds(d, !!st.octo), tf);
      cmds.push(...g);
      if (st.cut) {
        const info = glyphInfo(d);
        const top = y0 + info.ymin, bot = y0 + info.ymax;
        cutGlyph(g, info.joined, top, bot, wt / 2, [], bounds);
        glyphs.push({ cmds: g, joined: info.joined, top, bot, base: y0 + 10, x0: x, x1: x + w });
      }
      x += w + adv;
    }
    return glyphs;
  });
  const L: Layout = { cmds, weight: wt, unsupported: [...unsupported] };
  if (st.cut) Object.assign(L, { bounds, cut: { rows: cutRows, adv, k } });
  return L;
}

function layoutPixel(o: Options, lines: string[]): Layout {
  // Layout unit = one pixel cell; spacing sliders are in glyph units (10 = 7 cells).
  const gap = Math.max(0, Math.round(o.letterSpacing * 0.7));
  const lineH = 7 + Math.max(0, Math.round(o.lineGap * 0.7));
  const k = Math.tan((o.slant * Math.PI) / 180);
  const unsupported = new Set<string>();
  const rows = lines.map(l => [...l].filter(c => PIXEL[c] || (unsupported.add(c), false)).map(c => PIXEL[c].split(' ')));
  const widths = rows.map(r => r.reduce((s, g, i) => s + g[0].length + (i ? gap : 0), 0));
  const maxW = Math.max(0, ...widths);
  const cells = new Set<string>();
  rows.forEach((row, li) => {
    let x = Math.floor(lineOffset(o.align, widths[li], maxW));
    for (const g of row) {
      g.forEach((bits, ry) => [...bits].forEach((b, cx) => b === '#' && cells.add(`${x + cx},${li * lineH + ry}`)));
      x += g[0].length + gap;
    }
  });
  const cmds: Cmd[] = [];
  for (const loop of traceCells(cells)) {
    // slant shears around the baseline of the line the outline belongs to
    const base = Math.floor(Math.min(...loop.map(p => p[1])) / lineH) * lineH + 7;
    loop.forEach(([x, y], i) => cmds.push({ t: i ? 'L' : 'M', p: [x + (base - y) * k, y] }));
    cmds.push({ t: 'Z' });
  }
  return { cmds, weight: 0, unsupported: [...unsupported] };
}

function layoutIcon(o: Options): Layout {
  return { cmds: parsePath(o.iconPath ?? ''), weight: 0, unsupported: [] };
}

/**
 * Outline of the union of grid cells, as closed loops (outer edges clockwise,
 * holes counter-clockwise). One outline instead of many squares avoids the
 * hairline seams browsers draw between abutting shapes.
 */
function traceCells(cells: Set<string>): Pt[][] {
  const has = (x: number, y: number) => cells.has(`${x},${y}`);
  const edges = new Map<string, Pt[]>(); // start -> end points
  const add = (a: Pt, b: Pt) => {
    const key = `${a[0]},${a[1]}`;
    edges.set(key, [...(edges.get(key) ?? []), b]);
  };
  for (const c of cells) {
    const [x, y] = c.split(',').map(Number);
    if (!has(x, y - 1)) add([x, y], [x + 1, y]);
    if (!has(x + 1, y)) add([x + 1, y], [x + 1, y + 1]);
    if (!has(x, y + 1)) add([x + 1, y + 1], [x, y + 1]);
    if (!has(x - 1, y)) add([x, y + 1], [x, y]);
  }
  const loops: Pt[][] = [];
  for (const [startKey, ends] of edges) {
    while (ends.length) {
      const start = startKey.split(',').map(Number) as Pt;
      const loop: Pt[] = [start];
      let cur = ends.pop()!;
      while (`${cur[0]},${cur[1]}` !== startKey) {
        loop.push(cur);
        cur = edges.get(`${cur[0]},${cur[1]}`)!.pop()!;
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

export function fmt(n: number): string {
  let s = String(Math.round(n * 100) / 100);
  if (s === '-0') s = '0';
  return s.replace(/^(-?)0\./, '$1.');
}

const nums = (...a: number[]) => a.map(fmt).join(' ').replace(/ -/g, '-');

function shortHex(c: string): string {
  const m = /^#([0-9a-f])\1([0-9a-f])\2([0-9a-f])\3$/i.exec(c);
  return (m ? `#${m[1]}${m[2]}${m[3]}` : c).toLowerCase();
}

function pathFromCmds(cmds: Cmd[]): string {
  let d = '', cur: [string, string] = ['', ''], start: [string, string] = ['', ''], afterM = false;
  for (const c of cmds) {
    if (c.t === 'Z') { d += 'Z'; cur = start; continue; }
    const [x, y] = [fmt(c.p[0]), fmt(c.p[1])];
    // drop zero-length lines, except right after M (those draw dots)
    if (c.t === 'L' && !afterM && x === cur[0] && y === cur[1]) continue;
    afterM = c.t === 'M';
    if (c.t === 'M') { d += 'M' + nums(c.p[0], c.p[1]); start = [x, y]; }
    else if (c.t === 'C') d += 'C' + nums(...c.c1, ...c.c2, ...c.p);
    else if (y === cur[1]) d += 'H' + x;
    else if (x === cur[0]) d += 'V' + y;
    else d += 'L' + nums(c.p[0], c.p[1]);
    cur = [x, y];
  }
  return d;
}

function bezierPoint(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
  const u = 1 - t;
  return [
    u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
    u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
  ];
}

// ---------------------------------------------------------------- render

export function render(o: Options): RenderResult {
  const W = o.w ?? 32, H = o.h ?? 32, P = o.idPrefix ?? '';
  const icon = o.mode === 'icon';
  // icons are filled shapes, drawn like pixel text
  const st = icon ? STYLES.pixel : STYLES[o.style];
  const lines = normalise(o.text);
  const L = icon ? layoutIcon(o) : st.pixel ? layoutPixel(o, lines) : layoutStroke(o, st, lines);

  // Points of the geometry, for bounds.
  const pts: Pt[] = [];
  let prev: Pt = [0, 0];
  for (const c of L.cmds) {
    if (c.t === 'Z') continue;
    if (c.t === 'C') for (let t = 0.125; t <= 1; t += 0.125) pts.push(bezierPoint(prev, c.c1, c.c2, c.p, t));
    else pts.push(c.p);
    prev = c.p;
  }
  if (L.bounds) pts.push(...L.bounds);

  // ---- background
  const defs: string[] = [];
  const bgFill = o.gradient ? `url(#${P}g)` : shortHex(o.bg);
  if (o.gradient && o.shape !== 'none') {
    const a = ((o.gradAngle - 90) * Math.PI) / 180;
    const dx = Math.cos(a) / 2, dy = Math.sin(a) / 2;
    defs.push(`<linearGradient id="${P}g" x1="${fmt(0.5 - dx)}" y1="${fmt(0.5 - dy)}" x2="${fmt(0.5 + dx)}" y2="${fmt(0.5 + dy)}">` +
      `<stop stop-color="${shortHex(o.bg)}"/><stop offset="1" stop-color="${shortHex(o.bg2)}"/></linearGradient>`);
  }
  const shapeEl = (fill: string) => {
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
  const finish = (body: string) => open + (defs.length ? `<defs>${defs.join('')}</defs>` : '') + body + '</svg>';

  if (!pts.length) return { svg: finish(bg), strokeWidth: 0, unsupported: L.unsupported };

  // ---- fit
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const bw = x1 - x0, bh = y1 - y0, wt = L.weight;
  let aw = W - 2 * o.pad, ah = H - 2 * o.pad;
  let sx: number, sy: number;
  if (o.shape === 'circle' && !o.stretch) {
    // largest box with this aspect ratio inside the circle
    const R = Math.min(W, H) / 2 - o.pad;
    sx = sy = (2 * R) / Math.hypot(bw + wt, bh + wt);
  } else {
    if (o.shape === 'circle') aw = ah = (Math.min(W, H) - 2 * o.pad) / Math.SQRT2;
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
  sx = Math.max(0, sx); sy = Math.max(0, sy);

  let snap = 0;
  if (st.pixel && !icon && o.pixelGrid !== 'off') {
    // integer cell sizes keep pixel text crisp at the chosen size
    for (const g of o.pixelGrid === '16' ? [W / 16, W / 32] : [W / 32]) {
      if (Math.floor(sx / g) >= 1 && Math.floor(sy / g) >= 1) {
        sx = Math.floor(sx / g) * g; sy = Math.floor(sy / g) * g; snap = g;
        break;
      }
    }
  }
  let tx = (W - bw * sx) / 2 - x0 * sx, ty = (H - bh * sy) / 2 - y0 * sy;
  if (snap) { tx = Math.round(tx / snap) * snap; ty = Math.round(ty / snap) * snap; }
  const T = ([x, y]: Pt): Pt => [x * sx + tx, y * sy + ty];
  const sw = wt * Math.min(sx, sy);

  // ---- text element (no colour yet; colour attribute is added per use)
  const colorAttr = st.pixel || st.outline ? 'fill' : 'stroke';
  let base: string;
  const d = pathFromCmds(mapCmds(L.cmds, T));
  if (st.pixel) {
    base = `<path d="${d}"/>`;
  } else if (L.cut) {
    // Cut in output space, where the stroke is round even when stretched.
    // Each line gets its own clip, so spikes cannot show up in a neighbouring line.
    const { rows, adv, k } = L.cut, h = sw / 2, lines: string[] = [];
    const Ty = (y: number) => y * sy + ty, unTy = (y: number) => (y - ty) / sy;
    for (const row of rows) {
      const draw: Cmd[] = [], polys: Pt[][] = [];
      // per glyph: [left, right, top, bottom]; x in layout space, y in output space
      const cols = row.map(g => [g.x0, g.x1, ...cutGlyph(mapCmds(g.cmds, T), g.joined, Ty(g.top), Ty(g.bot), h, draw, [])]);
      if (!cols.length) continue;
      // columns meet halfway between glyphs; neighbours with the same band merge
      const baseline = row[0].base, margin = 3 * wt + 10;
      const corner = (x: number, y: number) => T([x + (baseline - unTy(y)) * k, unTy(y)]);
      let left = cols[0][0] - margin;
      cols.forEach(([, r, lo, hi], i) => {
        const next = cols[i + 1];
        if (next && Math.abs(next[2] - lo) < 1e-6 && Math.abs(next[3] - hi) < 1e-6) return;
        const right = next ? r + adv / 2 : r + margin;
        polys.push([corner(left, lo), corner(right, lo), corner(right, hi), corner(left, hi)]);
        left = right;
      });
      const id = `${P}k${lines.length || ''}`;
      defs.push(`<clipPath id="${id}"><path d="${polys.map(poly => 'M' + poly.map(p => nums(...p)).join('L') + 'Z').join('')}"/></clipPath>`);
      lines.push(`<path d="${pathFromCmds(draw)}" clip-path="url(#${id})"/>`);
    }
    // butt caps and miter limit 4 are the SVG defaults
    const paint = `fill="none" stroke-width="${fmt(sw)}"`;
    base = lines.length === 1 ? lines[0].replace('<path ', `<path ${paint} `) : `<g ${paint}>${lines.join('')}</g>`;
  } else {
    const caps = `fill="none" stroke-linecap="${st.cap}" stroke-linejoin="${st.join}"`;
    if (st.outline) {
      const inner = Math.max(0, sw - 2 * o.outline);
      defs.push(`<path id="${P}p" d="${d}" ${caps}/>` +
        `<mask id="${P}m"><use href="#${P}p" stroke="#fff" stroke-width="${fmt(sw)}"/>` +
        (inner > 0 ? `<use href="#${P}p" stroke="#000" stroke-width="${fmt(inner)}"/>` : '') + `</mask>`);
      base = `<rect width="${W}" height="${H}" mask="url(#${P}m)"/>`;
    } else {
      base = `<path d="${d}" ${caps} stroke-width="${fmt(sw)}"/>`;
    }
  }
  const tag = (el: string, attrs: string) => el.replace(/^<(\w+)/, `<$1 ${attrs}`);
  const shc = shortHex(o.shColor);
  let fg = shortHex(o.fg);
  if (o.fgGradient) {
    // user-space coordinates: a bounding-box gradient breaks on zero-width text like "I"
    const [bx0, by0] = T([x0, y0]), [bx1, by1] = T([x1, y1]);
    const a = ((o.fgAngle - 90) * Math.PI) / 180, ux = Math.cos(a), uy = Math.sin(a);
    const cx = (bx0 + bx1) / 2, cy = (by0 + by1) / 2;
    const len = ((bx1 - bx0 + sw) * Math.abs(ux) + (by1 - by0 + sw) * Math.abs(uy)) / 2;
    defs.push(`<linearGradient id="${P}f" gradientUnits="userSpaceOnUse" x1="${fmt(cx - ux * len)}" y1="${fmt(cy - uy * len)}" x2="${fmt(cx + ux * len)}" y2="${fmt(cy + uy * len)}">` +
      `<stop stop-color="${fg}"/><stop offset="1" stop-color="${shortHex(o.fg2)}"/></linearGradient>`);
    fg = `url(#${P}f)`;
  }

  // ---- shadow
  let body: string;
  const op = fmt(o.shOpacity);
  if (o.shadow === 'soft') {
    defs.push(`<filter id="${P}s" x="-50%" y="-50%" width="200%" height="200%">` +
      `<feDropShadow dx="${fmt(o.shX)}" dy="${fmt(o.shY)}" stdDeviation="${fmt(o.shBlur)}" flood-color="${shc}" flood-opacity="${op}"/></filter>`);
    body = `<g filter="url(#${P}s)">${tag(base, `${colorAttr}="${fg}"`)}</g>`;
  } else if (o.shadow === 'hard' || o.shadow === 'long') {
    defs.push(tag(base, `id="${P}t"`));
    const use = (x: number, y: number) => `<use href="#${P}t" x="${fmt(x)}" y="${fmt(y)}"/>`;
    let copies = '';
    if (o.shadow === 'hard') copies = use(o.shX, o.shY);
    else {
      // direction comes from the x/y offsets; length from shLength
      const len = Math.hypot(o.shX, o.shY);
      const ux = len ? o.shX / len : Math.SQRT1_2, uy = len ? o.shY / len : Math.SQRT1_2;
      const n = Math.ceil(o.shLength / 0.5);
      for (let i = n; i >= 1; i--) copies += use(ux * i * 0.5, uy * i * 0.5);
    }
    let clip = '';
    if (o.shadow === 'long' && o.shape !== 'none') {
      defs.push(`<clipPath id="${P}c">${shapeEl('')}</clipPath>`);
      clip = ` clip-path="url(#${P}c)"`;
    }
    body = `<g ${colorAttr}="${shc}" opacity="${op}"${clip}>${copies}</g><use href="#${P}t" ${colorAttr}="${fg}"/>`;
  } else {
    body = tag(base, `${colorAttr}="${fg}"`);
  }

  return { svg: finish(bg + body), strokeWidth: sw, unsupported: L.unsupported };
}
