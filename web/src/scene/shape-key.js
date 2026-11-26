// What a piece of geometry is, as a short key, for the caches that keep the work of putting pieces together (vehicles.js and people.js).

export function hashNumbers(arrays) { // two 32-bit hashes of the numbers in some typed arrays, joined (a collision would need both to agree)
  let a = 0x811c9dc5, b = 0x1b873593;
  const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
  for (const array of arrays) {
    if (!array) continue;
    for (let i = 0; i < array.length; i += 1) { f32[0] = array[i]; const x = u32[0]; a = Math.imul(a ^ x, 0x01000193); b = Math.imul(b + x, 0x85ebca6b) ^ (b >>> 13); }
    a ^= array.length; b ^= array.length;
  }
  return `${(a >>> 0).toString(36)}${(b >>> 0).toString(36)}`;
}
const builtKeys = new WeakMap(); // a geometry that is used again and again (a tyre) is hashed once
export function geometryKey(geometry) {
  let key = builtKeys.get(geometry);
  if (!key) { key = `${geometry.type}:${hashNumbers([geometry.attributes.position.array, geometry.attributes.normal && geometry.attributes.normal.array, geometry.index && geometry.index.array])}`; builtKeys.set(geometry, key); }
  return key;
}

// A vehicle or person that has left the scene gives back what it had on the graphics card: its own geometry (the colours) and its own lamp materials. The positions and normals are shared with every
// other one built from the same shape, so they are taken off first and stay where they are. Without this, every vehicle that ever appeared keeps its buffers for as long as the page is open.
export function releaseModel(root) {
  root.traverse((o) => {
    const g = o.geometry; if (!g || g.userData.shared) return;
    if (g.userData.sharesShape) { g.deleteAttribute('position'); g.deleteAttribute('normal'); }
    g.dispose();
  });
  const u = root.userData;
  for (const m of [u.tail, u.indL, u.indR, u.siren && u.siren.blue.material, u.siren && u.siren.red.material]) if (m) m.dispose();
}
