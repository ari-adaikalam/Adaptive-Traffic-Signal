// Making people, riders, prams, dogs and the share hub's bikes and scooters show at night, as the vehicles do with their lamps. Two things:
//   - a faint light that nothing shades, added to what they are made of (`withNightGlow`): at night the sky and the street light leave a dark coat as dark as the road, so a person in one was a black shape. The glow is a share
//     of each piece's own colour, so a red top is still red and a dark coat is still dark, only lifted enough to read against the road. The page sets its strength (`nightGlow`) from how dark it is.
//   - the light of a vehicle's headlights on whatever stands in the beam (`withNightGlow` for people with `beam`, `withHeadlightBeam` for vehicle bodies), worked out for each point of the surface.
//   - the lamps of a bike and a scooter: a white one in front and a red one behind, lit like a vehicle's (`lampFront` and `lampRear`, set by the page from how much of the lighting is on).
import * as THREE from 'three';

export const nightGlow = { value: 0 };
// The light of a vehicle's headlights on whatever stands in them (a person, a vehicle): the surface is lit where it is inside the cone of a beam, as bright as the beam is there (it fades with the distance
// and toward the edge of the cone, like the picture of the beam on the road), and only on the side that faces the lamp, in its own colour. Up to two beams light a thing at once (an oncoming vehicle and the one
// behind). For each, in view space: the lamp's place, the way it points, and the reach, the spread, a margin across for the lamp that is off the middle, and the strength (0 is off).
// The page keeps the beams of each thing in `userData.beamIn.slots` ({ x, y, z, ax, az, reach, spread, extra, s }, in the world, chosen by headlight-aim.js) and `beamHook` sends them just before the thing is drawn.
const BEAMS = 2;
export const beamUniforms = {
  lamp: { value: Array.from({ length: BEAMS }, () => new THREE.Vector3()) }, axis: { value: Array.from({ length: BEAMS }, () => new THREE.Vector3(0, 0, -1)) },
  info: { value: Array.from({ length: BEAMS }, () => new THREE.Vector4(1, .3, 0, 0)) },
};
const BEAM_DECLARE = `uniform vec3 beamLamp[${BEAMS}];\nuniform vec3 beamAxis[${BEAMS}];\nuniform vec4 beamInfo[${BEAMS}];\n`;
const BEAM_LIGHT = `#include <emissivemap_fragment>
	for (int beamI = 0; beamI < ${BEAMS}; beamI += 1) {
		vec4 beamK = beamInfo[beamI];
		if (beamK.w > 0.0) {
			vec3 beamP = -vViewPosition;
			vec3 beamD = beamP - beamLamp[beamI];
			float beamAlong = dot(beamD, beamAxis[beamI]);
			float beamFar = clamp(beamAlong / beamK.x, 0.0, 1.0);
			float beamHalf = (0.18 + 0.82 * beamFar) * beamK.x * beamK.y * 0.5 + beamK.z;
			float beamAcross = length(beamD - beamAlong * beamAxis[beamI]);
			float beamLit = step(0.0, beamAlong) * pow(1.0 - beamFar, 1.4) * pow(max(1.0 - beamAcross / beamHalf, 0.0), 0.9);
			totalEmissiveRadiance += (diffuseColor.rgb + vec3(0.09)) * vec3(1.0, 0.93, 0.78) * beamK.w * beamLit * max(dot(normalize(normal), normalize(beamLamp[beamI] - beamP)), 0.0);
		}
	}`;
const withBeamUniforms = (shader) => { shader.uniforms.beamLamp = beamUniforms.lamp; shader.uniforms.beamAxis = beamUniforms.axis; shader.uniforms.beamInfo = beamUniforms.info; };
const lampV = new THREE.Vector3(), axisV = new THREE.Vector3();
export function beamHook(renderer, scene, camera, geometry, material) { // set on each piece of a person or a vehicle that a beam can light
  let o = this.parent; while (o && !o.userData.beamIn) o = o.parent;
  const slots = o ? o.userData.beamIn.slots : null;
  let n = 0;
  if (slots) {
    for (const b of slots) {
      if (b.s <= 0.003 || n >= BEAMS) continue;
      lampV.set(b.x, b.y, b.z).applyMatrix4(camera.matrixWorldInverse); axisV.set(b.ax, 0, b.az).transformDirection(camera.matrixWorldInverse);
      beamUniforms.lamp.value[n].copy(lampV); beamUniforms.axis.value[n].copy(axisV); beamUniforms.info.value[n].set(b.reach, b.spread, b.extra, b.s); n += 1;
    }
  }
  for (; n < BEAMS; n += 1) beamUniforms.info.value[n].w = 0;
  material.uniformsNeedUpdate = true; // the uniforms are shared, so they are sent again for each piece
}
export function withHeadlightBeam(material, key) {
  material.onBeforeCompile = (shader) => {
    withBeamUniforms(shader);
    shader.fragmentShader = shader.fragmentShader.replace('void main() {', `${BEAM_DECLARE}void main() {`).replace('#include <emissivemap_fragment>', BEAM_LIGHT);
  };
  material.customProgramCacheKey = () => key;
  return material;
}
export function withNightGlow(material, key = 'night-glow', { beam = false } = {}) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.nightGlow = nightGlow;
    let fragment = shader.fragmentShader.replace('void main() {', `uniform float nightGlow;\n${beam ? BEAM_DECLARE : ''}void main() {`).replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += diffuseColor.rgb * nightGlow;');
    if (beam) { withBeamUniforms(shader); fragment = fragment.replace('#include <emissivemap_fragment>', BEAM_LIGHT); }
    shader.fragmentShader = fragment;
  };
  material.customProgramCacheKey = () => key;
  return material;
}
export const lampFront = new THREE.MeshStandardMaterial({ color: 0xfff6d8, emissive: 0xfff0b8, emissiveIntensity: 0.3, roughness: 0.3 });
export const lampRear = new THREE.MeshStandardMaterial({ color: 0x6b1010, emissive: 0xff2a2a, emissiveIntensity: 0.25, roughness: 0.5 });
export const bikeLampGeometry = { front: new THREE.BoxGeometry(0.07, 0.06, 0.09), rear: new THREE.BoxGeometry(0.06, 0.05, 0.05) };
