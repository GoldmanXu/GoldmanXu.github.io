/* Crisp resting type; freely moving particles driven by a damped spring. */
(() => {
  'use strict';
  const canvas = document.getElementById('name-scene');
  const context = canvas?.getContext('2d', { alpha: true });
  if (!context) return;
  const wrap = canvas.closest('.scene-wrap');
  const controls = document.querySelector('.scene-controls');
  const pauseButton = document.getElementById('pause-scene');
  const regenerateButton = document.getElementById('regenerate-scene');
  const burstButton = document.getElementById('burst-scene');
  const status = document.getElementById('scene-status');
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const mask = document.createElement('canvas');
  const maskContext = mask.getContext('2d', { willReadFrequently: true });
  const layer = document.createElement('canvas');
  const layerContext = layer.getContext('2d');
  if (!maskContext || !layerContext) return;
  const colors = ['#fffaf0', '#f6f1e7', '#f1e4c6', '#e3f0ed'];
  const maskScale = 2;
  const spring = 145;
  const damping = 13.5;
  const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
  const random = (low, high) => low + Math.random() * (high - low);
  const smooth = n => { const t = clamp(n, 0, 1); return t * t * (3 - 2 * t); };
  let width = 0, height = 0, ratio = 1, points = [];
  let frame = 0, previous = 0, assemblyAge = 0;
  let paused = motion.matches, visible = true, assembling = false;
  let moving = false, userPaused = false, touchStart = null;
  let pointer = { x: 0, y: 0, vx: 0, vy: 0, time: 0, active: false };
  let waves = [];
  canvas.style.touchAction = 'pan-y';
  canvas.style.cursor = 'crosshair';

  function updateControls() {
    const text = paused ? 'Resume motion' : 'Pause motion';
    if (pauseButton) {
      pauseButton.textContent = text;
      pauseButton.setAttribute('aria-label', text);
      pauseButton.setAttribute('aria-pressed', String(paused));
    }
    for (const button of [regenerateButton, burstButton]) {
      if (button) {
        button.disabled = paused;
        button.title = paused ? 'Resume motion to interact' : button === burstButton ? 'Send a wave through the letters' : 'Scatter and reassemble every particle';
      }
    }
    if (status) status.textContent = paused ? 'Motion paused.' : assembling ? 'Gathering from noise.' : 'Move · tap · make waves.';
  }

  // Eight-neighbor distance transform. Distances stay in mask pixels until sampled.
  function distanceField(alpha, w, h) {
    const result = new Float32Array(w * h);
    const diagonal = Math.SQRT2;
    for (let i = 0; i < result.length; i++) result[i] = alpha[i * 4 + 3] > 192 ? 1e6 : 0;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        result[i] = Math.min(result[i], result[i - 1] + 1, result[i - w] + 1,
          result[i - w - 1] + diagonal, result[i - w + 1] + diagonal);
      }
    }
    for (let y = h - 2; y > 0; y--) {
      for (let x = w - 2; x > 0; x--) {
        const i = y * w + x;
        result[i] = Math.min(result[i], result[i + 1] + 1, result[i + w] + 1,
          result[i + w - 1] + diagonal, result[i + w + 1] + diagonal);
      }
    }
    return result;
  }

  function sample() {
    mask.width = Math.ceil(width * maskScale);
    mask.height = Math.ceil(height * maskScale);
    maskContext.setTransform(maskScale, 0, 0, maskScale, 0, 0);
    const narrow = width < 560;
    const lines = narrow ? ['JINYUAN', 'XU'] : ['JINYUAN XU'];
    let size = Math.min(narrow ? height * .35 : height * .6, narrow ? 110 : 188);
    // Arial has a straight, well-defined diagonal-to-stem junction in N.
    const font = s => `700 ${s}px Arial, Helvetica, sans-serif`;
    maskContext.font = font(size);
    const measured = Math.max(...lines.map(line => maskContext.measureText(line).width));
    size *= Math.min(1, width * (narrow ? .88 : .94) / measured);
    maskContext.font = font(size);
    maskContext.textAlign = 'center';
    maskContext.textBaseline = 'middle';
    maskContext.fillStyle = '#fff';
    const lineHeight = size * 1.13;
    lines.forEach((line, index) => maskContext.fillText(line, width / 2,
      height * .5 + (index - (lines.length - 1) / 2) * lineHeight));
    const pixels = maskContext.getImageData(0, 0, mask.width, mask.height).data;
    const distance = distanceField(pixels, mask.width, mask.height);
    const step = narrow ? 3.65 : width < 900 ? 4.35 : 5.05;
    const baseRadius = step * .31;
    const next = [];
    for (let y = step / 2; y < height; y += step) {
      for (let x = step / 2; x < width; x += step) {
        const mx = Math.round(x * maskScale), my = Math.round(y * maskScale);
        const d = distance[my * mask.width + mx] / maskScale;
        if (!d || !Number.isFinite(d)) continue;
        // Taper boundary dots instead of allowing full beads to protrude.
        const radius = Math.min(baseRadius, Math.max(baseRadius * .56, d * .78));
        const seed = Math.abs(Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1;
        next.push({ tx: x, ty: y, x, y, vx: 0, vy: 0, radius, seed,
          color: seed < .70 ? 0 : seed < .91 ? 1 : seed < .97 ? 2 : 3,
          ox: 0, oy: 0 });
      }
    }
    points = next;
  }

  function dot(ctx, p, x, y, alpha) {
    if (alpha <= .001) return;
    ctx.globalAlpha = alpha * .93;
    ctx.fillStyle = colors[p.color];
    ctx.beginPath();
    ctx.arc(x, y, p.radius, 0, Math.PI * 2);
    ctx.fill();
  }

  function draw() {
    context.clearRect(0, 0, width, height);
    layerContext.clearRect(0, 0, width, height);
    // Blend only the final subpixel of a return into the precise resting mask.
    // There is no glyph clip on moving dots, including all contour dots.
    for (const p of points) {
      const activity = Math.max(Math.hypot(p.x - p.tx, p.y - p.ty) / .75,
        Math.hypot(p.vx, p.vy) / 9);
      p.freeAlpha = smooth(activity);
      dot(layerContext, p, p.tx, p.ty, 1 - p.freeAlpha);
    }
    layerContext.globalAlpha = 1;
    layerContext.globalCompositeOperation = 'destination-in';
    layerContext.drawImage(mask, 0, 0, width, height);
    layerContext.globalCompositeOperation = 'source-over';
    context.drawImage(layer, 0, 0, width, height);
    for (const p of points) dot(context, p, p.x, p.y, p.freeAlpha);
    context.globalAlpha = 1;
    // A short-lived ring makes a tap legible even in the space between letters.
    for (const wave of waves) {
      const alpha = Math.max(0, 1 - wave.age / .58) * .24;
      if (!alpha) continue;
      context.globalAlpha = alpha;
      context.strokeStyle = '#fff8e7';
      context.lineWidth = 1;
      context.beginPath();
      context.arc(wave.x, wave.y, wave.age * wave.speed, 0, Math.PI * 2);
      context.stroke();
    }
    context.globalAlpha = 1;
  }

  function step(dt) {
    assemblyAge += dt;
    const dispersing = assembling && assemblyAge < .23;
    const disperse = dispersing ? smooth(assemblyAge / .14) : 0;
    const influenceRadius = width < 560 ? 112 : 142;
    pointer.vx *= Math.exp(-dt * 7);
    pointer.vy *= Math.exp(-dt * 7);
    for (const wave of waves) wave.age += dt;
    moving = false;
    points.forEach((p, index) => {
      let targetX = p.tx + p.ox * disperse;
      let targetY = p.ty + p.oy * disperse;
      let influenced = false;
      if (pointer.active && !assembling) {
        const dx = p.tx - pointer.x, dy = p.ty - pointer.y;
        const distance = Math.hypot(dx, dy);
        if (distance < influenceRadius) {
          influenced = true;
          const falloff = Math.pow(1 - distance / influenceRadius, 1.2);
          const direction = distance > .1 ? [dx / distance, dy / distance] :
            [Math.cos(p.seed * Math.PI * 2), Math.sin(p.seed * Math.PI * 2)];
          // 78 px near the pointer, plus a small velocity-driven sweep.
          targetX += (direction[0] * 78 + pointer.vx * .022) * falloff;
          targetY += (direction[1] * 78 + pointer.vy * .022) * falloff;
        }
      }
      for (const wave of waves) {
        if (wave.hit[index]) continue;
        const dx = p.x - wave.x, dy = p.y - wave.y;
        const distance = Math.hypot(dx, dy);
        if (distance > wave.age * wave.speed) continue;
        wave.hit[index] = 1;
        const angle = distance > .1 ? Math.atan2(dy, dx) : p.seed * Math.PI * 2;
        const impulse = wave.strength * (.58 + .42 * Math.max(0, 1 - distance / wave.extent));
        p.vx += Math.cos(angle) * impulse;
        p.vy += Math.sin(angle) * impulse;
      }
      // Semi-implicit Euler with <= 1/120 s substeps preserves the overshoot.
      p.vx += ((targetX - p.x) * spring - p.vx * damping) * dt;
      p.vy += ((targetY - p.y) * spring - p.vy * damping) * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (!influenced && !dispersing && Math.hypot(p.x - p.tx, p.y - p.ty) < .12 &&
          Math.hypot(p.vx, p.vy) < 1.2) {
        p.x = p.tx; p.y = p.ty; p.vx = p.vy = 0;
      } else moving = true;
    });
    waves = waves.filter(wave => wave.age * wave.speed < wave.extent + 180);
    if (assembling && assemblyAge > .35 && !moving) {
      assembling = false;
      updateControls();
    }
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const w = Math.round(rect.width), h = Math.round(rect.height);
    const dpr = Math.min(devicePixelRatio || 1, 3);
    if (!w || !h || (w === width && h === height && dpr === ratio)) return;
    const first = !width;
    width = w; height = h; ratio = dpr;
    canvas.width = layer.width = Math.round(width * ratio);
    canvas.height = layer.height = Math.round(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    layerContext.setTransform(ratio, 0, 0, ratio, 0, 0);
    sample();
    settle();
    if (first && !paused) {
      points.forEach(p => {
        p.x += random(-width * .27, width * .27);
        p.y += random(-height * .5, height * .5);
      });
      assemblyAge = .24; assembling = true; moving = true;
    }
    draw();
    if (points.length) {
      wrap?.classList.add('is-ready');
      if (controls) controls.hidden = false;
    }
    updateControls(); schedule();
  }

  function tick(now) {
    frame = 0;
    if (paused || !visible || document.hidden) return;
    const passed = previous ? clamp((now - previous) / 1000, 0, .05) : 1 / 60;
    previous = now;
    const steps = Math.max(1, Math.ceil(passed / (1 / 120)));
    for (let i = 0; i < steps; i++) step(passed / steps);
    draw(); schedule();
  }
  function schedule() {
    if (!frame && !paused && visible && !document.hidden && points.length &&
        (moving || assembling || pointer.active || waves.length)) frame = requestAnimationFrame(tick);
    else if (!frame) previous = 0;
  }
  function suspend() { if (frame) cancelAnimationFrame(frame); frame = 0; previous = 0; }
  function settle() {
    points.forEach(p => { p.x = p.tx; p.y = p.ty; p.vx = p.vy = 0; });
    waves = []; moving = false; assembling = false;
    pointer.active = false; pointer.vx = pointer.vy = 0; touchStart = null;
  }
  function regenerate() {
    if (paused) return;
    waves = []; pointer.active = false;
    points.forEach(p => {
      const angle = random(0, Math.PI * 2);
      const distance = random(.28, 1);
      p.ox = Math.cos(angle) * width * .36 * distance;
      p.oy = Math.sin(angle) * height * .60 * distance;
    });
    assemblyAge = 0; assembling = true; moving = true;
    updateControls(); schedule();
  }
  function burst(x, y) {
    if (paused) return;
    const extent = Math.max(Math.hypot(x, y), Math.hypot(width - x, y),
      Math.hypot(x, height - y), Math.hypot(width - x, height - y));
    waves.push({ x, y, age: 0, speed: 920, strength: 1500, extent,
      hit: new Uint8Array(points.length) });
    // Bound work when someone repeatedly presses or holds the keyboard button.
    if (waves.length > 5) waves.shift();
    schedule();
  }
  regenerateButton?.addEventListener('click', regenerate);
  burstButton?.addEventListener('click', () => burst(width / 2, height / 2));
  pauseButton?.addEventListener('click', () => {
    paused = !paused;
    userPaused = paused;
    if (paused) { suspend(); settle(); draw(); }
    else schedule();
    updateControls();
  });
  function localPoint(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }
  canvas.addEventListener('pointermove', event => {
    const position = localPoint(event);
    if (event.pointerType === 'touch') {
      if (touchStart && Math.hypot(position.x - touchStart.x, position.y - touchStart.y) > 14) touchStart.moved = true;
      return;
    }
    if (paused) return;
    const now = performance.now();
    const dt = Math.max(.008, (now - pointer.time) / 1000);
    const vx = pointer.active ? clamp((position.x - pointer.x) / dt, -1500, 1500) : 0;
    const vy = pointer.active ? clamp((position.y - pointer.y) / dt, -1500, 1500) : 0;
    pointer = { ...position, vx: pointer.vx * .3 + vx * .7,
      vy: pointer.vy * .3 + vy * .7, time: now, active: true };
    schedule();
  }, { passive: true });
  canvas.addEventListener('pointerdown', event => {
    if (paused || (event.pointerType !== 'touch' && event.button !== 0)) return;
    const position = localPoint(event);
    if (event.pointerType === 'touch') {
      pointer.active = false;
      touchStart = { ...position, id: event.pointerId, moved: false, time: performance.now() };
    } else burst(position.x, position.y);
  }, { passive: true });
  canvas.addEventListener('pointerup', event => {
    if (event.pointerType !== 'touch' || touchStart?.id !== event.pointerId) return;
    const position = localPoint(event);
    if (!touchStart.moved && performance.now() - touchStart.time < 600 &&
        Math.hypot(position.x - touchStart.x, position.y - touchStart.y) <= 14) burst(position.x, position.y);
    touchStart = null;
  }, { passive: true });
  const releasePointer = () => { pointer.active = false; touchStart = null; schedule(); };
  canvas.addEventListener('pointerleave', releasePointer, { passive: true });
  canvas.addEventListener('pointercancel', releasePointer, { passive: true });
  window.addEventListener('blur', releasePointer);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { pointer.active = false; touchStart = null; suspend(); }
    else schedule();
  });
  motion.addEventListener('change', event => {
    paused = event.matches || userPaused; suspend(); settle();
    updateControls(); draw(); schedule();
  });
  if ('IntersectionObserver' in window) new IntersectionObserver(entries => {
    visible = entries[0].isIntersecting;
    if (visible) schedule(); else suspend();
  }, { rootMargin: '60px' }).observe(canvas);
  if ('ResizeObserver' in window) new ResizeObserver(resize).observe(canvas);
  window.addEventListener('resize', resize, { passive: true });
  resize();
})();
