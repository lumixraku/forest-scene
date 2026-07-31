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
    // Where the terminator sits, in "how sun-dominated is this pixel" terms.
    // The sky fill is much stronger now than when these were tuned, so `t` runs
    // lower across the whole frame and the edge has to come down with it or the
    // lit plateau shrinks to the few surfaces facing the sun dead-on.
    edge: 0.2,
    // Wider than a knife edge. A 0.04 terminator on every leaf mass is what tips
    // the look from painterly into flat cartoon; 0.1 still separates the two
    // tones but lets the turn read as a form turning.
    width: 0.1,
    // Shadow side: cool and clearly readable. It is LIFTED, not darkened — in
    // this style the dark half of a tree is a mid-blue-green you can still read
    // every leaf in, which is the opposite of a photographic shadow.
    // Cool, but not as blue as it was. #9fb8e8 has enough chroma that it turns
    // brown into violet, and since a trunk's whole value comes from this term
    // every trunk in the frame read as a cold purple bar. Pulling the chroma
    // down keeps the crowns' shadow side reading as sky-lit without repainting
    // the wood.
    shadow: new THREE.Color('#b4bfdb'),
    // Lifted from 1.25. A trunk stands inside its own crown's cast shadow, so it
    // receives no sun at all and its entire value comes from this term — at 1.25
    // the trunks read as black bars between the crowns.
    shadowLevel: 1.5,
    // lit side: warm gold, matching the low sun rather than a white noon one
    warm: new THREE.Color('#ffe6b8'),
    litBoost: 1.16,
    // Rim, warm now instead of cool white. With the sun low and ahead this is
    // doing backlight — the gold edge on a crown against the sky — so a cool rim
    // fought the light direction and read as a drawn outline.
    rim: 0.62,
    rimPower: 2.4,
    rimColor: new THREE.Color('#ffdca4'),
    // 1.42 was pushing the greens to poster paint. The colour now comes from the
    // warm/cool light split, which does not need help from a saturation boost.
    sat: 1.15,
    // Minimum fraction of a surface's own albedo that survives with no light on
    // it at all. 0 for everything by default — an unlit rock SHOULD go dark. The
    // canopy overrides it (see below) because leaves are translucent.
    floor: 0,
    ...opts,
  };

  const done = new Set();
  scene.traverse((obj) => {
    const mats = Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : [];
    for (const mat of mats) {
      if (done.has(mat) || !LIT.has(mat.type)) continue;
      done.add(mat);
      // Leaves are translucent: a leaf with the sun behind it glows rather than
      // going black, and the inner wall of a pierced crown is exactly that case —
      // it faces away from the key and would otherwise be lit by the sky term
      // alone. `floor` stands in for the transmission, keeping those surfaces at a
      // mid tone. Measured effect on the frame's near-black share is small (~0.5
      // points); it earns its place on the near crowns, where the alternative is
      // dark pits between the leaf clusters.
      patch(mat, mat.userData.canopy ? { ...p, shadowLevel: p.shadowLevel * 1.2, floor: 0.34 } : p);
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

      // Translucency floor. Leaves are thin and let light through, so a leaf
      // surface with the sun behind it glows instead of going black — which is
      // what the inner wall of a pierced crown is doing. Without this the holes
      // in the canopy read as black specks and undo the openwork.
      reflectedLight.indirectDiffuse += diffuseColor.rgb * ${p.floor.toFixed(3)};

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
    return `toon2-${p.edge}-${p.rim}-${p.floor}-${p.shadowLevel}-${prevKey ? prevKey.call(this) : mat.type}`;
  };
  mat.needsUpdate = true;
}
