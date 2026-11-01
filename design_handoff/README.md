# Handoff: Dadi's Map

## Overview
Dadi's Map is a calm tabletop tablet app shared by a grandmother (Dadi) and her grandchild. Each day the app shows one drawing prompt. Each of them draws their own answer on paper and scans it, one after the other. Each drawing is turned into a small hand-drawn 3D object and placed on a floating "place" (an island). Seven pairs of drawings complete a place, and the place's theme stays hidden until it is finished. Four places make one monthly map. Finished maps stack into an archive, and every drawing is also collected in one scrapbook.

This package is meant for building the **functional version** in Claude Code: real scanning, real line extraction, and real drawings brought to life on the 3D map.

## About the Design Files
The files in this bundle are **design references created in HTML**. They are prototypes that show the intended look and behaviour, not production code to ship directly. Recreate them in a real app environment. If no codebase exists yet, a good stack is:
- **Vite + React + TypeScript** web app, run full-screen on a tablet as a PWA (or wrapped with Capacitor for iPad/Android).
- **three.js** for the 3D map. `map3d.js` is close to production quality and can be ported almost as-is into a React component.
- **OpenCV.js** (or a small custom pipeline) for scanning, and **potrace** (e.g. `potrace-wasm`) for turning drawings into vectors.
- **Claude API (vision)** to recognise what was drawn, so each drawing gets the right motion.
- Local persistence first (IndexedDB). Sync and backend can come later.

`Dadi's Map v4.dc.html` opens directly in a browser (it needs `support.js` beside it and an internet connection for fonts and three.js). The row of pill buttons under the device lets you jump between screens. It is a review tool only and is not part of the product.

## Fidelity
**High-fidelity** for colours, type, layout, buttons, and the 3D map look and motion. Recreate them closely. The sample drawings are placeholders: in the real app every drawing comes from a scan.

---

## The functional pipeline (the new work)

### 1. Capture
- Use the tablet's rear camera (`getUserMedia({video:{facingMode:'environment'}})`), or a fixed overhead camera above a tray. The tray screen (a stamp-shaped frame) is the live viewfinder.
- Auto-capture when a sheet of paper is detected and held still for about 1 second. Keep the "It's on the tray" button as a manual fallback.
- Scanning is done one person at a time: Dadi first, then the grandchild. Ownership comes from the scan step, never from analysing the drawing.

### 2. Clean-up
1. Detect the largest four-sided outline (the paper), then correct the perspective to a flat rectangle.
2. Convert to greyscale, then use adaptive threshold to get ink on white. Remove small specks and crop to the ink's bounding box with padding.
3. Keep a JPEG of the original crop for the scrapbook. The scrapbook may show the real paper scan, not a redraw.

### 3. Vectorise
- Run potrace on the binary image to get SVG paths, normalised into a 64×64 box (the same coordinate space as the `ICON` table in the prototype).
- Split the result into:
  - **closed regions** (`f` — become filled, puffy 3D volumes)
  - **open strokes** (`s` — become 3D pencil tubes)

  A practical rule: potrace outlines with an area above a threshold go to `f`. Thin outlines are skeletonised (e.g. Zhang–Suen) and their centre lines go to `s`.
- Simplify paths (about 1px tolerance) and cap the point count so 3D generation stays fast.
- Optional colour: sample the dominant non-ink colour inside each region from the photo and use it as the fill. Otherwise use the per-kind palette (`NC`).
- **Never redraw or merge drawings.** The 3D object must be built from that person's own lines.

### 4. Recognise (what is it?)
- Send the cleaned image plus the day's prompt to the Claude API (vision) and ask for a JSON reply: `{ "kind": "bird" | "fish" | "tree" | ..., "confidence": 0-1, "motion": "fly" | "swim" | "sway" | "float" | "spin" | "bounce" | "swing" | "flicker" | "breathe" | "none" }`.
- `kind` chooses the animation and where the object sits (sky objects such as birds, kites, sun and moon float higher). If confidence is low, use `motion: "breathe"` (a gentle idle).
- Map motions to the behaviours in `map3d.js` → `animate()` (bird = orbit and flap, fish = swim back and forth, boat = rock and drift, tree/flower = sway from the base, bell = swing, drum = bounce, diya = flicker, sun = slow spin, moon = float, waves/river = flow).

### 5. Bring to life (3D)
Port `map3d.js`. It already does everything needed from `{f:[paths], s:[paths]}`:
- `f` paths → `ExtrudeGeometry` (depth 6, bevel 2.4) with `MeshToonMaterial` (3-step gradient) in the fill colour.
- Every outline and stroke → `TubeGeometry` (radius 1.15–1.5) in the owner's ink, built twice with different random wobble. The two versions alternate every 0.22s to give the boiling pencil-line look.
- A new drawing rises from lying flat to upright over 1.4s (ease-out-back). Dadi's appears first, then the grandchild's 0.8s later.
- Soft disc shadow under each object. Island = extruded blob shape with ink outline tubes. Places in progress are white at 42% opacity with a dashed outline and a pulsing "?". Locked places are grey with a lock sprite.
- Cache geometry per drawing id. Build it once, right after the scan, and store the generated paths, not the meshes.

### 6. Data model
```ts
Person   { id: 'dadi' | 'child', name, inkColor }
Prefs    { personId, loves: string[] }               // from onboarding tiles
Prompt   { id, text, date }                          // generated from prefs
Drawing  { id, personId, promptId, createdAt, scanJpeg: Blob, paths: {f:string[], s:string[]}, kind, motion, fillColor }
Pair     { promptId, dadi: Drawing.id, child: Drawing.id, slot: 0..6 }
Place    { id, monthId, index: 0..3, name, theme, shape: 'A'|'B'|'C'|'D', color, status: 'locked'|'current'|'done', pairs: Pair[] }
Month    { id, name, places: Place[4] }
```
Rules: no streaks and no dates shown on the map. A missed day simply carries the prompt over. A place's name and theme stay hidden until it has 7 pairs. Completing a place unlocks the next one. Completing four places completes the month, which then joins the map stack.

### 7. Prompts
Generate the next prompt from both people's onboarding picks and the hidden theme of the current place (e.g. theme "Garden" → "Draw something that grows"). Use the Claude API or a curated list. One short line, open-ended.

---

## Screens / Views
The frame is 1280×800 (landscape tablet), inside a cream bezel `#F8EBC2` with radius 56 and an inner screen radius of 28.

1. **Onboarding (2 steps):** background `#FFFBF0`. "Before we begin · 1 of 2" (21px/700, 65% opacity). Title "{Dadi}, what do you love?" (60px/800, -0.025em; the name in the person's ink colour). A 6×2 grid of 160px blob tiles (radius `46% 54% 42% 58% / 55% 45% 55% 45%`). A selected tile gets a 14% ink tint, rotates -3deg and scales to 1.05. On step 2, a dot marks Dadi's picks. Primary button "That's me" / "Start our map".
2. **Today (home):** teal sky `#8FD6D0`, drifting clouds `#CDEDEA`, and a sun in the top-right corner (`#FFC93C` disc, `#F5A623` rays, 80s spin). Pill "Today's prompt" (cream `#FFF3D1`, text `#1F4C4A`). Prompt in 92px/900, -0.03em, `#1F4C4A`. Primary button "We're done!". After scanning, the screen says "Today's drawings are on the map." and "A new prompt arrives tomorrow." Bottom bar: Map, Scrapbook.
3. **Scan (Dadi, then the grandchild):** mustard `#F5C84C`. Heading "Put [Name]'s drawing on the tray" (54px/900; the name in a pill of the person's ink colour with cream text). The tray is a 400×460 cream stamp `#FFF6E3` with perforated edges (radial-gradient dots in the background colour), rotated -1.5deg. Inner tint `#DCE6FA` for Dadi and `#FBE1D7` for the grandchild. The scanning bar is a yellow gradient sweep over 2.4s while the drawing reveals top to bottom. When done, a green check badge (`#6CC24A`, shadow `#3f9a28`) pops in. Buttons: "It's on the tray", then "Now {child}'s turn" / "See today's sketches".
4. **Today's sketches:** pink `#E9A3C0`. Giant "TODAY'S" / "SKETCHES" in 190px/900 mustard `#F5C84C` behind two 290×350 stamps. The owner's name is printed on each stamp, and the stamps bob gently. Button "Show on map".
5. **Place (3D):** sky gradient `#8FD6D0 → #CDEDE6 → #FFF6DE`. Title "Theme: ???" (46px/900 `#1F4C4A`) with a hint below. A cream card shows a 7-dot stepper (filled `#F26A2E`, newest `#FFC93C`, empty ring at 30% ink) and "N more to go". After the 7th pair, the button "See what we made" replaces the bottom bar.
6. **Reveal:** the island fades from ghost to solid colour over 2.6s, then "This is your Garden!", then "See our map".
7. **Inside a map (3D):** four islands on a dotted yellow path, with name pills. Drag to turn it. Tap a place to open it.
8. **All maps (3D stack):** months as stacked cream boards 900 units apart. The month in progress is on top, 35–50% opacity, with dashed edges. Scroll or drag moves through the stack, and tapping a board goes inside it.
9. **Scrapbook (single):** pink `#E9A3C0`. "OUR SCRAPBOOK" in 72px/900 mustard, a section pill "{Place} · {Month}" and a legend. Three entries per page: the pair of drawings above a paper note (`assets/paper-note.png`) with "Day N" and the prompt. Round cream arrow buttons. It opens on the newest page.

**Navigation:** the bottom bar always shows the two other main destinations. On Today it shows Map and Scrapbook. On any map screen it shows Today's prompt and Scrapbook. In the scrapbook it shows Today's prompt and Map. A top-left back button appears only when you are inside a map or a place.

## Design Tokens
- Ink `#3d2b22` · Paper `#FFFBF0` · Cream `#FFF3D1` (shadow `#E0C886`)
- Dadi ink `#2F5FD0` · Grandchild ink `#E4572E`
- Primary orange `#F26A2E` (bottom edge `#B9481B`) · Sun `#FFC93C` · Mustard `#F5C84C` · Pink `#E9A3C0` · Teal `#8FD6D0` · Deep teal text `#1F4C4A`
- Island colours: river `#8CCFF0`, garden `#9BD770`, market `#F6C778`, rooftop `#F2A28A`. Path dots `#FFC93C`.
- Drawing fills (`NC` in the prototype): cat `#FFB26B`, bird `#FFC93C`, mango `#FF9F1C`, chai `#C98B5A`, diya `#FF7A1A`, kite `#FF5D8F`, note `#9B5DE5`, waves `#5AB0F0`, tree `#6CC24A`, moon `#FFE066`, fish `#FF8A3D`, home `#E86A4A`, sun `#FFCE1F`, boat/drum `#E4572E`, bell `#FFC93C`, flower `#FF7BAC`.
- Type: Urbanist 500/700/800/900.
- Primary button: height 88–96, padding 0 48–52, radius 12, 32–38px/900 uppercase, `box-shadow: 0 9px 0 #B9481B`, rotate -1deg. When pressed it moves down 6px and the shadow shrinks to 3px.
- Cream button: height 66, radius 10, 24px/900 uppercase orange text, `box-shadow: 0 7px 0 #E0C886`, rotated ±1deg.
- Motion: slow and gentle. Clouds 40–60s, sun 80s, stamp bob 3s, drawings 1.6–10s loops. Respect reduced-motion settings.

## Assets
- `assets/paper-note.png`: the paper note with green tape, supplied by the user (transparent PNG, 1104×827).
- Placeholder icons: the `ICON` table in the DC logic (64×64 paths), adapted from the user's own `Dadi's Map (1).html`. In production these are replaced by scans.

## Files
- `Dadi's Map v4.dc.html`: the full prototype (all screens and the flow logic in the `Component` class).
- `map3d.js`: the `<dadi-map3d>` web component (three.js r160 from esm.sh). Islands, 3D drawings, motions, the map stack and picking. It takes a `config` JSON (`mode: 'place'|'month'|'stack'`) and calls `window.__dadiMapPick({type, mi|pi})` when something is tapped.
- `support.js`: the runtime needed to open the `.dc.html` locally.
- `assets/paper-note.png`

## Suggested build order for Claude Code
1. Set up the app shell, the screens and the navigation from the prototype, with local storage.
2. Port `map3d.js` into a React component and render it from stored data.
3. Build the camera capture screen, paper detection and perspective correction.
4. Add thresholding, potrace, and the `{f,s}` 64×64 normalisation, then test by feeding the 3D map real drawings.
5. Add Claude vision recognition for `kind` and `motion`, plus prompt generation.
6. Polish: auto-capture, error states (blurry photo, no paper found, empty page → "Try again"), reduced motion, and running full-screen as a PWA.
