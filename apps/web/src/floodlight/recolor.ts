/**
 * Repaint the key-blue kit (#1F3BFF) of a hero illustration in a club colour.
 *
 * The hero-*-keyblue.png files have the shirt (and only the shirt) painted in
 * a saturated blue. Every pixel whose hue sits in the key band is repainted:
 * the target colour keeps the pixel's own light (its value relative to the
 * key blue), so the pixel shading survives. White, cream and very dark kits
 * work too, because the light is applied to the target colour, not to its hue.
 *
 * Pure function on RGBA bytes, so it runs in a browser canvas, a worker or a
 * test. Run it once per club and cache the result (an object URL or a
 * Map<clubColour, string>), never per frame.
 */
export function recolorKit(rgba: Uint8ClampedArray, targetHex: string): Uint8ClampedArray {
  const t = hexToRgb(targetHex);
  const out = new Uint8ClampedArray(rgba);
  for (let i = 0; i < out.length; i += 4) {
    if (out[i + 3]! < 8) continue;
    const r = out[i]!, g = out[i + 1]!, b = out[i + 2]!;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const v = max / 255;
    const s = max === 0 ? 0 : (max - min) / max;
    if (s < 0.35 || v < 0.12) continue; // outlines, skin, whites: untouched
    const h = hue(r, g, b, max, min);
    if (h < 205 || h > 260) continue; // not the key blue
    // Light of this pixel relative to a mid-lit key blue: shadows < 1 < highlights.
    const light = v / 0.9;
    // Desaturated key pixels are highlights: blend toward white by the lost saturation.
    const lift = Math.max(0, 0.85 - s);
    for (let c = 0; c < 3; c++) {
      const base = t[c]! * Math.min(light, 1.25);
      out[i + c] = Math.round(base + (255 - base) * lift);
    }
  }
  return out;
}

/** Browser helper: load an image, recolour it, return an object URL (cache it). */
export async function recolorKitUrl(src: string, targetHex: string): Promise<string> {
  const img = new Image();
  img.src = src;
  await img.decode();
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, c.width, c.height);
  data.data.set(recolorKit(data.data, targetHex));
  ctx.putImageData(data, 0, 0);
  const blob = await new Promise<Blob>((ok) => c.toBlob((b) => ok(b!), "image/png"));
  return URL.createObjectURL(blob);
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function hue(r: number, g: number, b: number, max: number, min: number): number {
  const d = max - min;
  if (d === 0) return 0;
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}
