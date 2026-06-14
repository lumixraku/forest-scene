const windMaterials = [];

/**
 * Inject a gentle wind sway into a MeshStandardMaterial used on an InstancedMesh.
 * Only vertices higher up the local Y axis sway, so trunks stay rigid while
 * crowns / grass tips flutter. Per-instance phase comes from instanceMatrix[3].
 */
export function applyWind(material, { strength = 0.3, freq = 1.4, heightFactor = 0.15 } = {}) {
  material.userData.wind = { uniforms: null };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 };
    material.userData.wind.uniforms = shader.uniforms;
    shader.vertexShader = 'uniform float uTime;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       {
         float ph = instanceMatrix[3].x * 0.6 + instanceMatrix[3].z * 0.45;
         float h = transformed.y * ${heightFactor.toFixed(4)};
         transformed.x += sin(uTime * ${freq.toFixed(3)} + ph) * h * ${strength.toFixed(3)};
         transformed.z += cos(uTime * ${(freq * 0.85).toFixed(3)} + ph) * h * ${strength.toFixed(3)};
       }`
    );
  };
  material.customProgramCacheKey = () => `wind-${strength}-${freq}-${heightFactor}`;
  windMaterials.push(material);
  return material;
}

export function updateWind(time) {
  for (const m of windMaterials) {
    const u = m.userData.wind.uniforms;
    if (u) u.uTime.value = time;
  }
}
