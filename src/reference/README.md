# Colored particle hero (A/B fusion)

This source adapts the MIT-licensed hero from [Liangbing Zhao's homepage](https://github.com/liangbingzhao/liangbingzhao.github.io/tree/redesign-3d), revision `964aa2076be23552640e32962f31cac60ccca4cc`.

Gaussian particles gather into matte lettering using the original B opening. Points are sampled evenly across a single glyph face, all in warm ivory (#fffaf0). Normal alpha blending and consistent soft point sizes avoid bright bevel outlines and sparkling overlap. No solid meshes or rigid-body balls are rendered; subtle camera parallax remains.

The scene displays **Jinyuan Xu** in Comic Sans MS Regular, sampled from fixed rendered name artwork with the original word spacing and baseline. The font's curved J and descending y remain intact.

The A interaction is applied in screen space: hover gently repels points, movement adds restrained inertia, and a click/tap or **Send a ripple** launches an expanding impulse. Damped springs return displaced points to their exact glyph positions. **Re-generate** dissolves the current, displaced cloud into noise and repeats the original opening.

The stage preserves vertical touch scrolling, pause/resume, reduced-motion behavior, hidden-tab/offscreen suspension, and the text fallback when WebGL fails.

## Rebuild

With a current Node.js installation, run from the website directory:

```sh
npm ci --prefix src/reference
npm run build --prefix src/reference
```

The build produces `docs/reference-scene.js` and license notices under `docs/vendor/reference/`. The resulting site needs no Node.js, runtime CDN, Astro, or package installation. Upload the complete `docs/` directory, including notices.

Build dependencies are pinned in `package.json` and `package-lock.json`. For an existing external dependency installation, set `REFERENCE_BUILD_DEPS` to its directory when running `node src/reference/build.mjs`.

## DOM contract

- `#reference-stage`: empty element covering the hero; receives the transparent WebGL canvas.
- `.hero-bottom`: bottom text/controls block; its height is used to frame the camera.
- `.reference-controls`: controls wrapper, initially `hidden`; shown after a successful render.
- `#reference-status`, `#particle-ripple`, `#reference-regenerate`, `#reference-pause`: live visual status and controls.
- `body.reference-ready`: applied after the first successful render and removed on failure; CSS can use it to conceal the accessible fallback heading visually.

The stage should use `touch-action: pan-y` so touch users can scroll vertically. Foreground links and controls need a higher stacking level than the stage. The accessible name/heading should stay in the DOM when the visual fallback is hidden.

Reduced motion starts with fully formed, static colored points and no continuous rendering. Ripple and regenerate buttons are disabled while paused; explicit **Resume motion** enables animation and interaction. Sampling counters are visual rather than assistive live announcements.

Particle colors, cumulative color proportions, and point size are in `palettes.ts`; sampling, spring interaction, and camera framing are in `scene.ts`; DOM initialization is in `entry.ts`. See `ATTRIBUTION.txt` and the included full licenses before redistributing.

`name-artwork.png` and `name-artwork.json` contain the two fixed rendered words and their layout. They are checked in and bundled directly, so visitors need no installed font. To regenerate this artwork, use Python with Pillow and a local Comic Sans MS Regular font: `python src/reference/render-name.py "/path/to/Comic Sans MS.ttf"`. The system font file is never copied into the website.

`build-font.mjs` and `font.typeface.json` are retained from the earlier Space Grotesk iteration, with their SIL Open Font License notice. They are not loaded by the current scene.
