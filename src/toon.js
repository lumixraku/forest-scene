import * as THREE from 'three';

// Cel shading in the Genshin / Breath of the Wild mould, applied to whatever
// materials the scene modules already built — no geometry changes at all.
//
// That look is not "posterised realism", it is a specific lighting model:
//
//   1. TWO TONES, split by a hard terminator. Not a gradient with steps in it —
//      a lit plateau and a shadow plateau, with a couple of pixels between.
//   2. WARM LIGHT, COOL SHADOW. The shadow side is not the lit side made
//      darker, it is tinted blue-violet, because it is lit by the sky instead
//      of by the sun. This single split is most of what people read as "the
//      Genshin look".
//   3. RIM LIGHT. A bright edge where a surface turns away from the camera,
//      which is what separates one tree from the tree behind it and stops a
//      forest from reading as mush.
//
// The patch hooks `lights_fragment_end`, where the direct (sun) and indirect
// (sky) contributions are still SEPARATE — that separation is what makes the
// warm/cool split and the hard terminator possible. Patching the final colour
// instead can only quantise the two summed together, which is why the previous
// pass barely showed.
const LIT = new Set(['MeshStandardMaterial', 'MeshPhysicalMaterial', 'MeshLambertMaterial', 'MeshPhongMaterial']);

export function toonify(scene, opts = {}) {
  const p = {
    // where the terminator sits, in "how sun-dominated is this pixel" terms
    edge: 0.26,
    width: 0.04,
    // Shadow side: cool and clearly readable. It is LIFTED, not darkened — in
    // this style the dark half of a tree is a mid-blue-green you can still read
    // every leaf in, which is the opposite of a photographic shadow.
    shadow: new THREE.Color('#a4c0ec'),
    shadowLevel: 1.3,
    // lit side: warm, and flattened onto a plateau
    warm: new THREE.Color('#fff2d2'),
    litBoost: 1.22,
    rim: 0.75,
    rimPower: 2.8,
    rimColor: new THREE.Color('#eaf6ff'),
    sat: 1.42,
    ...opts,
  };

  const done = new Set();
  scene.traverse((obj) => {
    const mats = Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : [];
    for (const mat of mats) {
      if (done.has(mat) || !LIT.has(mat.type)) continue;
      done.add(mat);
      patch(mat, p);
      // a drawn surface has no glossy roll-off
      mat.roughness = 1;
      mat.metalness = 0;
    }
  });
}

function patch(mat, p) {
  const c = (col) => `vec3(${col.r.toFixed(4)}, ${col.g.toFixed(4)}, ${col.b.toFixed(4)})`;

  const chunk = /* glsl */ `
    {
      float dl = dot(reflectedLight.directDiffuse, vec3(0.2126, 0.7152, 0.0722));
      float il = dot(reflectedLight.indirectDiffuse, vec3(0.2126, 0.7152, 0.0722));
      // How sun-dominated this pixel is. Using the RATIO rather than the raw sun
      // level makes the terminator land in the same place on a bright meadow and
      // on dark bark, and keeps it independent of light intensity.
      float t = dl / (dl + il + 1e-4);
      float k = smoothstep(${(p.edge - p.width).toFixed(4)}, ${(p.edge + p.width).toFixed(4)}, t);

      // Flatten the sun's cosine falloff onto a plateau: dividing by t lifts the
      // dimly-lit pixels up to the level of the fully-lit ones, so the lit side
      // becomes one flat tone instead of a gradient.
      vec3 sun = reflectedLight.directDiffuse * min(${p.litBoost.toFixed(3)} * k / max(t, 0.14), 3.2);
      reflectedLight.directDiffuse = sun * ${c(p.warm)};

      // the shadow side is sky-lit, so it goes cool rather than merely dark
      reflectedLight.indirectDiffuse *= mix(${c(p.shadow)} * ${p.shadowLevel.toFixed(3)}, vec3(1.0), k);

      // rim: a bright edge where the surface turns away from the eye, held back
      // in shadow so it reads as light wrapping the form, not as an outline
      float rim = pow(1.0 - clamp(dot(geometryNormal, geometryViewDir), 0.0, 1.0), ${p.rimPower.toFixed(2)});
      reflectedLight.directDiffuse += ${c(p.rimColor)} * (rim * ${p.rim.toFixed(3)} * (0.25 + 0.75 * k)) * diffuseColor.rgb;

      // flat tones read washed out next to a photographic gradient
      vec3 tot = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;
      float grey = dot(tot, vec3(0.2126, 0.7152, 0.0722));
      vec3 boosted = max(mix(vec3(grey), tot, ${p.sat.toFixed(3)}), vec3(0.0));
      reflectedLight.directDiffuse = boosted;
      reflectedLight.indirectDiffuse = vec3(0.0);
    }
  `;

  const prevCompile = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey;
  mat.onBeforeCompile = function (shader, renderer) {
    if (prevCompile) prevCompile.call(this, shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <lights_fragment_end>',
      '#include <lights_fragment_end>\n' + chunk
    );
  };
  // Without folding the previous key in, every material that shared a program
  // before (all the wind foliage) would collapse onto one cached program again.
  mat.customProgramCacheKey = function () {
    return `toon2-${p.edge}-${p.rim}-${prevKey ? prevKey.call(this) : mat.type}`;
  };
  mat.needsUpdate = true;
}
