# Architecture

PokéChad is a static site: plain HTML, CSS and JavaScript modules, with no
framework, no dependencies and no build step. GitHub Pages serves the
repository exactly as it is.

## Layout

```
index.html               page shell: header, <main id="view">, dialog and toast roots
css/style.css            all styling (pixel-art rules are explained at the top)
js/
  app.js                 boot, state ownership, routing, the tick, actions, dialogs
  state.js               default state, validation, load/save, export/import
  scoring.js             points formula, display multiplier, recalculation   (pure)
  rewards.js             starter, tiers, rolls, caps, shinies, pity           (pure)
  stopwatch.js           start / pause / resume / finish, break limit         (pure)
  dom.js                 h() element helper, formatters, sprite()
  pixelart.js            hand-drawn icons as text bitmaps, rating stars
  sfx.js                 square-wave sound effects (Web Audio)
  views/
    dashboard.js         big buttons or stopwatch, compact progress tile, nav
    rate.js              rating dialog and "add past time" dialog
    starter.js           the one-off starter choice
    reveal.js            the encounter: silhouette, throw, reveal
    pokedex.js           totals bar, all / shinies switch, grid, detail dialog
    history.js           list of every session
    stats.js             all-time tiles and two charts
    settings.js          export, import, sound, reset, about
sw.js                    service worker (offline, installable)
manifest.webmanifest     install metadata
data/pokedex.json        generated: every species with tier and sprite flags
assets/sprites/          generated: normal/{id}.png and shiny/{id}.png, 96x96
assets/icons/            Snorlax and Zacian button art, app icons
assets/fonts/            Press Start 2P and its licence
tools/update_pokedex.py  regenerates data/ and assets/sprites/ from PokeAPI
tests/logic.test.js      tests for the pure modules and the save format
.github/workflows/       monthly Pokédex update (opens a pull request)
```

## The three layers

**Pure logic** (`scoring.js`, `rewards.js`, `stopwatch.js`). No DOM, no
storage, no clock: the current time and the random generator are passed in.
This is what the tests exercise.

**State** (`state.js`). One plain object holds everything. `normalize()`
validates any JSON into that shape and recalculates the derived fields, and
is used for both loading from `localStorage` and importing a file.
[storage.json.md](storage.json.md) documents the object.

**Interface** (`app.js`, `views/`, `dom.js`, `pixelart.js`, `sfx.js`).
`app.js` owns the state and is the only place that changes it.

## The context object

`app.js` builds one `ctx` object and passes it to every view:

| Member | Purpose |
|---|---|
| `ctx.state` | The save object. Views read it. |
| `ctx.dex` | `{ species, byId, updatedAt }` from `data/pokedex.json`. |
| `ctx.sfx.play(name)` | Sound effect. |
| `ctx.render()`, `ctx.go(view)` | Redraw, navigate. |
| `ctx.openModal()`, `ctx.closeModal()`, `ctx.confirm()`, `ctx.toast()` | Dialogs and messages. |
| `ctx.startSession()`, `pauseSession()`, `resumeSession()`, `stopSession()` | Stopwatch. |
| `ctx.commitSession(record, stars, note)` | Record a finished session. |
| `ctx.discardPending()` | Drop an unrated stopwatch session. |
| `ctx.setBuddy()`, `toggleMute()`, `exportBackup()`, `importBackup()`, `resetAll()` | Everything else. |

A view is a module exporting `render(ctx, root)` and, optionally,
`tick(ctx, now)`.

## Rendering

There is no virtual DOM. `render()` empties `<main>` and calls the current
view's `render`, which builds elements with `h()` from `dom.js`. `h()` only
sets attributes and text nodes, so descriptions typed by the user can never
become markup.

Navigation is by URL hash: `#/`, `#/pokedex`, `#/history`, `#/stats`,
`#/settings`.

## The tick

`app.js` runs `tick()` every 500 ms. It

1. checks the running session against the 35-minute break limit and ends it
   if the limit has passed,
2. beeps once a minute during the red countdown,
3. updates the header chip and the tab title, and
4. calls the current view's `tick`, which the dashboard uses to refresh the
   stopwatch face without redrawing anything else.

All timing is computed from stored timestamps, never from counting ticks, so
a sleeping tab or a closed browser loses nothing.

## What happens when a session is saved

```
stop / auto-end / manual form
        │
        ▼
rating dialog (views/rate.js) ──► ctx.commitSession(record, stars, note)
                                        │
                    append to state.sessions
                    scoring.recalculate()  → points, netAfter, score
                                        │
                                   settle()
                     ┌──────────────────┴──────────────────┐
        starter owed? (highWater ≥ 1, none chosen)      otherwise
                     │                                      │
          views/starter.js: pick one                        │
                     └──────────────────┬──────────────────┘
                              rewards.grantOwed()  one roll per 100 points owed
                                        │
                              save → render → views/reveal.js
```

`settle()` also runs at start-up and after an import, which is how a
hand-edited backup that earns extra points gets its Pokémon.

## Saving

`ctx.save()` writes the whole state to `localStorage` after every change. It
is small (a few hundred bytes per session). A `storage` event listener
reloads the state when another tab changes it, so two open tabs do not
overwrite each other.

## Offline

`sw.js` keeps two caches. Pages, scripts, styles and `pokedex.json` are
fetched network-first, so a new deploy appears on the next load, with the
cache as the offline fallback. Sprites, icons and the font are cache-first.
A few seconds after the page loads it sends the worker the list of every
sprite, which it downloads in the background (about 3 MB, skipped when the
browser reports data-saver mode), so any Pokémon can be revealed offline.

When you add or rename a JavaScript or CSS file, add it to `SHELL_FILES` in
`sw.js`.

## The dashboard

Top to bottom: the backup reminder (only when overdue), the two big buttons
(or the stopwatch while a session runs), one compact progress tile, the
last-7-days tile, and the four navigation tiles.

The progress tile holds the net score, the points left to the next reward,
the luck gauge, your buddy, and the journey track: Pokémon at stations you
have reached, Poké Balls at those you have not. The track holds every station
from the start to ten beyond the last one earned and scrolls sideways through
them by swipe, mouse drag, arrow keys or its two arrow buttons. It snaps one
station at a time, so a whole number of stations is always in view and no
sprite is cut off. It opens on the window that ends at the next unreached
station. It is drawn by `fillTrack()` after the tile is on the page, and
redrawn on resize.

The last-7-days tile (`weekPanel()`) has one column per day, today included
and on the right: chad time rises above a zero line and chud time hangs below
it, on one shared scale, with the week's totals above. It counts plain active
minutes, with no multiplier or rating, and files each session under the day
it started. Tapping a day shows its numbers.

## Light and dark

The theme follows the system setting through `prefers-color-scheme`. There is
no switch in the app and nothing is stored. Every colour is a CSS custom
property declared once for light at the top of `css/style.css` and overridden
in a single dark block beneath it.

- Icons in `pixelart.js` use `var(--art-ink)` for outlines, and charts take
  their colours from classes (`c-chad`, `c-chud`, ...), so both follow the
  theme.
- A few things keep one fixed palette in both themes on purpose, because they
  are artwork rather than interface: the logo, the encounter stage (so the
  black silhouette always reads), the luck gauge and the toast.
- The chad and chud chart colours were checked for colour-blind separation
  against both the light and the dark panel colour.

## Pixel-art rules

- Sprites are 96×96. They are shown only at 1× or 2× with
  `image-rendering: pixelated` (nearest-neighbour), never smoothed.
- Icons are text bitmaps in `pixelart.js`, drawn as SVG rectangles with
  `shape-rendering: crispEdges` at whole-number scales.
- Layout sits on a 4 px grid. Borders are hard `box-shadow`s; there are no
  rounded corners, gradients or blurs.
- Text is only ever 8, 16, 24 or 32 px, with whole-pixel line heights and no
  letter spacing. Press Start 2P is drawn on an 8×8 grid; at any other size
  (10 px, 12 px ...) each font pixel becomes a fractional number of screen
  pixels and the letters come out uneven and squashed.
- All text is displayed in capitals (`text-transform: uppercase` on the body,
  inherited by buttons and inputs). The font's lowercase letters are as wide
  as its capitals but only about 5 pixels tall, so mixed-case text looks
  squat. This is display only: descriptions are saved as typed. The logo
  opts out to keep its small "é".
- Animations move in steps, not smooth tweens. The thrown ball spins in
  quarter turns and shuffles without rotating, so its pixels stay on the
  grid. Everything is disabled under `prefers-reduced-motion`.

## Tests

```bash
node --test
```

`tests/logic.test.js` covers the formula, the high-water rule, roll odds,
caps, shinies, pity, the starter, the stopwatch and break limit, export and
import round trips, and importing hand-edited files.
