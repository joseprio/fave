/* Browser-side rasterisation: SVG -> PNG and multi-size ICO. */
export function svgDataUrl(svg) {
    return 'data:image/svg+xml,' + encodeURIComponent(svg);
}
function loadImage(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Could not load SVG'));
        img.src = src;
    });
}
export async function rasterize(svg, size) {
    const img = await loadImage(svgDataUrl(svg));
    const c = document.createElement('canvas');
    c.width = c.height = size;
    c.getContext('2d').drawImage(img, 0, 0, size, size);
    return c;
}
export function canvasToPng(c) {
    return new Promise((resolve, reject) => c.toBlob(b => (b ? resolve(b) : reject(new Error('PNG encode failed'))), 'image/png'));
}
/** ICO container holding PNG images (supported everywhere since Windows Vista). */
export async function buildIco(svg, sizes) {
    const pngs = await Promise.all(sizes.map(async (s) => new Uint8Array(await (await canvasToPng(await rasterize(svg, s))).arrayBuffer())));
    const header = new DataView(new ArrayBuffer(6 + 16 * sizes.length));
    header.setUint16(2, 1, true);
    header.setUint16(4, sizes.length, true);
    let offset = header.byteLength;
    sizes.forEach((s, i) => {
        const e = 6 + 16 * i;
        header.setUint8(e, s >= 256 ? 0 : s);
        header.setUint8(e + 1, s >= 256 ? 0 : s);
        header.setUint16(e + 4, 1, true);
        header.setUint16(e + 6, 32, true);
        header.setUint32(e + 8, pngs[i].byteLength, true);
        header.setUint32(e + 12, offset, true);
        offset += pngs[i].byteLength;
    });
    return new Blob([header.buffer, ...pngs], { type: 'image/x-icon' });
}
