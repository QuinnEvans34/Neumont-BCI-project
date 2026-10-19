# Cairn

A focus game in a photo-scrapbook style. A plank balances on the tip of a pointed rock; a hand reaches in from above and stacks stones on it. Steady signal keeps the tower still. Distraction makes it sway, and a long sway topples it. Every stone is a point. Every fifth stone the cairn gets touchier, and fireflies and gusts of wind come by more often, and bigger, as it grows.

All art is the club's own photos (taken October 14, 2026), cut out with a white paper margin so each moving piece looks scissored from a print. The background photo is pasted onto a scrapbook page with two views shot higher up taped above it, so a tall cairn climbs from the boulder into the branches and then the sky. The camera never shows the bare page: it stops pulling back once the view is as wide as the photos, and a tall cairn's base drops out of view instead.

## How to play

Connect → Calibrate → Choose a game → **Cairn**. Pick a mode, then **Start stacking**.

| Mode | Stones arrive | What ends the round |
| --- | --- | --- |
| **Calm** | The hand only moves while the tower is still. At full steadiness it places a stone every 3 s; when you lose focus it stops mid-air and waits. | The sway grows past the fall angle. |
| **Go** | Every 6 s, ready or not (2.4 s off-page, 2.5 s descent, release, exit). The badge counts down to the next stone. | A stone lands while the tower is swaying, or the sway grows past the fall angle. |

- The round ends when the cairn falls. The score, in paper cut-out digits, is the number of stones placed; the stone that knocks a tower over does not count.
- **Levels.** After every fifth stone the tilt that topples the cairn shrinks by 30%, with no pause or celebration: 17.2° for stones 0–4, 12.0° for 5–9, 8.4° for 10–14, 5.9° for 15–19, and so on. Go mode's drop limit shrinks the same way.
- **Events.** None in the first 14–22 s; then a firefly or a gust 14–34 s after the last one ends, tightening to 4–10 s by 25 stones. Each has a strength from 0 to 1 that grows with the stone count:
  - A **firefly** crosses the view, scurrying along the boulder or (more often when big) flying through the air. Small ones are about 3% of the stage's width long and dash past in under 3 s; big ones are about 10%, glow brighter and take up to 7 s. Sizes are relative to the view, so a big firefly stays big on screen as the camera pulls back for a tall cairn. A firefly changes nothing in the physics; it is a distraction, and its lantern can be an SSVEP stimulus (below).
  - A **gust** pushes the tower to one side for 2–5 s, with wind streaks (and leaves when strong), and lowers both topple limits by up to 35% at its peak. A steady player rides out even a big late gust; a distracted one does not.
- **Best scores** are kept per mode *and* per input source (live headset, recording, simulation), so practice on a recording never sets a record a live player cannot beat. The last 100 rounds are kept in this browser only; no EEG is stored.
- Switching mode, **Start a new cairn**, a new session or a recalibration ends the current cairn; one with stones is logged as "ended".
- Pause, Change game, a hidden tab, stale or rejected input all freeze the cairn until **Resume**, as in the other games. A recording reaching its end is not a fall.

The side panel shows the **sway** gauge, whose end is the current topple limit (so it fills faster at higher levels and during a gust), with the calm-mode "steady" mark and, in Go mode, the red "a landing stone knocks it over" mark, plus the live signal level against the baseline.

## Fireflies as an SSVEP stimulus (opt-in)

**Fireflies blink at 15 Hz (SSVEP)** in the side panel makes each firefly's lantern a square-wave flicker while the game runs. It is **off by default** and remembered per browser; it is forced off when the system asks for reduced motion. Off, lanterns glow and pulse gently at 0.8 Hz. Flicker stops whenever the cairn pauses or falls.

- **Why 15 Hz.** The game's score is relative alpha, 8–12 Hz power over 4–30 Hz (`backend/signal.py`). A 15 Hz stimulus and its harmonics (30, 45 Hz) stay out of the alpha band, so a firefly does not feed the score directly, though a strong response adds a little to the 4–30 Hz total and so slightly lowers it. 15 Hz is also an exact 2-frames-on/2-off square wave on 60 Hz displays (4/4 at 120 Hz, 8/8 at 240 Hz). On other refresh rates the duty cycle wobbles but the fundamental stays at 15 Hz. `BUG_HZ` in `CairnStage.tsx` sets the rate.
- **Timing.** On/off is computed from the animation-frame timestamp, with a 1/8-cycle phase offset so frame jitter cannot flip a frame. Measured end to end in headless Chrome (sampling the rendered canvas every frame), the brightness spectrum peaks at 15.0 Hz with the square wave's 45 Hz harmonic.
- **Flicker log.** Every stretch of blinking is logged with its start and end (epoch milliseconds from the frame clock), rate, firefly strength and path, mode and input source. **Download flicker log** saves the last 1000 as CSV with onset/offset in Unix seconds, the same clock BrainFlow stamps samples with when the backend runs on the same machine.
- **Size.** The largest lantern glow spans at most about 14% of the stage's width (about 140 px on a 1000 px wide stage), and its bright core is a fraction of that. That keeps the flashing area within WCAG's "small flash" allowance (a quarter of a 10° visual field) on a typical laptop screen, but the allowance depends on screen size and viewing distance.
- **Safety.** Flashing can trigger seizures in people with photosensitive epilepsy; staying under the flash-area limit is not a guarantee. Follow the project's SSVEP guidance (`docs/p300-ssvep-research.md`): turn it on only for players who have agreed to it, never for an audience that has not, and stop for any discomfort.

## How the signal moves the tower

`apps/web/src/cairnSimulation.ts` is a pure, deterministic model fed the published score (0.5 = baseline) in bounded steps (≤ 0.1 s, 120 Hz substeps):

- **Focus** = `(score − 0.35) / 0.45`, clamped to 0..1 and smoothed (τ 0.6 s). The baseline score gives 0.33.
- The plank is a damped inverted pendulum about the pivot tip: stiffness `0.6 + 12·focus − 0.3·stones`, damping `0.4 + 2.4·focus`. Height makes the tower top-heavy.
- **Wind** is a fixed sum of three slow swells; its strength grows with distraction (`(1 − focus)³`), height, and **unrest**.
- **Unrest** builds while focus stays below the baseline (full after 12 s at zero focus) and settles once you are back above it (6 s). It is why a prolonged lapse always topples the tower, however short.
- **Sway** is the swing's envelope: steady below 0.045 rad (≈ 2.6°). A new cairn falls at 0.3 rad (≈ 17°) and Go mode's drop limit is 0.075 rad (≈ 4.3°); both shrink by `TIER_FACTOR` (0.7) every `TIER_STONES` (5) stones, and by up to `GUST_THRESHOLD` (35%) at a full gust's peak (`fallAngle`, `dropSway`).
- A **gust** adds a push of up to `GUST_PUSH` (0.12 rad/s², more on a taller tower) that arrives over a quarter of its length, holds, and eases off.
- **Events** are part of the model, scheduled from the round's seed, so a round replays identically.
- Setting a stone down off-centre gives the tower a small nudge.

Tuned so a typical player averages about 15 stones in Calm mode. Measured with the same model as the game: one round at a constant score (seed 3), and the mean of 100 rounds at that average score with realistic noise (s.d. 0.09, about 3 s correlation, like the recorded session):

| Score | Calm, constant | Go, constant | Calm, noisy | Go, noisy |
| --- | --- | --- | --- | --- |
| 0.30 | falls after 4 s | falls after 5 s | 1.0 | 0.0 |
| 0.40 | falls after 9 s | falls after 5 s | 1.5 | 0.3 |
| 0.45 | 1 stone | 1 stone | 2.6 | 1.0 |
| 0.50 (baseline) | 15 stones in ~3 min | 5 stones | 6.1 | 2.2 |
| 0.55 | 17 stones | 11 stones | 11.3 | 4.8 |
| 0.60 | 22 stones | 13 stones | 15.6 | 8.9 |
| 0.65 | 22 stones | 24 stones | 20.8 | 11.9 |
| 0.70 | 23 stones | 26 stones | 23.9 | 16.0 |
| 0.80 | 42 stones | 27 stones | 28.5 | 21.8 |

Across noisy players averaging 0.5–0.7, Calm averages 15.5 stones and Go 8.8 (Go was already the harder mode: 11.9 before levels and events). The recorded OpenBCI meditation session (below, mean score 0.69) builds rounds of 14–37 stones in Calm (median 25) and 5–26 in Go (median 18). The Simulation source swings between 0.1 and 0.9 every 16 s, so it topples within about 15 s; it exercises the flow, not the difficulty.

**What the score is.** Cairn uses the shared input contract unchanged: smoothed relative alpha compared with your own baseline. Higher relative alpha often accompanies relaxed, settled attention rather than effortful concentration, so "focus" here means "stay settled and still". It is not a validated measure of focus.

## Testing with recorded EEG (no headset)

Three levels, from the real pipeline to the fastest loop.

### 1. Full pipeline: replay a recording through the backend

OpenBCI GUI ships real Cyton sessions in `Documents/OpenBCI_GUI/Sample_Data`. Convert them to the BrainFlow-RAW CSV that replay reads (output goes to the ignored `data/recordings/`):

```sh
python -m backend.openbci_convert ~/Documents/OpenBCI_GUI/Sample_Data/OpenBCI_GUI-v6-meditation.txt
```

Start the backend on that folder, then the frontend:

```sh
BCI_RECORDINGS_DIR=data/recordings python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
# PowerShell: $env:BCI_RECORDINGS_DIR="data/recordings"; python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
npm run dev
```

Choose **Recorded session** → `BrainFlow-RAW_OpenBCI_GUI-v6-meditation.csv` → **Start playback & inspect** → **Begin baseline** (60 s, all 30 windows accept) → **Choose a game** → **Cairn**. The 11.7-minute meditation file passes the channel gates on 99% of windows with no timestamp gaps. The 90-second blinks/jaw-clench sample is too short for a baseline plus play.

Club recordings saved by OpenBCI GUI as `BrainFlow-RAW*.csv` work the same way: put them in `data/recordings` (or point `BCI_RECORDINGS_DIR` at their folder).

### 2. Test bench: recorded game input at up to 8× speed

`python -m backend.score_trace` replays a recording through the backend's exact ingest, channel gates, feature, explicit baseline and score smoothing, offline, and writes the 4 Hz frames the browser would receive:

```sh
python -m backend.score_trace data/recordings/BrainFlow-RAW_OpenBCI_GUI-v6-meditation.csv --out tests/fixtures/cairn/openbci-meditation.json
```

With `npm run dev`, open http://127.0.0.1:5173/?cairn-preview to play that trace through the real game stage with no backend: pick Calm/Go, 1–8× speed, scrub the recording, or switch to a fixed-score slider or the simulation sine. **Crawling bug**, **Flying bug** and **Gust** start an event now at the chosen strength, and **Blink at 15 Hz** turns on the lantern flicker. Readouts show focus, unrest, sway, the hand phase, the level and current topple limit, and the event under way or when the next is due. **Load a trace file** accepts any trace JSON, so club traces can stay local. URL options: `&mode=go`, `&speed=4`, `&input=slider&score=0.6`, `&input=sine`, `&flicker=1`. The bench is excluded from production builds.

### 3. Automated tests

`tests/cairn.test.ts` covers the rules (3 s calm cadence, the hand holding still while swaying, the 6 s go schedule kept across levels, drop collapses, distraction toppling both modes, unrest, determinism, bounded time steps), levels (with no celebration at a new one), events growing commoner and stronger, gusts pushing and lowering the limit, bugs leaving the physics alone, stacking geometry (including the smaller plank), the taped photo column covering everything the camera may show, the score store and flicker log, and plays the recorded OpenBCI meditation trace through both modes. `backend/test_cairn_tools.py` covers GUI-text conversion and the trace tool's baseline and publish rate.

Only the trace from OpenBCI's public sample recording is committed. Keep traces derived from club members' EEG local (`data/` is ignored), per CONTRIBUTING.

## Art pipeline

Source photos live in `images/dump` (outside Git; about 270 MB). `tools/cairn_assets/build_cairn_assets.py` regenerates everything in `apps/web/src/assets/cairn`:

```sh
python tools/cairn_assets/build_cairn_assets.py --segment   # first run: cut-outs with Segment Anything
python tools/cairn_assets/build_cairn_assets.py             # re-compose from the cached masks
python tools/cairn_assets/build_cairn_assets.py --digits    # only the score digits
```

- `--segment` runs SAM ViT-H (Meta's Segment Anything, Apache-2.0, via `transformers`; needs `torch`, downloads ~2.5 GB once) on a hand-picked box per object and caches soft masks in `images/cairn-masks/`.
- Compose (needs only NumPy, Pillow and OpenCV): each stone is rotated onto its most level *stable* face (a convex-hull edge with the centroid above it); the plank is deskewed along its principal axis; the four hand frames are registered on the forearm (ECC) so only the fingers move; everything is scaled to world units (half the photo resolution) and given a faceted, slightly irregular white paper margin.
- The pivot rock stays part of the background photo, but `pivot.webp` overlays it at full photo resolution, lightly sharpened, with a feathered edge that blends into the identical pixels beneath. The background ships at 0.75 of the photo's resolution (finer than world units) and is drawn at `background.scale`. The stage renders at the screen's pixel density (up to 2×) so that detail reaches the display.
- The stage draws the photo, its pivot rock and the plank at `SCENE` (0.85) of world size, so the hand and stones, which keep their size, read at a believable scale against them; drawing the photo smaller also sharpens it.
- **Higher views.** `BG_MID.JPG` and `BG_TOP.JPG` were shot from the same spot, tilted up, but do not line up with `main_bg.JPG` (feature matching finds no overlap), so they become separate prints, `background_mid.jpg` and `background_top.jpg`, at the background's resolution; the mid view's lower third is ground level again and is trimmed. `printColumn` in `cairnGeometry.ts` stacks them above the main photo, each 5% wider than it, tilted about 1° and laid over the top of the print below with tape across the seam; the top view repeats, mirrored, for very tall cairns. The stage's camera stays inside that column.
- **Score digits** are cut from `images/paper_numbers.jpg` (a cream sheet with 1–5 above 6–9, 0) by colour distance from the backdrop: `digit0.webp`–`digit9.webp`, rendered by `PaperNumber.tsx`. The sheet's 0 is a solid orange blob, so the tool recolours it cyan (keeping the paper's crumples) and scissors a faceted hole out of it, following its own outline. The fireflies, wind streaks and leaves are drawn on canvas at load, in the same cut-paper style.
- `manifest.json` records sprite sizes, per-column top/bottom object profiles used for stacking, the pivot tip, the boulder's top edge (for bouncing stones), fingertip positions and the arm direction. `card.jpg` is the game-picker art.

| Photo | Becomes |
| --- | --- |
| `main_bg.JPG` | Background, plus a full-resolution overlay of the pointed rock whose tip is the pivot |
| `BG_MID.JPG`, `BG_TOP.JPG` | Higher views taped above the background (`background_mid`, `background_top`) |
| `wood_focus.JPG` | The plank |
| `stacking_rocks1.JPG`, `stacking_rocks2.JPG` | Nine stones (`rock1`–`rock9`) |
| `hand_open_big`, `hand_open_small`, `hand_opening`, `hand_closed` | Hand frames, widest pinch to closed |
| `images/paper_numbers.jpg` | Score digits `digit0`–`digit9` |

To add a stone, add its photo box to `OBJECTS` and its name to `STONES` in the tool; the game picks up every `rock*.webp` and the manifest's stone count automatically.

### Hand animation

The hand arrives along its own forearm, carrying the stone behind its fingers in the pinch that fits: `hand_open_small` for narrow stones, `hand_open_big` for wide ones (the hand shares the stones' 0.8 scale). It tilts with the tower in the last part of its descent, sets the stone down, closes through the remaining frames while lifting slightly, and leaves the way it came. After a fall it withdraws from wherever it was.

## Files

| File | Purpose |
| --- | --- |
| `apps/web/src/cairnSimulation.ts` | Pure model: focus, pendulum, wind, unrest, sway, levels, bugs and gusts, hand phases for both modes, falls |
| `apps/web/src/cairnGeometry.ts` | Stacking on measured contours, stone sequence, plank contact point, the column of photo prints |
| `apps/web/src/CairnStage.tsx` | Phaser stage: scrapbook page, taped photo column, swaying tower with slight flex, hand, fireflies (and their SSVEP flicker), gusts, collapse and bounce, framing camera that stays on the photos; sleeps while hidden |
| `apps/web/src/Cairn.tsx` | Play page: overlays, mode choice, score card, sway gauge with the current limit, flicker opt-in and log download, recent cairns |
| `apps/web/src/PaperNumber.tsx` | A number in paper cut-out digits |
| `apps/web/src/cairnScores.ts` | Validated per-browser bests, round log, flicker choice and flicker log |
| `apps/web/src/CairnPreview.tsx` | Development test bench (`?cairn-preview`) |
| `backend/openbci_convert.py` | OpenBCI GUI text → BrainFlow-RAW CSV |
| `backend/score_trace.py` | Recording → 4 Hz game input JSON via the service's own processing |
| `tools/cairn_assets/build_cairn_assets.py` | Photo → sprite pipeline |

## Credits

Photos: the club. Score digits: `images/paper_numbers.jpg`, supplied by the club. Sample EEG: OpenBCI GUI sample data (OpenBCI, MIT License). Segmentation: Segment Anything (Meta AI, Apache-2.0), used offline only; no model ships with the app.
