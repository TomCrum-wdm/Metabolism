import * as THREE from 'three/webgpu';
import {
  Fn,
  If,
  Loop,
  abs,
  cameraPosition,
  cameraProjectionMatrix,
  cameraProjectionMatrixInverse,
  cameraViewMatrix,
  cameraWorldMatrix,
  clamp as tslClamp,
  cos,
  dot,
  exp,
  float,
  floor,
  fract,
  getScreenPosition,
  getViewPosition,
  int,
  isBackgroundDepth,
  length,
  log2,
  max,
  min,
  mix,
  normalWorld,
  normalWorldGeometry,
  normalize,
  pow,
  positionWorld,
  screenUV,
  select,
  sin,
  smoothstep,
  sqrt,
  step,
  transformNormalToView,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';

export interface TerrainSubVoxelPbrParams {
  isBlockyNode: THREE.UniformNode<'float'>;
  voxelEdgesNode: THREE.UniformNode<'float'>;
  pbrEnhancedNode: THREE.UniformNode<'float'>;
  pbrReliefDepthNode: THREE.UniformNode<'float'>;
  nativeVoxelSizeNode: THREE.UniformNode<'float'>;
  sunDirNode: THREE.UniformNode<'vec3'>;
  matPropsNode: THREE.Node<'vec3'>;
}

export interface TerrainSubVoxelPbrBundle {
  /** Shared cached relief evaluation: vec4(gradU, gradV, heightHit, selfShadow) */
  reliefNode: THREE.Node<'vec4'>;
  normalNode: THREE.Node<'vec3'>;
  aoNode: THREE.Node<'float'>;
  applyAlbedoPbr: (baseColor: THREE.Node<'vec3'>) => THREE.Node<'vec3'>;
  roughnessNode: THREE.Node<'float'>;
  clearcoatNode: THREE.Node<'float'>;
  emissiveBoostNode: THREE.Node<'float'>;
}

/**
 * Reusable TSL function: deterministic sub-voxel heightfield generator in [0, 1].
 * Strictly hashes integer cell IDs (zero intra-cell hash chatter) and uses smoothstep chamfered
 * block bevels plus closeup-only 2x2 micro-caps gated by analytical footprint detailFade.
 */
const sampleSubVoxelHeightfieldFn = Fn(
  ([coord, tileShift, roughMat, glowMat, detailFade]: [
    THREE.Node<'vec2'>,
    THREE.Node<'vec2'>,
    THREE.Node<'float'>,
    THREE.Node<'float'>,
    THREE.Node<'float'>,
  ]) => {
    // Tier 1: Primary protruding sub-voxel blocks (strictly constant height per integer cell)
    const id1 = floor(coord).add(tileShift);
    const f1 = fract(coord);
    const h1 = fract(sin(dot(id1, vec2(127.1, 311.7))).mul(43758.5453));
    const h2 = fract(sin(dot(id1, vec2(269.5, 183.3))).mul(29431.71));

    // Crisp terrace separation so protruding blocks stand cleanly above recessed seams
    const isProtruding = step(0.38, h1);
    const pillarTop = mix(
      float(0.14).add(h2.mul(0.20)),
      float(0.62).add(h1.mul(0.38)),
      isProtruding,
    );

    const dEdge = min(
      min(f1.x, float(1.0).sub(f1.x)),
      min(f1.y, float(1.0).sub(f1.y)),
    );
    // Crystal uses faceted pyramid bevels; stone/basalt uses clean chamfered architectural steps
    const crystalFactor = smoothstep(0.2, 0.55, glowMat);
    const organicFactor = smoothstep(0.85, 0.90, roughMat).mul(float(1.0).sub(crystalFactor));
    const bevelW = mix(float(0.17), float(0.34), crystalFactor).add(organicFactor.mul(0.07));

    const rimMask = smoothstep(0.045, bevelW, dEdge);
    const crown = smoothstep(0.14, 0.48, dEdge).mul(
      mix(float(0.05), float(0.22), crystalFactor),
    );
    const tier1 = pillarTop.mul(rimMask).add(crown.mul(isProtruding));

    // Tier 2: Closeup-only nested 2x2 micro-caps (faded smoothly before Nyquist aliasing)
    const coord2 = coord.mul(2.0).add(vec2(3.0, 7.0));
    const id2 = floor(coord2).add(tileShift.mul(2.0));
    const f2 = fract(coord2);
    const hMicro = fract(sin(dot(id2, vec2(113.5, 271.9))).mul(19384.23));
    const dEdge2 = min(
      min(f2.x, float(1.0).sub(f2.x)),
      min(f2.y, float(1.0).sub(f2.y)),
    );
    const studMask = smoothstep(0.075, 0.24, dEdge2);
    const tier2 = studMask.mul(step(0.48, hMicro)).mul(0.16).mul(detailFade);

    return tslClamp(tier1.mul(0.84).add(tier2), 0.0, 1.0);
  },
);

/**
 * Reusable TSL function: evaluates height at deltaCoord in either blocky 4x4 mode or
 * dual-octave distance-adaptive triplanar mode.
 */
const sampleReliefHeightFn = Fn(
  ([
    deltaCoord,
    blockCoord,
    smoothCoord0,
    smoothCoord1,
    octBlend,
    isBlockyF,
    roughMat,
    glowMat,
    detailFade,
  ]: [
    THREE.Node<'vec2'>,
    THREE.Node<'vec2'>,
    THREE.Node<'vec2'>,
    THREE.Node<'vec2'>,
    THREE.Node<'float'>,
    THREE.Node<'float'>,
    THREE.Node<'float'>,
    THREE.Node<'float'>,
    THREE.Node<'float'>,
  ]) => {
    const outH = float(0.0).toVar();
    If(isBlockyF.greaterThan(0.5), () => {
      const cB = tslClamp(blockCoord.add(deltaCoord), vec2(0.015), vec2(3.985));
      outH.assign(
        sampleSubVoxelHeightfieldFn(cB, vec2(0.0, 0.0), roughMat, glowMat, detailFade),
      );
    }).Else(() => {
      const hS0 = sampleSubVoxelHeightfieldFn(
        smoothCoord0.add(deltaCoord),
        vec2(0.0, 0.0),
        roughMat,
        glowMat,
        detailFade,
      );
      const hS1 = sampleSubVoxelHeightfieldFn(
        smoothCoord1.add(deltaCoord.mul(0.5)),
        vec2(17.0, 29.0),
        roughMat,
        glowMat,
        detailFade,
      );
      outH.assign(mix(hS0, hS1, octBlend));
    });
    return outH;
  },
);

/**
 * Computes tangent axes (T, B) and dual-mode (blocky 4x4 face UV vs distance-adaptive
 * triplanar) sub-voxel basis using unperturbed geometry world normals.
 */
function computeTangentBasis(baseN: THREE.Node<'vec3'>, isBlockyF: THREE.Node<'float'>) {
  const absN = abs(baseN);
  const useX = absN.x.greaterThan(absN.y).and(absN.x.greaterThan(absN.z));
  const useY = absN.y.greaterThan(absN.x).and(absN.y.greaterThan(absN.z));

  const sx = select(baseN.x.greaterThan(0.0), float(1.0), float(-1.0));
  const sy = select(baseN.y.greaterThan(0.0), float(1.0), float(-1.0));
  const sz = select(baseN.z.greaterThan(0.0), float(1.0), float(-1.0));

  const T_blocky = select(
    useX,
    vec3(0.0, 0.0, sx.negate()),
    select(useY, vec3(1.0, 0.0, 0.0), vec3(sz, 0.0, 0.0)),
  );
  const B_blocky = select(
    useX,
    vec3(0.0, 1.0, 0.0),
    select(useY, vec3(0.0, 0.0, sy.negate()), vec3(0.0, 1.0, 0.0)),
  );

  const T_axis = select(useX, vec3(0.0, 0.0, 1.0), vec3(1.0, 0.0, 0.0));
  const B_axis = select(useY, vec3(0.0, 0.0, 1.0), vec3(0.0, 1.0, 0.0));
  const T_smooth = normalize(T_axis.sub(baseN.mul(dot(T_axis, baseN))));
  const B_smooth = normalize(B_axis.sub(baseN.mul(dot(B_axis, baseN))));

  const isBlocky = isBlockyF.greaterThan(0.5);
  const T = select(isBlocky, T_blocky, T_smooth);
  const B = select(isBlocky, B_blocky, B_smooth);

  return { T, B, T_axis, B_axis, isBlocky };
}

/**
 * Clean Denoised Sub-Voxel Relief PBR system:
 * - Analytical world-space + view-angle Nyquist anti-aliasing (zero dFdx/dFdy uniformity hazards)
 * - 8-step Parallax Occlusion Mapping (POM) with secant refinement for crisp 3D protrusion
 * - 4-step directional sun self-shadowing across raised sub-voxel blocks
 * - Wide-stencil bevel slope normals + coupled Cavity AO & plateau specular polish
 */
export function buildTerrainSubVoxelPbrBundle(
  params: TerrainSubVoxelPbrParams,
): TerrainSubVoxelPbrBundle {
  const {
    isBlockyNode,
    voxelEdgesNode,
    pbrEnhancedNode,
    pbrReliefDepthNode,
    nativeVoxelSizeNode,
    sunDirNode,
    matPropsNode,
  } = params;

  // Shared fragment evaluation returning vec4(gradU, gradV, heightHit, selfShadow)
  const reliefNode = Fn(() => {
    const baseN = normalize(normalWorldGeometry).toVar();
    const roughMat = matPropsNode.x.toVar();
    const glowMat = matPropsNode.z.toVar();
    const isBlockyF = isBlockyNode.toVar();
    const basis = computeTangentBasis(baseN, isBlockyF);
    const T = basis.T.toVar();
    const B = basis.B.toVar();

    const p = positionWorld;
    const viewVec = cameraPosition.sub(p);
    const camDist = length(viewVec).toVar();
    const viewDir = viewVec.div(max(camDist, float(1e-5))).toVar();
    const nDotV = dot(viewDir, baseN).toVar();

    // Distance-adaptive triplanar octave selection
    const baseSubSize = max(nativeVoxelSizeNode.mul(0.25), float(1e-5)).toVar();
    const targetCell = max(baseSubSize, camDist.mul(0.022));
    const octF = log2(max(targetCell.div(baseSubSize), 1.0));
    const oct0 = floor(octF);
    const octBlend = smoothstep(0.2, 0.8, fract(octF)).toVar();
    const cellSize0 = baseSubSize.mul(pow(float(2.0), oct0)).toVar();

    const proj2D = vec2(dot(p, basis.T_axis), dot(p, basis.B_axis));
    const smoothCoord0 = proj2D.div(cellSize0).toVar();
    const smoothCoord1 = smoothCoord0.mul(0.5).toVar();
    const blockCoord = uv().mul(4.0).toVar();

    // Analytical Nyquist anti-aliasing (stage-safe & uniform-safe across WebGPU & WebGL2)
    const activeCellSize = select(basis.isBlocky, baseSubSize, cellSize0);
    const pixelWorld = camDist.mul(0.00135);
    const cellFootprint = pixelWorld.div(
      max(activeCellSize.mul(max(abs(nDotV), 0.25)), float(1e-5)),
    );
    const reliefAa = smoothstep(0.75, 0.16, cellFootprint).toVar();
    const tier2Aa = smoothstep(0.30, 0.08, cellFootprint).toVar();

    const activeRelief = tslClamp(pbrReliefDepthNode, 0.0, 2.2)
      .mul(tslClamp(pbrEnhancedNode, 0.0, 1.0))
      .mul(reliefAa)
      .toVar();

    const outResult = vec4(0.0, 0.0, 0.76, 1.0).toVar();

    If(activeRelief.greaterThan(0.015), () => {
      const vz = max(nDotV, 0.30);
      const grazingFade = smoothstep(0.08, 0.28, nDotV);
      const pomDepth = activeRelief.mul(0.19).mul(grazingFade).toVar();

      const vTan = vec2(dot(viewDir, T), dot(viewDir, B));
      const maxOffset = vTan.negate().div(vz).mul(pomDepth).toVar();

      const h0 = sampleReliefHeightFn(
        vec2(0.0, 0.0),
        blockCoord,
        smoothCoord0,
        smoothCoord1,
        octBlend,
        isBlockyF,
        roughMat,
        glowMat,
        tier2Aa,
      ).toVar();

      const prevH = float(0.0).toVar();
      prevH.assign(h0);
      const prevRayH = float(1.0).toVar();
      const currH = float(0.0).toVar();
      currH.assign(h0);
      const currRayH = float(1.0).toVar();
      const hitStep = float(0.0).toVar();
      const found = float(0.0).toVar();

      // 8-step Parallax Occlusion Ray-March with secant hit interpolation
      Loop(8, ({ i }) => {
        If(found.lessThan(0.5), () => {
          const tFrac = float(i).add(1.0).mul(0.125);
          const rayNext = float(1.0).sub(tFrac);
          const sampleH = sampleReliefHeightFn(
            maxOffset.mul(tFrac),
            blockCoord,
            smoothCoord0,
            smoothCoord1,
            octBlend,
            isBlockyF,
            roughMat,
            glowMat,
            tier2Aa,
          );
          If(sampleH.greaterThanEqual(rayNext), () => {
            currH.assign(sampleH);
            currRayH.assign(rayNext);
            hitStep.assign(tFrac);
            found.assign(1.0);
          }).Else(() => {
            prevH.assign(sampleH);
            prevRayH.assign(rayNext);
          });
        });
      });

      const afterDepth = max(currH.sub(currRayH), 0.0);
      const beforeDepth = max(prevRayH.sub(prevH), 0.0);
      const denom = max(afterDepth.add(beforeDepth), 0.0002);
      const secantWeight = tslClamp(afterDepth.div(denom), 0.0, 1.0);
      const refinedFrac = select(
        found.greaterThan(0.5),
        hitStep.sub(float(0.125).mul(secantWeight)),
        float(0.0),
      );

      const pomDelta = maxOffset.mul(refinedFrac).toVar();
      const hRawHit = sampleReliefHeightFn(
        pomDelta,
        blockCoord,
        smoothCoord0,
        smoothCoord1,
        octBlend,
        isBlockyF,
        roughMat,
        glowMat,
        tier2Aa,
      );
      const hHit = mix(float(0.76), hRawHit, reliefAa).toVar();

      // Clean beveled central-difference gradients on parallax-hit heightfield
      const eps = float(0.032);
      const hR = sampleReliefHeightFn(
        pomDelta.add(vec2(eps, 0.0)),
        blockCoord,
        smoothCoord0,
        smoothCoord1,
        octBlend,
        isBlockyF,
        roughMat,
        glowMat,
        tier2Aa,
      );
      const hL = sampleReliefHeightFn(
        pomDelta.sub(vec2(eps, 0.0)),
        blockCoord,
        smoothCoord0,
        smoothCoord1,
        octBlend,
        isBlockyF,
        roughMat,
        glowMat,
        tier2Aa,
      );
      const hU = sampleReliefHeightFn(
        pomDelta.add(vec2(0.0, eps)),
        blockCoord,
        smoothCoord0,
        smoothCoord1,
        octBlend,
        isBlockyF,
        roughMat,
        glowMat,
        tier2Aa,
      );
      const hD = sampleReliefHeightFn(
        pomDelta.sub(vec2(0.0, eps)),
        blockCoord,
        smoothCoord0,
        smoothCoord1,
        octBlend,
        isBlockyF,
        roughMat,
        glowMat,
        tier2Aa,
      );

      const slopeGain = activeRelief.mul(1.9);
      const gradU = tslClamp(hR.sub(hL).div(eps.mul(2.0)).mul(slopeGain), -2.6, 2.6);
      const gradV = tslClamp(hU.sub(hD).div(eps.mul(2.0)).mul(slopeGain), -2.6, 2.6);

      // 4-step tangent-space directional sun self-shadowing across raised sub-voxel pillars
      const lz = dot(sunDirNode, baseN);
      const shadowOcc = float(0.0).toVar();
      If(lz.greaterThan(0.02), () => {
        const lTan = vec2(dot(sunDirNode, T), dot(sunDirNode, B));
        const shadowDir = lTan.div(max(lz, 0.25)).mul(pomDepth).toVar();
        Loop(4, ({ i }) => {
          const k = float(i).add(1.0).mul(0.24);
          const sH = sampleReliefHeightFn(
            pomDelta.add(shadowDir.mul(k)),
            blockCoord,
            smoothCoord0,
            smoothCoord1,
            octBlend,
            isBlockyF,
            roughMat,
            glowMat,
            tier2Aa,
          );
          const rayMinH = hHit.add(k.mul(0.88));
          const occ = max(sH.sub(rayMinH), 0.0).mul(float(1.1).sub(k.mul(0.6)));
          shadowOcc.assign(max(shadowOcc, occ));
        });
      });

      const sunFacing = smoothstep(-0.04, 0.22, lz);
      const selfShadow = float(1.0).sub(
        tslClamp(shadowOcc.mul(1.85), 0.0, 0.48).mul(sunFacing).mul(reliefAa),
      );

      outResult.assign(vec4(gradU, gradV, hHit, selfShadow));
    });

    return outResult;
  })();

  // Perturbed view-space normal combining sub-voxel bevel slopes + outer voxel quad bevel
  const normalNode = Fn(() => {
    const baseN = normalize(normalWorldGeometry);
    const basis = computeTangentBasis(baseN, isBlockyNode);

    const rel = reliefNode;
    const relievedWorld = baseN.sub(basis.T.mul(rel.x)).sub(basis.B.mul(rel.y));

    const blockUv = uv();
    const uCentered = blockUv.x.sub(0.5);
    const vCentered = blockUv.y.sub(0.5);
    const edgeDist = min(
      min(blockUv.x, float(1.0).sub(blockUv.x)),
      min(blockUv.y, float(1.0).sub(blockUv.y)),
    );
    const bevelWeight = float(1.0)
      .sub(smoothstep(0.0, 0.09, edgeDist))
      .mul(voxelEdgesNode)
      .mul(isBlockyNode)
      .mul(tslClamp(pbrEnhancedNode, 0.0, 1.0));
    const bevelPerturb = basis.T
      .mul(uCentered)
      .add(basis.B.mul(vCentered))
      .mul(bevelWeight)
      .mul(0.45);

    const finalWorldN = normalize(relievedWorld.add(bevelPerturb));
    return normalize(transformNormalToView(finalWorldN));
  })();

  // Clean Ambient occlusion tied smoothly to sub-voxel recess depth
  const aoNode = Fn(() => {
    const active = min(
      tslClamp(pbrEnhancedNode, 0.0, 1.0),
      tslClamp(pbrReliefDepthNode, 0.0, 1.2),
    );
    const hHit = reliefNode.z;
    const cavityAo = tslClamp(mix(float(0.46), float(1.02), pow(hHit, float(0.75))), 0.44, 1.0);
    return mix(float(1.0), cavityAo, active);
  })();

  // Balanced Albedo modulation: tactile raised caps, soft crevices & directional sun self-shadow
  const applyAlbedoPbr = (baseColor: THREE.Node<'vec3'>): THREE.Node<'vec3'> => {
    const active = min(
      tslClamp(pbrEnhancedNode, 0.0, 1.0),
      tslClamp(pbrReliefDepthNode, 0.0, 1.0),
    );
    const rel = reliefNode;
    const hHit = rel.z;
    const selfShadow = rel.w;

    const heightTone = mix(float(0.80), float(1.08), smoothstep(0.10, 0.90, hHit));
    const slopeMag = tslClamp(length(vec2(rel.x, rel.y)).mul(0.09), 0.0, 0.08);
    const toned = baseColor.mul(heightTone.add(slopeMag)).mul(selfShadow);
    return mix(baseColor, toned, active).saturate();
  };

  // Smooth plateau polish vs matte crevices (free of high-freq world-space trig grain)
  const roughnessNode = Fn(() => {
    const active = tslClamp(pbrEnhancedNode, 0.0, 1.0);
    const hHit = reliefNode.z;
    const reliefRoughShift = mix(float(0.12), float(-0.12), smoothstep(0.25, 0.85, hHit));
    return tslClamp(
      matPropsNode.x.add(reliefRoughShift.mul(active)),
      0.04,
      0.98,
    );
  })();

  // Crystal & ice glassy clearcoat + subtle mineral specular glaze on raised stone tops
  const clearcoatNode = Fn(() => {
    const glassCoat = float(1.0).sub(smoothstep(0.18, 0.28, matPropsNode.x)).mul(0.92);
    const mineralCapCoat = smoothstep(0.66, 0.94, reliefNode.z).mul(0.18);
    return tslClamp(max(glassCoat, mineralCapCoat).mul(pbrEnhancedNode), 0.0, 1.0);
  })();

  // Emissive crystal vein boost inside sub-voxel ridges & crevices
  const emissiveBoostNode = Fn(() => {
    const hHit = reliefNode.z;
    const slope = tslClamp(length(vec2(reliefNode.x, reliefNode.y)).mul(0.18), 0.0, 0.42);
    return float(1.0).add(hHit.mul(0.32)).add(slope);
  })();

  return {
    reliefNode,
    normalNode,
    aoNode,
    applyAlbedoPbr,
    roughnessNode,
    clearcoatNode,
    emissiveBoostNode,
  };
}

/**
 * Generates an animated spherical multi-octave ocean wave normal node for physical water reflections.
 */
export function buildWaterWaveNormalNode(params: {
  simTimeNode: THREE.UniformNode<'float'>;
  windSpeedNode: THREE.UniformNode<'float'>;
  pbrEnhancedNode: THREE.UniformNode<'float'>;
}): THREE.Node<'vec3'> {
  const { simTimeNode, windSpeedNode, pbrEnhancedNode } = params;

  return Fn(() => {
    const p = positionWorld;
    const baseN = normalize(normalWorld);
    const t = simTimeNode.mul(tslClamp(windSpeedNode, 0.25, 3.0).mul(0.75).add(0.45));

    // Analytical wave derivatives across 3 directional harmonics
    const f1 = float(3.1);
    const f2 = float(7.4);
    const dwx = cos(p.x.mul(f1).add(t.mul(2.1)))
      .mul(0.45)
      .add(cos(p.x.mul(f2).sub(p.z.mul(4.5)).add(t.mul(3.4))).mul(0.28));
    const dwy = cos(p.y.mul(f1).sub(t.mul(1.8)))
      .mul(0.4)
      .add(cos(p.y.mul(f2).add(p.x.mul(3.8)).sub(t.mul(2.9))).mul(0.24));
    const dwz = cos(p.z.mul(f1).add(t.mul(2.4)))
      .mul(0.45)
      .add(cos(p.z.mul(f2).add(p.y.mul(4.1)).add(t.mul(3.1))).mul(0.28));

    const grad = vec3(dwx, dwy, dwz);
    const tangentGrad = grad.sub(baseN.mul(dot(grad, baseN)));
    const amp = float(0.14).mul(tslClamp(pbrEnhancedNode, 0.0, 1.0));
    const waveWorld = normalize(baseN.add(tangentGrad.mul(amp)));
    return normalize(transformNormalToView(waveWorld));
  })();
}

export interface VolumetricAtmoCompositeParams {
  colorNode: THREE.Node<'vec4'>;
  depthNode: THREE.TextureNode;
  sunDirNode: THREE.UniformNode<'vec3'>;
  planetRadiusNode: THREE.UniformNode<'float'>;
  atmoEnabledNode: THREE.UniformNode<'float'>;
  atmoDensityNode: THREE.UniformNode<'float'>;
  rayleighNode: THREE.UniformNode<'float'>;
  mieNode: THREE.UniformNode<'float'>;
  scaleHeightNode: THREE.UniformNode<'float'>;
  volFogEnabledNode: THREE.UniformNode<'float'>;
  atmoScatterEnabledNode: THREE.UniformNode<'float'>;
  volStepsNode: THREE.UniformNode<'float'>;
  contactShadowNode: THREE.UniformNode<'float'>;
}

/**
 * Post-processing physical spherical atmospheric scattering (Rayleigh + Mie + twilight ozone)
 * with height-exponential volumetric fog, aerial perspective, and optional screen-space ray-marched
 * micro contact shadows toward sunDir.
 */
export function buildVolumetricAtmoCompositeNode(
  params: VolumetricAtmoCompositeParams,
): THREE.Node<'vec4'> {
  const {
    colorNode,
    depthNode,
    sunDirNode,
    planetRadiusNode,
    atmoEnabledNode,
    atmoDensityNode,
    rayleighNode,
    mieNode,
    scaleHeightNode,
    volFogEnabledNode,
    atmoScatterEnabledNode,
    volStepsNode,
    contactShadowNode,
  } = params;

  return Fn(() => {
    const uvCoord = screenUV;
    const baseSample = colorNode;
    const depth = depthNode.sample(uvCoord).x;
    const isSky = isBackgroundDepth(depth);

    // Safe view position reconstruction (avoid precision blowup at depth=1.0 on sky pixels)
    const sampleDepthSafe = isSky.select(float(0.92), depth);
    const viewPos = getViewPosition(uvCoord, sampleDepthSafe, cameraProjectionMatrixInverse);
    const worldPoint = cameraWorldMatrix.mul(vec4(viewPos, 1.0)).xyz;
    const camPos = cameraPosition;
    const rayVec = worldPoint.sub(camPos);
    const rayDir = normalize(rayVec);
    const hitDist = isSky.select(float(1e6), length(rayVec));

    const outRgb = baseSample.rgb.toVar();

    // 1. Screen-Space Ray-Marched Micro Contact Shadows (active on non-sky terrain when enabled)
    If(isSky.not().and(contactShadowNode.greaterThan(0.01)), () => {
      const sunView = normalize(
        cameraViewMatrix.mul(vec4(sunDirNode, 0.0)).xyz,
      );
      const stepWorldLen = max(planetRadiusNode.mul(0.0025), length(viewPos).mul(0.0045));
      const shadowOcc = float(0.0).toVar();
      const marchPos = viewPos.toVar();

      Loop(8, ({ i }) => {
        const fi = float(i).add(1.0);
        marchPos.assign(viewPos.add(sunView.mul(stepWorldLen.mul(fi))));
        const sUv = getScreenPosition(marchPos, cameraProjectionMatrix);
        const inside = sUv.x
          .greaterThan(0.002)
          .and(sUv.x.lessThan(0.998))
          .and(sUv.y.greaterThan(0.002))
          .and(sUv.y.lessThan(0.998));

        If(inside, () => {
          const sDepth = depthNode.sample(sUv).x;
          If(isBackgroundDepth(sDepth).not(), () => {
            const sampleView = getViewPosition(sUv, sDepth, cameraProjectionMatrixInverse);
            // Closer to camera (greater Z in right-handed view space where -Z is forward)
            const dz = sampleView.z.sub(marchPos.z);
            const thickMax = stepWorldLen.mul(3.2);
            If(dz.greaterThan(stepWorldLen.mul(0.22)).and(dz.lessThan(thickMax)), () => {
              shadowOcc.addAssign(float(1.0).sub(fi.div(9.0)));
            });
          });
        });
      });

      const shadowFactor = float(1.0).sub(
        tslClamp(shadowOcc.mul(0.32).mul(contactShadowNode), 0.0, 0.58),
      );
      outRgb.mulAssign(shadowFactor);
    });

    // 2. Physical Spherical Rayleigh + Mie Atmospheric Scattering & Height-Exponential Volumetric Fog
    const atmoActive = atmoEnabledNode
      .mul(max(atmoScatterEnabledNode, volFogEnabledNode))
      .mul(smoothstep(0.002, 0.04, atmoDensityNode));

    If(atmoActive.greaterThan(0.01), () => {
      const R0 = max(planetRadiusNode, 0.05);
      const scaleH = max(scaleHeightNode, 0.03).mul(R0);
      const rAtmo = R0.add(scaleH.mul(3.6));

      // Ray-sphere intersection with atmospheric outer shell (planet centered at origin)
      const b = dot(camPos, rayDir);
      const c = dot(camPos, camPos).sub(rAtmo.mul(rAtmo));
      const disc = b.mul(b).sub(c);

      If(disc.greaterThan(0.0), () => {
        const sqrtDisc = sqrt(disc);
        const tEnter = max(float(0.0), b.negate().sub(sqrtDisc));
        const tExitShell = max(float(0.0), b.negate().add(sqrtDisc));
        const tEnd = min(tExitShell, hitDist);
        const marchLen = max(float(0.0), tEnd.sub(tEnter));

        If(marchLen.greaterThan(0.001), () => {
          const stepsF = tslClamp(volStepsNode, 6.0, 48.0);
          const stepsInt = int(stepsF);
          const ds = marchLen.div(stepsF);

          const rayleighScatter = vec3(0.0).toVar();
          const mieScatter = vec3(0.0).toVar();
          const opticalDepthR = float(0.0).toVar();
          const opticalDepthM = float(0.0).toVar();

          // Density multipliers
          const densP = tslClamp(atmoDensityNode, 0.0, 3.0);
          const scatterGain = atmoScatterEnabledNode.mul(0.85).add(volFogEnabledNode.mul(0.2));
          const fogBoost = volFogEnabledNode.mul(densP);

          const hR = max(scaleH.mul(0.42), R0.mul(0.035));
          const hM = max(scaleH.mul(0.16), R0.mul(0.015));

          // Phase functions
          const cosTheta = dot(rayDir, normalize(sunDirNode));
          const phaseR = float(0.059683).mul(float(1.0).add(cosTheta.mul(cosTheta)));
          const g = float(0.76);
          const g2 = g.mul(g);
          const denomMie = pow(max(float(0.04), float(1.0).add(g2).sub(g.mul(2.0).mul(cosTheta))), float(1.5));
          const phaseM = float(0.079577)
            .mul(float(1.0).sub(g2))
            .mul(float(1.0).add(cosTheta.mul(cosTheta)))
            .div(max(float(1e-3), float(2.0).add(g2).mul(denomMie)));

          const betaR = vec3(0.085, 0.225, 0.56).mul(rayleighNode).div(max(R0.mul(0.12), 0.1));
          const betaM = float(0.045)
            .mul(mieNode.mul(0.9).add(fogBoost.mul(0.55)))
            .div(max(R0.mul(0.12), 0.1));

          Loop({ start: int(0), end: stepsInt, type: 'int', condition: '<' }, ({ i }) => {
            const tMid = tEnter.add(ds.mul(float(i).add(0.5)));
            const sampleP = camPos.add(rayDir.mul(tMid));
            const sampleR = length(sampleP);
            const h = max(float(0.0), sampleR.sub(R0.mul(0.96)));

            const rhoR = exp(h.negate().div(hR)).mul(densP);
            const rhoM = exp(h.negate().div(hM)).mul(densP).mul(
              float(1.0).add(volFogEnabledNode.mul(0.85).mul(exp(h.negate().div(max(hM.mul(0.5), 0.01))))),
            );

            opticalDepthR.addAssign(rhoR.mul(ds));
            opticalDepthM.addAssign(rhoM.mul(ds));

            // Analytical self-shadowing check against planet sphere + sun grazing zenith path
            const sunDot = dot(normalize(sampleP), normalize(sunDirNode));
            const ratioHoriz = tslClamp(R0.mul(0.95).div(max(sampleR, 0.01)), 0.0, 1.0);
            const horizonAngle = sqrt(
              max(float(0.0), float(1.0).sub(pow(ratioHoriz, float(2.0)))),
            );
            const lightVis = smoothstep(horizonAngle.negate().sub(0.12), horizonAngle.negate().add(0.28), sunDot);

            // Light optical depth approximation toward sun
            const sunOptical = exp(h.negate().div(hR))
              .mul(densP)
              .mul(R0.mul(0.28))
              .div(max(float(0.15), sunDot.add(0.32)));

            const tau = betaR
              .mul(opticalDepthR.add(sunOptical))
              .add(vec3(betaM.mul(1.25).mul(opticalDepthM.add(sunOptical.mul(0.4)))));
            const transmittance = exp(tau.negate());

            rayleighScatter.addAssign(transmittance.mul(rhoR).mul(ds).mul(lightVis));
            mieScatter.addAssign(transmittance.mul(rhoM).mul(ds).mul(lightVis));
          });

          const viewTransmittance = exp(
            betaR
              .mul(opticalDepthR)
              .add(vec3(betaM.mul(1.25).mul(opticalDepthM)))
              .negate(),
          );

          const sunColor = vec3(1.0, 0.94, 0.84).mul(1.65);
          const inScattered = rayleighScatter
            .mul(betaR)
            .mul(phaseR)
            .add(mieScatter.mul(betaM).mul(phaseM))
            .mul(sunColor)
            .mul(scatterGain);

          // Blend physical aerial perspective over distant terrain, full limb glow on sky
          const terrainAerialRamp = smoothstep(R0.mul(0.03), R0.mul(0.28), hitDist);
          const applyFactor = isSky.select(
            tslClamp(atmoScatterEnabledNode.mul(0.95), 0.0, 1.0),
            tslClamp(atmoActive.mul(terrainAerialRamp), 0.0, 1.0),
          );

          const composed = outRgb.mul(viewTransmittance).add(inScattered);
          outRgb.assign(mix(outRgb, composed, applyFactor));
        });
      });
    });

    return vec4(outRgb, baseSample.a);
  })();
}
