# Fave

Text or icons → tiny, self-contained SVG favicons. Runs 100% in the browser; nothing is uploaded.

Live tool: served from `docs/` via GitHub Pages (Settings → Pages → Deploy from branch → `main` / `/docs`).

## Why custom fonts?

SVG fonts are dead in Chrome/Firefox, and a favicon rendered as an image can't load web fonts — `<text>`
would fall back to whatever system font the visitor has. So Fave ships its own tiny fonts and converts
every glyph to plain path data:

| Style   | How it's drawn                                                     |
|---------|--------------------------------------------------------------------|
| Round   | centre-line strokes, round caps/joins (like hand-made icons)       |
| Sharp   | same skeleton, square-cut ends (flat on cap line / baseline), mitred joins |
| Octo    | arcs replaced by 45° chamfers (tangent polygon), cut like Sharp    |
| Outline | stroke masked by a thinner stroke → hollow letters                 |
| Pixel   | 5×7 bitmap font, traced to one outline; can snap to a 16/32px grid |

Supported characters: `A–Z 0–9 ! ? . , : ' - + = * # / ( )` (Pixel also has `& @`). Lowercase is
upper-cased and accents are stripped.

## Icons

Icon mode offers a hand-picked selection of ~230 [Material Symbols](https://fonts.google.com/icons)
(Google, Apache 2.0) that read well at favicon sizes, in outlined / rounded / sharp, filled or not.
They're bundled in `docs/icons.json` (loaded the first time icon mode opens, nothing else is fetched);
their path data is re-parsed and fitted like text, so colours, gradients, shadows and backgrounds all
apply.

To change the selection, edit `scripts/icon-list.txt` and rebuild the bundle:

```sh
node scripts/icons.mjs   # fetches from jsDelivr / Google's icon metadata
```

## Development

```sh
npm install
npm run watch   # tsc -> docs/js
npm run serve   # http://localhost:8080
```

`src/` is TypeScript; the compiled `docs/js/` is committed so Pages can serve it without a build step.
Run `npm run build` before committing.

- `src/fonts.ts` – glyph data
- `src/engine.ts` – layout, fit-to-box, shadows, SVG serialisation (no DOM use; also runs in Node)
- `src/icons.ts` – bundled Material Symbols: loading and search
- `src/raster.ts` – PNG / ICO export via canvas
- `src/app.ts` – UI
