/** Standalone entry: no runtime CDN or dependency on Astro. */
import { createHero } from './scene';

(async () => {
  const stage = document.getElementById('reference-stage');
  if (!stage) return;
  const controls = document.querySelector<HTMLElement>('.reference-controls');
  const status = document.getElementById('reference-status');

  const unavailable = () => {
    document.body.classList.remove('reference-ready');
    if (controls) controls.hidden = true;
    stage.hidden = true;
  };
  if (controls) controls.hidden = true;
  // The visual diffusion-time indicator changes frequently during sampling.
  // Keep its numeric updates out of assistive live announcements.
  status?.setAttribute('aria-live', 'off');

  try {
    const probe = document.createElement('canvas');
    const gl = probe.getContext('webgl2');
    if (!gl) {
      unavailable();
      return;
    }
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    await createHero(stage, {
      words: ['Jinyuan', 'Xu'],
      content: document.querySelector<HTMLElement>('.hero-bottom'),
      status,
      rippleButton: document.getElementById('particle-ripple') as HTMLButtonElement | null,
      regenButton: document.getElementById('reference-regenerate') as HTMLButtonElement | null,
      pauseButton: document.getElementById('reference-pause') as HTMLButtonElement | null,
      onReady: () => {
        document.body.classList.add('reference-ready');
        if (controls) controls.hidden = false;
      },
      onUnavailable: unavailable,
    });
  } catch (error) {
    console.warn('[reference hero] Showing the text introduction.', error);
    unavailable();
  }
})();
