# PokéChad

A pixel-art productivity tracker. Record your **chad** time (work, study, gym)
and your **chud** time (slacking, scrolling), rate each session, and earn
points. Points move you along a reward track that pays out Pokémon.

Everything is saved in your browser. There is no account and no server.

> Unofficial, non-commercial fan project. Pokémon and all related names and
> artwork belong to Nintendo, Game Freak and Creatures. Pokédex data and
> sprites come from [PokeAPI](https://pokeapi.co).

## How it works

| | |
|---|---|
| **Record** | Tap **Add Chad Time** (Zacian) or **Add Chud Time** (Snorlax). Start the stopwatch, or add time after the fact. |
| **Rate** | When a session ends, give it 0 to 4 stars and a short description. |
| **Points** | `floor(t/60 + t^1.05 × stars/2)` with `t` in active minutes. Chad adds it, chud subtracts the same amount. |
| **Multiplier** | The stopwatch shows `1.05 × t^0.05 − 0.05` (never less than 1). It is a visual nudge to stay in the session and is not used in the maths. |
| **Breaks** | Pause whenever you like; paused time does not count. A break longer than 35 minutes ends the session, with a red countdown over the last 5. |
| **Starter** | Your first point lets you choose Bulbasaur, Charmander, Squirtle or Pikachu. |
| **Rewards** | A random Pokémon every 100 points: 94% common, 5% legendary, 1% mythical. 20 rewards without a legendary guarantees one. Nothing is decided until you reach the mark; then a silhouette appears and you throw the ball to find out. Your first 6 come from generation 1, the next 6 from generations 1–2, the next 6 from generations 1–4, then anything goes. Evolution families unlock in Pokédex order (Weedle, then Kakuna, then Beedrill). |
| **Copies** | Up to 7 of a common, 5 of a legendary, 2 of a mythical. The last copy is shiny. |
| **Chud** | Chud time lowers your score but never takes a Pokémon away. The next reward comes when you pass your previous best. |
| **Pokécoins** | Every reward also gives 1 Pokécoin. The Shop sells extra copies of Pokémon you have found (5 / 20 / 120), upgrade forms such as Mega and Gigantamax (150), and fusions (150). |
| **Forms** | Regional and other alternate forms arrive with later copies of a Pokémon, one new form per copy. Any form you have unlocked, and any fusion, can be your buddy. |

The dashboard shows your chad and chud time for the last 7 days, and links
to a **Pokédex** (everything you have found, plus a Shinies tab and your
totals), a **History** of every session, **Stats** with charts, and
**Backup**.

Light or dark follows your system setting automatically.

## Back up your data

Open **Backup** and press **Export JSON**. The file holds everything: every
session and how it was recorded, every Pokémon, your place on the track, and
your settings. **Load JSON** restores it, on this or any other device.

Clearing your browser data deletes your progress, so export now and then. The
dashboard reminds you after 14 days without a backup.

The file is plain JSON and safe to edit by hand. Scores are recalculated from
the sessions when a file is loaded. See
[documentation/storage.json.md](documentation/storage.json.md).

## Run it locally

There is no build step. Serve the folder with any static web server:

```bash
python3 -m http.server 8080
```

Then open <http://localhost:8080>. Opening `index.html` straight from disk
does not work, because browsers block JavaScript modules on `file://`.

Run the tests (Node 20 or newer, no dependencies):

```bash
node --test
```

## Put it on GitHub Pages

1. Make the repository public (GitHub Pages on the free plan needs this).
2. Go to **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**, branch
   `main`, folder `/ (root)`, and save.

The site appears at `https://<your-username>.github.io/pokechad/` a minute or
two later. Every push to `main` redeploys it.

## Keep the Pokédex up to date

The Pokédex (names, numbers, tiers) and all sprites live in this repository
under `data/` and `assets/`. To pull in new Pokémon from PokeAPI:

```bash
python3 tools/update_pokedex.py
```

It needs only Python 3.9+ and downloads just what is missing. Commit whatever
it changes.

A GitHub Action runs the same script on the 1st of each month. It never
pushes to `main`: if something changed, it opens a pull request from the
`pokedex-update` branch for you to merge. For that to work, switch on
**Settings → Actions → General → Workflow permissions → Allow GitHub Actions
to create and approve pull requests**. GitHub Actions is free for public
repositories.

Details: [documentation/pokedex-updater.md](documentation/pokedex-updater.md).

### Alternate forms do not fully auto-update

The updater also keeps `data/forms.json` (Megas, Gigantamax, regional forms,
fusions) up to date, but only partly on its own. PokeAPI says which forms
exist and which are Megas; it does not say which are paid upgrades here,
which two Pokémon make a fusion, or what a form should be called.

- **Picked up automatically:** a new Mega, a new Gigantamax, and any other
  new form (it becomes a free alternate form).
- **Needs a manual edit** to `tools/forms_rules.json`: a new fusion, a new
  kind of paid upgrade, display labels, forms to leave out, and anything
  about Zygarde.

So after a new game adds forms, check the pull request the workflow opens and
adjust `tools/forms_rules.json` if something landed in the wrong group.

## Documentation

| File | What it covers |
|---|---|
| [documentation/architecture.md](documentation/architecture.md) | How the code is organised and how data flows through it |
| [documentation/scoring.md](documentation/scoring.md) | Points formula, display multiplier, the high-water rule |
| [documentation/rewards.md](documentation/rewards.md) | Starter, tiers, odds, caps, shinies, pity |
| [documentation/shop.md](documentation/shop.md) | Pokécoins, the shop, alternate forms, fusions, Zygarde |
| [documentation/stopwatch.md](documentation/stopwatch.md) | Stopwatch states, pauses, the 35-minute break limit |
| [documentation/pokedex-updater.md](documentation/pokedex-updater.md) | The Python updater and the monthly workflow |
| [documentation/storage.json.md](documentation/storage.json.md) | The saved/exported JSON, field by field, and how to edit it |

## Licences

The pixel font is [Press Start 2P](https://fonts.google.com/specimen/Press+Start+2P)
by CodeMan38, under the SIL Open Font License (`assets/fonts/OFL.txt`).
