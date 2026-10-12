# Jinyuan Xu · 徐瑾源

Personal academic homepage, published with GitHub Pages.

## Local preview

```sh
python3 -m http.server 4173 --directory docs
```

## Editing

- `docs/index.html`: homepage text and sections.
- `docs/reference.html`: compatible copy of the homepage.
- `docs/styles.css`: layout, colors, and responsive styles.
- `docs/cv.html`: selected CV information.
- `src/reference/`: source for the interactive particle name.
- `docs/assets/`: website photographs and research illustrations.

The name uses Comic Sans MS Regular rendered artwork and uniform warm-white particles. No font installation is required for visitors.

To rebuild the particle bundle:

```sh
npm ci --prefix src/reference
npm run build --prefix src/reference
```

## Publishing

GitHub Pages serves the `docs/` directory on the `main` branch. Commit changes and push to update the site.

The particle scene is adapted from Liangbing Zhao's MIT-licensed homepage. Full notices are included in `docs/vendor/reference/`. Photographs and personal content belong to their respective owners; third-party asset sources are listed in `docs/assets/SOURCES.md`.
