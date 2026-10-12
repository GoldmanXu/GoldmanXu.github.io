/**
 * Gaussian-noise opening adapted from Liangbing Zhao:
 * https://github.com/liangbingzhao/liangbingzhao.github.io/tree/redesign-3d
 * Revision 964aa2076be23552640e32962f31cac60ccca4cc. MIT notices accompany the bundle.
 * The resolved name uses evenly spaced, matte coastal dots; screen-space springs
 * add cursor repulsion and tap waves without materializing any solid geometry.
 */
import * as THREE from 'three';
import nameArtwork from './name-artwork.png';
import nameLayout from './name-artwork.json';
import { DEFAULT_PALETTE, PALETTES, isPalette, type Look, type PaletteName, type ThemeName } from './palettes';

type Phase = 'denoise' | 'interactive' | 'noising';
export interface HeroOptions {
  words: string[];
  content: HTMLElement | null;
  status: HTMLElement | null;
  rippleButton: HTMLButtonElement | null;
  regenButton: HTMLButtonElement | null;
  pauseButton: HTMLButtonElement | null;
  onReady?: () => void;
  onUnavailable?: () => void;
}
interface Letter {
  samples: Float32Array;
  area: number;
  home: THREE.Vector3;
}
interface Wave { x: number; y: number; age: number; extent: number; hit: Uint8Array; }
const WORD_GAP = 0.5, ROW_GAP = 4.8;
const HOLD_TIME = 0.35, DENOISE_TIME = 2.8, NOISE_TIME = 1.25;
const SPRING = 145, DAMPING = 17;

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeIn = (t: number) => t * t * t;
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

function gauss(): number {
  let u = 0;
  while (u === 0) u = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
}

function currentTheme(): ThemeName {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

function currentPalette(): PaletteName {
  const value = document.documentElement.dataset.palette;
  return isPalette(value) ? value : DEFAULT_PALETTE;
}

const particleVertex = /* glsl */ `
  uniform float uMix;
  uniform float uTime;
  uniform float uSize;
  uniform float uScale;
  uniform float uJitter;
  uniform float uInteractive;
  uniform float uPixelScale;
  attribute vec3 aOffset;
  attribute vec3 aFrom;
  attribute vec3 aTo;
  attribute vec3 aColor;
  attribute float aSeed;
  varying vec3 vColor;
  void main() {
    vec3 p = mix(aFrom, aTo, uMix);
    float k = uMix * (1.0 - uMix) * 4.0;
    float ph = aSeed * 6.2831853;
    vec3 wobble = vec3(
      sin(uTime * 1.9 + ph * 7.0),
      sin(uTime * 1.4 + ph * 3.0),
      cos(uTime * 1.6 + ph * 5.0)
    );
    p += wobble * (0.16 * k + 0.04 * uJitter);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    mv.xy += aOffset.xy * vec2(1.0, -1.0) * (-mv.z / uPixelScale) * uInteractive;
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize * uScale / -mv.z * (0.92 + 0.16 * aSeed);
    vColor = aColor;
  }
`;

const particleFragment = /* glsl */ `
  uniform float uOpacity;
  varying vec3 vColor;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    gl_FragColor = vec4(vColor, smoothstep(0.5, 0.27, d) * uOpacity * 0.95);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export async function createHero(stage: HTMLElement, opts: HeroOptions): Promise<void> {
  // Rendered word artwork keeps the exact handwriting on devices without this font.
  const artwork = new Image();
  artwork.src = nameArtwork;
  await artwork.decode();
  const mask = document.createElement('canvas');
  mask.width = artwork.width; mask.height = artwork.height;
  const maskContext = mask.getContext('2d', { willReadFrequently: true });
  if (!maskContext) throw new Error('Name artwork could not be sampled.');
  maskContext.drawImage(artwork, 0, 0);
  const pixels = maskContext.getImageData(0, 0, mask.width, mask.height).data;
  const unit = 1 / nameLayout.capHeight;
  const wordLayouts = nameLayout.words as Record<string, typeof nameLayout.words.Jinyuan>;
  const artworkLetters = new Map<string, { samples: Float32Array; area: number; x: number; y: number; height: number }[]>();
  for (const [word, layout] of Object.entries(wordLayouts)) {
    const samples: number[][] = Array.from(word, () => []);
    for (let y = 0; y < layout.height; y++) for (let x = 0; x < layout.width; x++) {
      if (pixels[((layout.y + y) * mask.width + x) * 4] < 192) continue;
      const px = x + 0.5 - layout.origin;
      let li = 0;
      while (li < word.length - 1 && px >= layout.stops[li + 1]) li++;
      samples[li].push(px * unit, (layout.baseline - y - 0.5) * unit);
    }
    artworkLetters.set(word, samples.map(values => {
      let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
      for (let i = 0; i < values.length; i += 2) {
        xMin = Math.min(xMin, values[i]); xMax = Math.max(xMax, values[i]);
        yMin = Math.min(yMin, values[i + 1]); yMax = Math.max(yMax, values[i + 1]);
      }
      const x = (xMin + xMax) / 2, y = (yMin + yMax) / 2;
      return { x, y, height: yMax - yMin, area: values.length / 2 * unit * unit,
        samples: Float32Array.from(values, (v, i) => v - (i % 2 ? y : x)) };
    }));
  }
  const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  let reduceMotion = motionQuery.matches;
  let paused = reduceMotion;
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const fineHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  let theme = currentTheme(), palette = currentPalette();
  const look = (): Look => PALETTES[palette][theme];
  let failed = false, ready = false;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  let pixelRatio = Math.min(window.devicePixelRatio || 1, coarse ? 1.75 : 2);
  renderer.setPixelRatio(pixelRatio);
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.domElement.setAttribute('aria-hidden', 'true');
  stage.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 200);
  let letters: Letter[] = [];
  let bounds = { width: 12, depth: 0, height: 1.1, centerY: 0.42 };
  let twoRows = false;
  let phase: Phase = 'denoise', phaseT = 0, statusText = '';
  let waves: Wave[] = [];

  function buildLetters(rows: string[]) {
    letters = [];
    const zs = rows.map((_, i) => (i - (rows.length - 1) / 2) * ROW_GAP);
    let width = 0, yMin = Infinity, yMax = -Infinity;
    rows.forEach((row, r) => {
      const words = row.split(' ');
      const rowWidth = words.reduce((sum, word) => sum + wordLayouts[word].advance * unit, 0) + WORD_GAP * (words.length - 1);
      width = Math.max(width, rowWidth);
      let pen = 0;
      for (const word of words) {
        for (const glyph of artworkLetters.get(word)!) {
          const home = new THREE.Vector3(pen + glyph.x - rowWidth / 2, glyph.y, zs[r]);
          letters.push({ samples: glyph.samples, area: glyph.area, home });
          yMin = Math.min(yMin, glyph.y - glyph.height / 2);
          yMax = Math.max(yMax, glyph.y + glyph.height / 2);
        }
        pen += wordLayouts[word].advance * unit + WORD_GAP;
      }
    });
    bounds = { width, depth: Math.max(...zs) - Math.min(...zs), height: yMax - yMin, centerY: (yMax + yMin) / 2 };
  }

  // --------------------------------------------------------------- particles
  const pMat = new THREE.ShaderMaterial({
    uniforms: {
      uMix: { value: 0 },
      uTime: { value: 0 },
      uSize: { value: look().pointSize },
      uScale: { value: 1000 },
      uJitter: { value: 1 },
      uInteractive: { value: 0 },
      uPixelScale: { value: 1000 },
      uOpacity: { value: 1 },
    },
    vertexShader: particleVertex,
    fragmentShader: particleFragment,
    transparent: true,
    depthWrite: false,
    blending: look().additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  let points: THREE.Points | null = null;
  let local = new Float32Array(0);
  let owner = new Uint16Array(0);
  let homeWorld = new Float32Array(0);
  let noise = new Float32Array(0);

  let offsets = new Float32Array(0), velocity = new Float32Array(0);
  let projected = new Float32Array(0), seeds = new Float32Array(0);

  function buildParticles() {
    if (points) {
      scene.remove(points);
      points.geometry.dispose();
    }
    const target = coarse || stage.clientWidth < 700 ? 3000 : 6000;
    const areas = letters.map((l) => l.area);
    const sum = areas.reduce((s, a) => s + a, 0) || 1;
    const counts = areas.map((a) => Math.max(60, Math.round((target * a) / sum)));
    const count = counts.reduce((s, c) => s + c, 0);
    local = new Float32Array(count * 3);
    owner = new Uint16Array(count);
    homeWorld = new Float32Array(count * 3);
    noise = new Float32Array(count * 3);
    const tmp = new THREE.Vector3();
    let k = 0;
    letters.forEach((l, li) => {
      const spacing = Math.sqrt(areas[li] / counts[li]) * 0.68;
      const grid = new Map<string, number[]>();
      for (let j = 0; j < counts[li]; j++, k++) {
        // Evenly spaced random dots, without a visible grid or sparkling clumps.
        let gx = 0, gy = 0;
        for (let attempt = 0; attempt < 32; attempt++) {
          const sample = Math.floor(Math.random() * (l.samples.length / 2)) * 2;
          tmp.set(l.samples[sample], l.samples[sample + 1], 0);
          gx = Math.floor(tmp.x / spacing); gy = Math.floor(tmp.y / spacing);
          let clear = true;
          for (let x = gx - 1; x <= gx + 1 && clear; x++) {
            for (let y = gy - 1; y <= gy + 1 && clear; y++) {
              for (const previous of grid.get(`${x},${y}`) ?? []) {
                if (Math.hypot(tmp.x - local[previous * 3], tmp.y - local[previous * 3 + 1]) < spacing) { clear = false; break; }
              }
            }
          }
          if (clear) break;
        }
        local.set([tmp.x, tmp.y, tmp.z], k * 3);
        const key = `${gx},${gy}`;
        const cell = grid.get(key) ?? [];
        cell.push(k); grid.set(key, cell);
        owner[k] = li;
        homeWorld.set([tmp.x + l.home.x, tmp.y + l.home.y, tmp.z + l.home.z], k * 3);
      }
    });
    seeds = new Float32Array(count).map(() => Math.random());
    offsets = new Float32Array(count * 3);
    velocity = new Float32Array(count * 2);
    projected = new Float32Array(count * 2);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(homeWorld), 3));
    geo.setAttribute('aFrom', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    geo.setAttribute('aTo', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    geo.setAttribute('aOffset', new THREE.BufferAttribute(offsets, 3).setUsage(THREE.DynamicDrawUsage));
    points = new THREE.Points(geo, pMat);
    points.frustumCulled = false;
    points.renderOrder = 2;
    scene.add(points);
    colorParticles();
  }

  function colorParticles() {
    if (!points) return;
    const attr = points.geometry.getAttribute('aColor') as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    const lk = look();
    const c = new THREE.Color();
    for (let i = 0; i < owner.length; i++) {
      const [color] = lk.points.find(([, threshold]) => seeds[i] < threshold) ?? lk.points[0];
      c.set(color).multiplyScalar(lk.particleGain);
      arr[i * 3] = c.r;
      arr[i * 3 + 1] = c.g;
      arr[i * 3 + 2] = c.b;
    }
    attr.needsUpdate = true;
  }

  function sampleNoise() {
    const sx = Math.max(2.2, bounds.width * 0.3);
    const sz = 1.3 + bounds.depth * 0.4;
    for (let i = 0; i < owner.length; i++) {
      noise[i * 3] = gauss() * sx;
      noise[i * 3 + 1] = 1.3 + gauss() * 1.0;
      noise[i * 3 + 2] = gauss() * sz;
    }
  }

  function setPath(from: Float32Array, to: Float32Array) {
    if (!points) return;
    const a = points.geometry.getAttribute('aFrom') as THREE.BufferAttribute;
    const b = points.geometry.getAttribute('aTo') as THREE.BufferAttribute;
    (a.array as Float32Array).set(from);
    (b.array as Float32Array).set(to);
    a.needsUpdate = true;
    b.needsUpdate = true;
  }

  // ------------------------------------------------------------------ camera
  const view = { dist: 16, pitch: 0.22, target: new THREE.Vector3() };
  const cam = { yaw: 0, pitch: 0 };

  function frameCamera() {
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    const contentH = opts.content?.offsetHeight ?? h * 0.3;
    const navHeight = document.querySelector<HTMLElement>('[data-nav]')?.offsetHeight ?? 64;
    const heroTop = (stage.offsetParent as HTMLElement | null)?.offsetTop ?? 0;
    const overlap = Math.max(0, navHeight - heroTop);
    const vHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    const hHalf = vHalf * camera.aspect;
    const availH = Math.max(h * 0.28, h - contentH - overlap);
    view.pitch = twoRows ? 0.4 : 0.15;
    const halfW = bounds.width / 2 + 0.6;
    const distH = halfW / (hHalf * (twoRows ? 0.92 : 0.86));
    const extentV = (bounds.depth * Math.sin(view.pitch) + bounds.height * Math.cos(view.pitch)) / 2 + 0.3;
    const distV = extentV / (vHalf * (availH / h) * 0.85);
    view.dist = Math.max(8, distH, distV);
    // Centre the letters in the free space above the text block.
    const ndcY = (contentH - overlap) / h;
    const lift = (ndcY * view.dist * vHalf) / Math.cos(view.pitch);
    view.target.set(0, bounds.centerY - lift, 0);
  }

  function updateCamera(dt: number, time: number) {
    const parallax = fineHover && pointer.inside && !reduceMotion;
    const yaw = (parallax ? pointer.ndc.x * 0.06 : 0) + (reduceMotion ? 0 : Math.sin(time * 0.23) * 0.03);
    const pitch = parallax ? pointer.ndc.y * 0.025 : 0;
    const k = Math.min(1, dt * 3);
    cam.yaw += (yaw - cam.yaw) * k;
    cam.pitch += (pitch - cam.pitch) * k;
    const p = view.pitch + cam.pitch;
    camera.position.set(
      view.target.x + Math.sin(cam.yaw) * Math.cos(p) * view.dist,
      view.target.y + Math.sin(p) * view.dist,
      view.target.z + Math.cos(cam.yaw) * Math.cos(p) * view.dist,
    );
    camera.lookAt(view.target);
  }

  // ------------------------------------------ pointer and screen-space springs
  const pointer = { ndc: new THREE.Vector2(), inside: false, x: 0, y: 0, vx: 0, vy: 0, time: 0 };
  let press: { id: number; x: number; y: number; time: number; moved: boolean } | null = null;
  const projectedPoint = new THREE.Vector3();
  const projection = new THREE.Matrix4();

  function setPointer(e: PointerEvent) {
    const r = stage.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const dt = Math.max(0.008, Math.min(0.08, (e.timeStamp - pointer.time) / 1000));
    if (pointer.inside) {
      pointer.vx = THREE.MathUtils.clamp((x - pointer.x) / dt, -2000, 2000);
      pointer.vy = THREE.MathUtils.clamp((y - pointer.y) / dt, -2000, 2000);
    }
    pointer.x = x; pointer.y = y; pointer.time = e.timeStamp;
    pointer.ndc.set(x / r.width * 2 - 1, 1 - y / r.height * 2);
  }
  stage.addEventListener('pointermove', e => {
    if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 14) press.moved = true;
    if (paused) return;
    setPointer(e);
    pointer.inside = e.pointerType === 'mouse' || (!!press && !press.moved);
  });
  stage.addEventListener('pointerdown', e => {
    if (paused) return;
    setPointer(e); pointer.inside = true;
    press = { id: e.pointerId, x: e.clientX, y: e.clientY, time: e.timeStamp, moved: false };
  });
  stage.addEventListener('pointerup', e => {
    if (press?.id === e.pointerId && !press.moved && Math.hypot(e.clientX - press.x, e.clientY - press.y) < 14 && e.timeStamp - press.time < 650) {
      setPointer(e); ripple(pointer.x, pointer.y);
    }
    press = null;
    if (e.pointerType !== 'mouse') pointer.inside = false;
  });
  stage.addEventListener('pointercancel', () => { press = null; pointer.inside = false; });
  stage.addEventListener('pointerleave', () => { press = null; pointer.inside = false; });
  window.addEventListener('blur', () => { press = null; pointer.inside = false; });

  function ripple(x: number, y: number) {
    if (paused || failed || phase !== 'interactive') return;
    waves.push({ x, y, age: 0, extent: Math.hypot(stage.clientWidth, stage.clientHeight), hit: new Uint8Array(owner.length) });
    if (waves.length > 4) waves.shift();
  }

  function projectHomes() {
    projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const halfW = stage.clientWidth / 2, halfH = stage.clientHeight / 2;
    for (let i = 0; i < owner.length; i++) {
      projectedPoint.fromArray(homeWorld, i * 3).applyMatrix4(projection);
      projected[i * 2] = (projectedPoint.x + 1) * halfW;
      projected[i * 2 + 1] = (1 - projectedPoint.y) * halfH;
    }
  }

  function interact(dt: number) {
    projectHomes();
    pointer.vx *= Math.exp(-dt * 7); pointer.vy *= Math.exp(-dt * 7);
    const compact = coarse || stage.clientWidth < 560;
    const radius = compact ? 75 : 95;
    const reach = compact ? 22 : 30;
    const maxOffset = compact ? 40 : 54;
    for (const wave of waves) wave.age += dt;
    const steps = Math.max(1, Math.ceil(dt * 120)), h = dt / steps;
    for (let i = 0; i < owner.length; i++) {
      const p = i * 3, v = i * 2;
      const hx = projected[v], hy = projected[v + 1];
      let tx = 0, ty = 0;
      if (pointer.inside) {
        const dx = hx - pointer.x, dy = hy - pointer.y, d = Math.hypot(dx, dy);
        if (d < radius) {
          const a = d > 0.1 ? Math.atan2(dy, dx) : seeds[i] * Math.PI * 2;
          const falloff = Math.pow(1 - d / radius, 1.2);
          tx = (Math.cos(a) * reach + pointer.vx * 0.008) * falloff;
          ty = (Math.sin(a) * reach + pointer.vy * 0.008) * falloff;
        }
      }
      for (const wave of waves) {
        if (wave.hit[i]) continue;
        const dx = hx + offsets[p] - wave.x, dy = hy + offsets[p + 1] - wave.y;
        const d = Math.hypot(dx, dy);
        if (d > wave.age * 920) continue;
        wave.hit[i] = 1;
        const a = d > 0.1 ? Math.atan2(dy, dx) : seeds[i] * Math.PI * 2;
        const impulse = 460 * (0.58 + 0.42 * Math.max(0, 1 - d / wave.extent));
        velocity[v] += Math.cos(a) * impulse; velocity[v + 1] += Math.sin(a) * impulse;
      }
      for (let j = 0; j < steps; j++) {
        velocity[v] += ((tx - offsets[p]) * SPRING - velocity[v] * DAMPING) * h;
        velocity[v + 1] += ((ty - offsets[p + 1]) * SPRING - velocity[v + 1] * DAMPING) * h;
        offsets[p] += velocity[v] * h; offsets[p + 1] += velocity[v + 1] * h;
      }
      // Repeated taps remain local and cannot tear the name far apart.
      const distance = Math.hypot(offsets[p], offsets[p + 1]);
      if (distance > maxOffset) {
        const nx = offsets[p] / distance, ny = offsets[p + 1] / distance;
        offsets[p] = nx * maxOffset; offsets[p + 1] = ny * maxOffset;
        const outward = Math.max(0, velocity[v] * nx + velocity[v + 1] * ny);
        velocity[v] -= nx * outward; velocity[v + 1] -= ny * outward;
      }
      if (Math.abs(offsets[p]) + Math.abs(offsets[p + 1]) < 0.1 && Math.abs(velocity[v]) + Math.abs(velocity[v + 1]) < 0.7 && tx === 0 && ty === 0) {
        offsets[p] = offsets[p + 1] = velocity[v] = velocity[v + 1] = 0;
      }
    }
    waves = waves.filter(w => w.age * 920 < w.extent + 100);
    if (points) (points.geometry.getAttribute('aOffset') as THREE.BufferAttribute).needsUpdate = true;
  }

  function resetInteraction() {
    offsets.fill(0); velocity.fill(0); waves = [];
    if (points) (points.geometry.getAttribute('aOffset') as THREE.BufferAttribute).needsUpdate = true;
  }

  function currentSurface(): Float32Array {
    const out = new Float32Array(homeWorld.length), v = new THREE.Vector3();
    const scale = pMat.uniforms.uPixelScale.value;
    for (let i = 0; i < owner.length; i++) {
      v.fromArray(homeWorld, i * 3).applyMatrix4(camera.matrixWorldInverse);
      const units = -v.z / scale;
      v.x += offsets[i * 3] * units; v.y -= offsets[i * 3 + 1] * units;
      v.applyMatrix4(camera.matrixWorld).toArray(out, i * 3);
    }
    return out;
  }

  // ----------------------------------------------------------- phase sequence
  function setStatus(text: string) {
    if (text === statusText || !opts.status) return;
    statusText = text; opts.status.textContent = text;
  }
  function updateControls() {
    const busy = phase !== 'interactive';
    const action = paused ? 'Resume motion' : 'Pause motion';
    if (opts.pauseButton) {
      opts.pauseButton.textContent = action;
      opts.pauseButton.setAttribute('aria-label', action);
      opts.pauseButton.setAttribute('aria-pressed', String(paused));
    }
    for (const button of [opts.rippleButton, opts.regenButton]) if (button) {
      button.disabled = busy || paused;
      button.setAttribute('aria-busy', String(busy));
    }
    if (phase === 'interactive') setStatus(paused ? 'motion paused' : coarse ? 'tap · scatter · gather' : 'move · tap · make waves');
  }
  function enter(next: Phase) {
    phase = next; phaseT = 0;
    const u = pMat.uniforms;
    u.uOpacity.value = 1;
    if (points) points.visible = true;
    if (next === 'denoise') {
      resetInteraction(); u.uInteractive.value = 0; u.uMix.value = 0;
    } else if (next === 'interactive') {
      resetInteraction(); setPath(homeWorld, homeWorld);
      u.uInteractive.value = 1; u.uMix.value = 1; u.uJitter.value = 0;
    } else {
      const from = currentSurface();
      resetInteraction(); sampleNoise(); setPath(from, noise);
      u.uInteractive.value = 0; u.uMix.value = 0;
    }
    updateControls();
  }
  const stepsLabel = (t: number) => String(Math.round(t * 1000)).padStart(4, ' ');
  function update(dt: number, time: number) {
    phaseT += dt;
    const u = pMat.uniforms;
    u.uTime.value = time;
    updateCamera(dt, time);
    camera.updateMatrixWorld();
    if (phase === 'denoise') {
      const p = clamp01((phaseT - HOLD_TIME) / DENOISE_TIME), e = easeInOut(p);
      u.uMix.value = e; u.uJitter.value = 1 - e;
      setStatus(`sampling · t = ${stepsLabel(1 - e)}`);
      if (p >= 1) enter('interactive');
    } else if (phase === 'interactive') interact(dt);
    else {
      const p = clamp01(phaseT / NOISE_TIME), e = easeIn(p);
      u.uMix.value = e; u.uJitter.value = e;
      setStatus(`adding noise · t = ${stepsLabel(e)}`);
      if (p >= 1) { setPath(noise, homeWorld); enter('denoise'); phaseT = HOLD_TIME; }
    }
  }

  function applyLook() {
    theme = currentTheme(); palette = currentPalette();
    pMat.uniforms.uSize.value = look().pointSize;
    pMat.blending = look().additive ? THREE.AdditiveBlending : THREE.NormalBlending;
    pMat.needsUpdate = true;
    colorParticles();
  }
  new MutationObserver(() => {
    if (currentTheme() !== theme || currentPalette() !== palette) {
      applyLook(); if (!running) renderScene();
    }
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-palette'] });

  // ------------------------------------------------------------------ layout
  function rowsFor(width: number, height: number): string[] {
    return width / height < 0.95 && opts.words.length > 1 ? opts.words : [opts.words.join(' ')];
  }

  function rebuild() {
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    twoRows = rowsFor(w, h).length > 1;
    buildLetters(rowsFor(w, h));
    buildParticles();
    applyLook();
    sampleNoise();
    setPath(noise, homeWorld);
    enter('denoise');
    frameCamera();
    if (paused) enter('interactive');
  }

  function resize() {
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    pMat.uniforms.uPixelScale.value = h / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    pMat.uniforms.uScale.value = pMat.uniforms.uPixelScale.value * renderer.getPixelRatio();
    const wantTwoRows = rowsFor(w, h).length > 1;
    if (!letters.length || wantTwoRows !== twoRows) rebuild();
    else frameCamera();
  }

  // -------------------------------------------------------------------- loop
  const timer = new THREE.Timer();
  timer.connect(document);
  let running = false;
  let visible = true;
  let slowFrames = 0;
  let sampledFrames = 0;
  let animationFrame = 0;

  function unavailable() {
    if (failed) return;
    failed = true;
    setRunning(false);
    renderer.domElement.hidden = true;
    opts.onUnavailable?.();
  }

  function renderScene(): boolean {
    if (failed) return false;
    try {
      renderer.render(scene, camera);
      if (!ready) {
        ready = true;
        opts.onReady?.();
        // Revealing the controls can change the bottom content height.
        frameCamera();
        updateCamera(0, timer.getElapsed());
        renderer.render(scene, camera);
      }
      return true;
    } catch (error) {
      console.warn('[reference hero] Renderer unavailable.', error);
      unavailable();
      return false;
    }
  }

  function loop(now: number) {
    animationFrame = 0;
    if (!running) return;
    timer.update(now);
    const dt = Math.min(timer.getDelta(), 1 / 20);
    update(dt, timer.getElapsed());
    if (!renderScene()) return;
    // Drop resolution once if this device struggles.
    if (pixelRatio > 1 && sampledFrames < 240) {
      sampledFrames++;
      if (dt > 1 / 32) slowFrames++;
      if (sampledFrames === 240 && slowFrames > 90) {
        pixelRatio = 1;
        renderer.setPixelRatio(1);
        resize();
      }
    }
    if (running) animationFrame = requestAnimationFrame(loop);
  }

  function setRunning(on: boolean) {
    if (on === running) return;
    running = on;
    if (on) {
      timer.reset();
      animationFrame = requestAnimationFrame(loop);
    } else {
      if (animationFrame) cancelAnimationFrame(animationFrame);
      animationFrame = 0;
    }
  }

  const syncRunning = () => setRunning(!failed && !paused && visible && document.visibilityState === 'visible');
  new IntersectionObserver((entries) => {
    visible = entries[0]?.isIntersecting ?? true;
    syncRunning();
  }).observe(stage);
  document.addEventListener('visibilitychange', syncRunning);
  new ResizeObserver(() => {
    if (failed) return;
    resize();
    updateCamera(0, timer.getElapsed());
    if (!running) renderScene();
  }).observe(stage);
  if (opts.content) new ResizeObserver(() => {
    if (failed) return;
    frameCamera();
    updateCamera(0, timer.getElapsed());
    if (!running) renderScene();
  }).observe(opts.content);

  renderer.domElement.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    unavailable();
  });

  function setPaused(value: boolean) {
    if (failed) return;
    paused = value;
    pointer.inside = false; pointer.vx = pointer.vy = 0; press = null;
    if (paused && phase !== 'interactive') enter('interactive');
    updateControls(); syncRunning(); renderScene();
  }
  opts.pauseButton?.addEventListener('click', () => setPaused(!paused));
  motionQuery.addEventListener('change', e => { reduceMotion = e.matches; setPaused(e.matches); });
  opts.rippleButton?.addEventListener('click', () => {
    projectHomes();
    // Start in the name itself, including the upper line on narrow screens.
    const index = Math.floor(owner.length / 2) * 2;
    ripple(projected[index] || stage.clientWidth / 2, projected[index + 1] || stage.clientHeight * 0.4);
  });
  opts.regenButton?.addEventListener('click', () => {
    if (!failed && !paused && phase === 'interactive') enter('noising');
  });
  resize(); updateCamera(0, 0); camera.updateMatrixWorld();
  updateControls(); renderScene(); syncRunning();
}
