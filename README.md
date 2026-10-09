# OpenLandscape3D Cloud — web landscape planner

A free, open-source garden and landscape planner that runs in the browser: draw the site, choose
regional plants, plant hedges and drifts, then watch the design change through the seasons and over
the years in 2D and 3D. It is the browser sibling of the OpenLandscape3D iOS app and works with
OpenPlan3D. Projects are local-first (IndexedDB), so there is no account.

Hosted on Firebase Hosting (project `openlandscape3d`, site `openlandscape3d-cloud`).

## Features

- **Start:**
  - blank site, a rectangular lot with typed dimensions, or a template (suburban back yard with house, front yard);
  - metric or imperial units;
  - state or region picker with USDA zone for the three pilot regions (`regions.json`);
  - import an OpenPlan3D JSON (its walls become a building footprint you plant around) or an OpenLandscape3D file or link from iOS.
- **Sample gardens:**
  - Northeast back yard, Southeast front yard and Southwest dry courtyard (`src/lib/site/samples.ts`);
  - each is a complete design built from catalog ids, with no check findings;
  - one click (or the deep link `/#/sample/<id>`) opens your own copy; the sample never changes, and an untouched copy is reused instead of duplicated;
  - ids: `northeast-back-yard`, `southeast-front-yard`, `southwest-courtyard`.
- **Editor:**
  - synchronized 2D plan (SVG) and 3D view (three.js), with a split view;
  - pan, zoom and pinch; grid and snapping to grid and corners (Alt disables, Shift locks to 45°);
  - live length and area readouts;
  - building, hardscape, planting, field-note and label layers;
  - undo/redo, autosave and keyboard shortcuts.
- **Drawing:**
  - property boundary;
  - areas (lawn, bed, mulch, gravel, patio, path, deck, driveway, water) with vertex editing, area readout, a material from `materials.json` and a per-area sun or moisture override;
  - fences (board, picket, metal, rail) with gates, retaining walls and edging;
  - site objects using OpenPlan3D outdoor ids (pergola, shed, raised bed, pots, boulders, bench…).
- **Plants:**
  - catalog search and filters: form, sun, moisture, native to the region, hardy in the zone, bloom month, colour, mature height, maintenance, deer resistance and wildlife;
  - a plant detail sheet with facts, a growth scenario, sources and a "draft — unreviewed" provenance badge.
  - Placement modes: single, row/hedge along a line, drift (seeded Poisson-disk scatter of a mix) and grid. Spacing comes from the catalog.
  - Groups are deterministic: the same recipe and seed always give the same plants.
- **Time:**
  - month, years after planting (0/1/3/5/10/20) and time of day;
  - growth and season models exactly as in the contract;
  - 2D symbols drawn at the scenario size, with optional mature-canopy rings;
  - in 3D, instanced procedural plants with bloom, fall colour and leaf-off, plus a sun at the solar position (latitude, month, solar hour, north) that casts shadows for sun/shade studies (the Shadows toggle; the Time slider is solar time, 12 = sun due south);
  - **Render** makes an HD (1920) or 4K (3840) PNG still with detailed plants, lit by the same sun.
- **Field notes:**
  - notes, photos, issues, measurements and existing-plant inventory captured in the iOS app appear as pins on the plan (shape and colour by kind, numbered in date order, greyed and struck through when resolved) and in the **Notes** tab, which lists every observation — including ones without a plan position — with an "Unresolved only" filter;
  - the Inspector shows the kind, date, author, text, measured value, linked plant (one click selects it) and a Resolved toggle; for photos it names the file — the photo itself stays on the device that took it, because files and links never carry photo bytes;
  - add your own with the **Note** tool (Draw panel or `N`): click the plan, type in the Inspector. Web notes are signed `web`, can be edited and dragged, and travel to the app like any other observation;
  - observations are append-only (contract): field observations can be resolved but not edited, moved or deleted; *Delete* resolves them. Only a note written in this session and not yet exported or shared is truly deleted. Every change is undoable;
  - the print sheet lists the open notes, numbered to match their pins on the plan (hide the Field notes layer to leave them out).
- **Design checks:** every `OL-*` rule from the contract (`src/lib/analysis/checks.ts`). Each check has an explanation, a click-to-select subject, and an override with a note.
- **Options:** save, compare (plants, species, % native, lawn, beds, hardscape, checks) and restore named alternatives.
- **Output:**
  - plant schedule and task schedule CSVs (contract columns, dated from the site's frost dates);
  - a print/PDF page with plan, schedules, bloom calendar, task calendar and checks;
  - PNG of the plan or 3D view, and GLB;
  - OpenPlan3D JSON, the OpenLandscape3D project file, and "Open in OpenPlan3D" (handoff POST, falling back to a JSON download);
  - a view-only share link and "Open in the iOS app". Both carry the design inside the link; links over 8,000 characters (common for large gardens) get a warning and the project file as an alternative.
- **Analytics:** consent-aware GA4 (`G-B25TCSWH9J`, `src/lib/analytics.ts`). Nothing loads until the visitor clicks "Allow analytics"; Global Privacy Control counts as no. Page views carry only a fixed screen name (`/home`, `/editor`, `/view`, `/print`, `/import`) and events only fixed labels (`export` kind, `share` long/short) — never the URL fragment, which can hold a whole design, nor names, ids or coordinates.
- **Privacy:**
  - links carry the design in the URL fragment, so nothing is uploaded;
  - links never carry a precise location, observation coordinates or the embedded web project.

## Deep links

The marketing site's plant pages, tools and guides open the planner with these hash routes (`src/lib/io/routes.ts`, tested in `tests/routes.test.ts`). Every value is validated; unknown ones fall back to defaults.

| Route | Effect |
|---|---|
| `#/sample/<id>` | Opens your copy of a sample garden (an untouched copy is reused). |
| `#/new?region=us-northeast&zone=6b&state=NY&template=backyard\|frontyard\|rect\|blank&units=imperial\|metric&name=…` | Starts a new site. |
| `…?plants=<id>,<id>&tool=plant\|row\|mass\|grid` | On `#/new`, `#/sample/<id>` or `#/p/<id>`: opens the Plants panel with those plants armed for placement (single plant → Place; several → Drift unless `tool` says otherwise). The query is dropped after use so a reload does not re-arm. |

`index.html` carries Open Graph tags with `public/og.png` (1200×630), so shared links preview with an image; `public/manifest.webmanifest`, the PNG icons and `public/robots.txt` sit beside it.

## Working with the iOS app

[openlandscape3d-ios](../openlandscape3d-ios) and this planner exchange the same OpenPlan3D JSON, with
the `openlandscape3d` block. The contract is `openlandscape3d-ios/docs/EXPORT_FORMAT.md`.

- **iOS → web:** the app opens `/#/import/v1/<payload>`. The page asks whether to open the site, replace your copy, or keep both.
- **Web → iOS:** Export › *Open in the iOS app* gives an `openlandscape3d://import/v1/<payload>` link, or a JSON file to AirDrop.
- **Payload:** raw-DEFLATE + base64url JSON (`src/lib/io/transfer.ts`), so no server is involved.
- **Round trips:**
  - web-only data (units, planting year, layers, canopy rings) rides in `openlandscape3d.web`, which iOS keeps verbatim;
  - unknown keys anywhere in the block are preserved;
  - unknown plant ids are kept as placeholders with the OpenPlan3D category they arrived with;
  - field notes merge by id as the contract requires (`src/lib/model/observations.ts`, same rule as iOS `ObservationMerge`): replacing a site with an incoming copy keeps the notes from both, and a resolved copy wins.
- **Parity:** `tests/interop.test.ts` has two halves.
  - It builds four web fixtures (one per pilot region plus one that triggers every rule) into `tests/fixtures/web-source/*.project.json`, `tests/fixtures/web/*.openplan3d.json` and `*.expected.json`.
  - It checks that iOS fixtures in `tests/fixtures/ios` give the same plants, groups, areas and design checks here.
  - Regenerate after a catalog or model change with `OL3D_WRITE_FIXTURES=1 npx vitest run tests/interop.test.ts`.
- **OpenPlan3D:** `tests/openplan.test.ts` runs exports through OpenPlan3D's real `validateRoomPlan` and `createProjectFromRoomPlan`. It needs a sibling `../../openPlan3D` checkout with `node_modules`, or set `OPENPLAN3D_DIR`; without one it is skipped. It checks two things:
  - plants, fences, gates, patios, pools and objects arrive with the right catalog ids and sizes;
  - a building file survives OpenPlan3D → OpenLandscape3D → OpenPlan3D unchanged.

## Develop

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # vitest: models, checks, groups, schedules, CSV, interchange, parity, OpenPlan3D importer
npm run check      # svelte-check
npm run catalog    # copy ../openlandscape3d-www/catalog/data/*.json into src/lib/catalog/
npm run deploy     # build + firebase deploy --only hosting
```

## Layout

```
src/lib/model/      types (the contract's block shapes, metres), geometry, units
src/lib/catalog/    catalog loader + plants/regions/materials/schedule-rules JSON (from openlandscape3d-www)
src/lib/analysis/   growth & season models, OL-* checks, group resolution, schedules, solar position
src/lib/site/       regions/climate defaults, new-site templates
src/lib/scene/      procedural, instanced three.js builders
src/lib/io/         OpenPlan3D import/export, transfer/share links, handoff, IndexedDB storage, CSV
src/lib/ui/         Svelte 5 components (editor, plan, 3D, panels, home, import, print)
tests/              vitest; fixtures/catalog is a small schema-valid catalog for unit tests
```

Units are metres everywhere. Plan x maps to world X and plan y to world Z, with +y pointing down the
screen. Object rotation is in degrees with front = (−sin r, cos r), matching OpenPlan3D and the iOS app.
North is a plan vector (default `[0, -1]`, up the screen).

MIT licensed. Plant facts are a draft, unreviewed editorial pass; sizes and seasons are scenarios, not
predictions. Prices are planning ranges, not quotes. Powered by OpenPlan3D.
