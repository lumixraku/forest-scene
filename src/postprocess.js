import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export function createComposer(renderer, scene, camera) {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  // Bloom is a wide soft glow, so its mip chain runs at half resolution — the
  // blur hides the difference, and it halves the fullscreen passes that make up
  // most of the post cost. The setSize override keeps the ratio after a resize;
  // otherwise EffectComposer hands the pass the full drawing-buffer size and
  // the chain silently jumps back to full (device-pixel) resolution.
  const BLOOM_SCALE = 0.5;
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(innerWidth * BLOOM_SCALE, innerHeight * BLOOM_SCALE),
    0.25, // strength
    0.5,  // radius
    0.85  // threshold
  );
  const bloomSetSize = bloom.setSize.bind(bloom);
  bloom.setSize = (w, h) => bloomSetSize(Math.round(w * BLOOM_SCALE), Math.round(h * BLOOM_SCALE));
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  return composer;
}
