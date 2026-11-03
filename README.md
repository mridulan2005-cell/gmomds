# Dadi's Map

A calm tablet app shared by a grandmother (Dadi) and her grandchild. Each day there is one drawing prompt. Each of them draws an answer on paper and scans it. The app traces their own lines, works out what was drawn, and brings it to life as a small hand-drawn 3D object on a floating island. Seven pairs finish a place and reveal its hidden theme, four places make a map (a town, a hillside, an animal sanctuary…), and every scan is kept in a scrapbook.

Built from the design handoff in [`design_handoff/`](design_handoff/README.md): Vite, React, TypeScript, three.js and IndexedDB. It is made for iPad, in landscape or portrait, and can be added to the Home Screen to run full-screen.

## Run it

```bash
npm install
cp .env.example .env    # then add ANTHROPIC_API_KEY
npm run dev             # https://<your-computer-ip>:5173
```

On the iPad, open the **Network** URL that Vite prints. The page is HTTPS, which Safari needs before it allows the camera. The certificate is self-signed, so tap through the warning once. For a full-screen app, use Share → Add to Home Screen.

Other commands: `npm test` (scan pipeline tests), `npm run build`, `npm run preview` (the built app over HTTPS, with the API), `npm start` (plain HTTP production server; put it behind HTTPS), and `npm run fetch-model` (see below).

**On Vercel:** the `api/` folder holds the serverless functions for `/api/recognise`, `/api/prompt` and `/api/health`, using the same code as the dev server. Add `ANTHROPIC_API_KEY` under Project → Settings → Environment Variables and redeploy. `/api/health` shows `"ai": true` once the key is in place. Without the key the app still names drawings, for free, on the tablet: CLIP (a ~90 MB model downloaded once from Hugging Face and then cached) compares the drawing with what people usually draw for the day's prompt (`src/lib/likely.ts`) and everyday things. When it is unsure, the app asks "Is it a …?" with its best guesses to tap. DoodleNet and the prompt's words are the last resort.

## How a drawing comes to life

1. **Capture** (`src/screens/Scan.tsx`): this is the front camera inside the tray viewfinder ("Switch camera" uses the rear one). When a sheet is found, no hands are over it, and it is held still for about 1 second, it is captured automatically. Saying "take" (or "click", "snap", "cheese") captures it too, where the browser offers speech recognition. "It's on the tray" captures by hand, and "Use a photo" takes a photo or picks one from the library. "Retake" scans a drawing again, right after scanning or later from today's sketches. Dadi scans first, then the grandchild; the order of scanning decides whose drawing is whose.
2. **Clean-up** (`src/scan/pipeline.ts`, in a Web Worker):
   - Finds the sheet: the bright, colourless region nearest the middle (after removing the colour of the light). Skin is never paper, so hands, a lap or a busy table are left out, and a hand over a corner does not cut it off (the four sides are extended to meet). Then it corrects the perspective.
   - Keeps only what is on the sheet: hands (and their shadows) reaching in from the edge, and anything else coming from outside the sheet, are removed, even where a finger touches the drawing. The scrapbook photo shows only the sheet.
   - Estimates the paper's brightness, so shadows don't count as ink.
   - Picks out pencil and pen lines and crayon colour, then removes specks and crops.
   - Says "Try again" if the page is empty or the photo is blurry.
   - The colour crop is kept as the real scan for the scrapbook.
3. **Vectorise**: each area enclosed by a line, and each coloured-in area, becomes a separate puffy region (`f`). Separate regions keep a tail or a beak as its own piece. Lines are thinned to their centre (Zhang–Suen) and become pencil strokes (`s`). Eyes and dots drawn on top of colour are kept. Everything is smoothed, simplified and fitted into the 64×64 box. Each region's crayon colour is sampled from the photo. Nothing is redrawn: the 3D object is built from that person's own lines.
4. **Recognise: works for any drawing** (`src/scan/scanner.ts`):
   - **Claude vision** (`server/api.mjs`) gets the scan, the day's prompt and who drew it. It is told these are rough drawings by a grandmother and a small child, and that the thing can be anything at all. It answers with `{kind, label, confidence, motion, place, alternatives}`.
   - **DoodleNet, on the tablet** (`src/scan/doodle.ts`), is used when Claude can't be reached. It is a TensorFlow.js model trained on Google's Quick, Draw! dataset and recognises 345 everyday things. The day's prompt is used as a hint.
   - **The prompt's words** are the last resort.
   - `src/lib/motionRules.ts` gives any word a motion, so typed corrections come alive too.
   - "Not quite?" lets the family pick another guess or type what it is.
5. **Bring to life** (`src/map/MapScene.ts`, a port of the prototype's `map3d.js`): **the drawing is not redrawn.**
   - The 3D object is the drawing's own outline, cut out closely with a thin white rim (the paper between a cat's legs is cut away) and given depth like a puffy sticker. Areas the lines enclose stay solid. A sun or hearts drawn beside it become small pieces of their own; grey specks of the paper are dropped.
   - The drawing's own image (paper made white, every line and crayon colour kept) is printed on its front and back.
   - It then moves according to what it is: things fly, swim, sway, float, spin, bounce, swing, flicker, rock, flow, walk or hop. Sky things hover high and water things sit low.
   - The newest pair rises up out of the island.
   - Sample drawings, which have no scan, use the prototype's toon style with "boiling" pencil lines.

### Recognising drawings with no internet connection

By default, DoodleNet's weights load from the jsDelivr CDN the first time a scan happens. To bundle them with the app instead, run this once on a computer with internet access:

```bash
npm run fetch-model
```

This saves the weights to `public/models/doodlenet/`.

## Drawing each other

Onboarding has seven steps, starting with the grandchild (`src/screens/Onboarding.tsx`): they say their name (typed, or spoken with the mic where the browser can listen), pick what they love, and choose who they are playing with (Grandmother, Grandfather, Mom or Dad). Then the grown-up gives their name and picks, with a dot on what the grandchild chose. Last, they draw each other with a finger on a blank paper card, with a pencil, an eraser and "Start over": the grown-up draws the grandchild, then the grandchild draws the grown-up. The placeholder sketches (`public/sketch-dadi.png`, `public/sketch-aarav.png`) are only used for data from before this. The caricatures are kept in `faces` and walk around the maps as little paper cut-outs (`MapScene.walker`): on a garden place they go from flower to flower and stop to smell each one, by the river they watch the water and wave, and elsewhere they stroll. On a finished Hillside, Forest or Desert they climb the big hill and wave from the top; on other finished maps they walk round the pond.

## Data

Everything is stored on the device in IndexedDB (`src/lib/store.ts`), following the data model in the handoff: people, loves, maps → places → pairs → drawings, with the paths stored rather than meshes. Scans are kept as JPEG blobs. There are no streaks or dates on the map, and a missed day carries the prompt over. Prompts come from Claude, using both people's picks and the hidden theme of the place, or from a curated list when Claude isn't available.

The **gear** on the Today screen opens a few tools for trying the app out: rename people, get a new prompt now, add sample pairs so you can see the reveal without waiting a week, or start over.

## Layout on iPad

The app is laid out on a logical canvas that is 1280 wide in landscape and 860 wide in portrait, and its height follows the screen. It scales to fit any iPad, respects the safe areas, and the 3D camera pulls back on narrow screens. Pinch-zoom is turned off, and reduced-motion settings slow the animations down.
