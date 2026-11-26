// Soft light textures: the pool of a street lamp, a headlight beam, the glow round the moon. Each is added to the scene, so black adds nothing.
// They are drawn as grey on an opaque black ground, and not as white with a fading alpha. An image with almost-transparent pixels gets coloured noise at its edges in Safari, which showed
// as pink, blue and white specks on the road. A grey value goes through the display's brightness curve and a transparency does not, so `grey` converts the strength we want into the grey
// that gives it, and the picture looks the same as the one made with alpha did.
import * as THREE from 'three';

const CURVE = 1.8; // measured: the mean brightness of the road under the lamp pools came out the same as with the alpha version (40.1 against 40.3), where 1.3 gave 44 and 2.2 gave 38
const grey = (strength, curve = CURVE) => Math.round(255 * Math.pow(Math.min(1, Math.max(0, strength)), curve));
// For light that has to add up, such as the wash along a street, the curve is the one that makes the light on the screen proportional to the strength on the texture, so that two strengths that
// sum to one on the texture sum to one on the screen as well. Measured from the road under the wash: the light added is the grey value to the power 0.79, so the curve is 1 / 0.79.
export const ADDITIVE_CURVE = 1.27;

// A texture of `width` by `height` where `strength(u, v)` is how much light it adds at that spot, from 0 to 1, with u and v from 0 to 1.
export function lightTexture(width, height, strength, curve = CURVE) {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const g = canvas.getContext('2d'), image = g.createImageData(width, height);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const i = (y * width + x) * 4, v = grey(strength((x + 0.5) / width, (y + 0.5) / height), curve);
    image.data[i] = image.data[i + 1] = image.data[i + 2] = v; image.data[i + 3] = 255;
  }
  g.putImageData(image, 0, 0);
  return new THREE.CanvasTexture(canvas);
}

// A round fade: `stops` is [[distance from the middle, from 0 at the middle to 1 at the edge, strength], ...] in order, and beyond the last one it is dark.
export const roundFade = (size, stops, curve = CURVE) => lightTexture(size, size, (u, v) => {
  const r = Math.hypot(u - 0.5, v - 0.5) * 2;
  for (let i = 1; i < stops.length; i += 1) if (r <= stops[i][0]) { const [r0, s0] = stops[i - 1], [r1, s1] = stops[i]; return s0 + (s1 - s0) * ((r - r0) / (r1 - r0)); }
  return 0;
}, curve);
