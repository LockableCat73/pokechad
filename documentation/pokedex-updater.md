# Pokédex updater

Code: [`tools/update_pokedex.py`](../tools/update_pokedex.py). Workflow:
[`.github/workflows/update-pokedex.yml`](../.github/workflows/update-pokedex.yml).

The site never calls PokeAPI. Everything it needs is committed to this
repository:

| Path | Contents |
|---|---|
| `data/pokedex.json` | Every species: number, name, generation, tier, evolution family, colour, sprite flags |
| `data/forms.json` | Every alternate form and fusion: which species, what kind, its label, what it requires, sprite flags |
| `assets/sprites/normal/{id}.png` | Normal sprite, 96×96. Species use their Pokédex number; alternate forms use PokeAPI's number for the form (10001 and up) |
| `assets/sprites/shiny/{id}.png` | Shiny sprite, 96×96 |
| `assets/icons/snorlax.png`, `zacian-crowned.png` | The two dashboard buttons |

The updater regenerates these from [PokeAPI](https://pokeapi.co) and its
sprite repository.

## Running it

```bash
python3 tools/update_pokedex.py
```

Python 3.9 or newer; standard library only, nothing to install. Run it from
anywhere; it finds the repository from its own location.

| Option | Effect |
|---|---|
| *(none)* | Incremental: fetch details only for species not yet in `pokedex.json` (or whose entry lacks a field this version records), and download only sprites not yet on disk. Takes a few seconds when nothing is new. |
| `--refresh` | Re-fetch every species. Picks up a renamed or reclassified Pokémon, or a change to an evolution family. About a minute. The monthly workflow uses this. |
| `--workers N` | Parallel downloads (default 8). |

It then prints a summary, for example:

```
PokeAPI lists 1025 species; fetching details for 0.
No changes to data/pokedex.json.
Species: 1025  {'common': 931, 'legendary': 71, 'mythical': 23}  Evolution families: 540
New: 0  Changed: 0
```

Commit whatever it changed under `data/` and `assets/`.

## What it does, step by step

1. **List species.** `GET /api/v2/pokemon-species?limit=100000`.
2. **Fetch details** for the species it needs (`/pokemon-species/{id}/`) and
   keep: `id`, `slug` (PokeAPI's name), `name` (English), `gen`, `tier`,
   `family` and `color`.
3. **Tier.** `is_mythical` → `mythical`; otherwise `is_legendary` →
   `legendary`; otherwise `common`.
   **Family.** The id at the end of the species' `evolution_chain` URL. All
   members of one evolutionary line share it. The site uses it to unlock a
   family in Pokédex order (see [rewards.md](rewards.md#evolution-families)).
   No family is listed by hand anywhere.
   **Colour.** PokeAPI's Pokédex colour name (`red`, `blue`, `green`,
   `yellow`, ...). The site uses it to tint the starter choice.
4. **Sprites.** For every species, download
   `sprites/pokemon/{id}.png` and `sprites/pokemon/shiny/{id}.png` from the
   PokeAPI sprites repository if the file is not already present. Files are
   checked to be PNGs and written atomically.
5. **Flags.** `sprite` and `shiny` in `pokedex.json` record whether each file
   really exists on disk.
6. **Icons.** Download the two button images if missing.
7. **Write `pokedex.json`** only if a species was added or changed, so a run
   with nothing new leaves the working tree clean.

Network errors and rate limits are retried with backoff.

### `data/pokedex.json`

```json
{
  "source": "https://pokeapi.co",
  "updatedAt": "2026-11-16T17:05:07Z",
  "count": 1025,
  "tiers": { "common": 931, "legendary": 71, "mythical": 23 },
  "species": [
    {"id": 1, "slug": "bulbasaur", "name": "Bulbasaur", "gen": 1, "tier": "common", "family": 1, "color": "green", "sprite": true, "shiny": true}
  ]
}
```

### Species without artwork yet

A brand-new Pokémon can appear in PokeAPI before its sprites do.

- `"sprite": false`: the species is listed in the Pokédex but **kept out of
  the reward pool** until a later run finds its sprite.
- `"shiny": false` with `"sprite": true`: it can be rewarded; if you earn the
  shiny copy, the normal sprite is shown until the shiny one arrives.

The summary lists both cases.

## Alternate forms

After the species, the updater does the same job for alternate forms and
writes `data/forms.json`.

1. **List.** `GET /api/v2/pokemon?limit=100000`; every entry numbered 10000
   or above is an alternate form of some species.
2. **Fetch facts** for forms not already on file (`/pokemon/{id}/` and its
   first `/pokemon-form/`): the form's name, its species, and whether PokeAPI
   flags it as a Mega. These raw facts are kept in `forms.json`, so the rules
   can be changed and re-applied without fetching again.
3. **Classify** each form with
   [`tools/forms_rules.json`](../tools/forms_rules.json):

   | Rule | Result |
   |---|---|
   | Listed under `fusions` | A fusion, numbered `1,000,000 × y + 1,000 × x` (`x` = the alphabetically first of the two species) |
   | Listed under `overrides` with a `kind` | Exactly what the override says (Zygarde's chain) |
   | Matches a pattern in `exclude` | Left out, recorded under `skipped` |
   | PokeAPI's Mega flag, or its name ends in one of `upgradeForms` | A paid `upgrade` |
   | Anything else | A free `variant` |

   An upgrade that belongs to an alternate form is tied to it automatically:
   `darmanitan-galar-zen` becomes "Galarian Zen" and `requires` the Galarian
   form.
4. **Label** it from `labels` (`"alola"` → "Alolan"), or by tidying its name
   ("rapid-strike" → "Rapid Strike").
5. **Download** its normal and shiny sprite, and record whether each exists.
6. **Write** `forms.json` only if something changed.

```
PokeAPI lists 326 alternate forms; fetching details for 0.
No changes to data/forms.json.
Forms: {'upgrade': 147, 'variant': 125, 'milestone': 2, 'fusion': 6, 'skipped': 46}
No sprite yet (listed but cannot be unlocked): ['zygarde-mega']
```

### What needs a human

PokeAPI knows which forms exist and which are Megas. It does not know which
are paid upgrades in this game, which two Pokémon make a fusion, or what to
call a form. So **the forms system only partly updates itself**:

| Automatic | Needs an edit to `tools/forms_rules.json` |
|---|---|
| A new Mega | A new fusion and its two Pokémon |
| A new Gigantamax, or any form whose name ends in an entry of `upgradeForms` | A new kind of paid upgrade (add its name to `upgradeForms`) |
| Any other new form: it becomes a free alternate form | A better label than the tidied name |
| Artwork appearing for a form that had none | Leaving a form out |
| | Zygarde's chain |

After editing the rules, run the updater once; no `--refresh` is needed.

How the game uses all this: [shop.md](shop.md).

## Effect on existing saves

Saves refer to Pokémon by Pokédex number, so adding species changes nothing
for existing collections; the new species simply join the pool.

If a species changes tier, copies you already hold keep the tier they were
rolled with (it is stored on each reward). Future rolls and the copy cap use
the new tier.

If a new Pokémon joins an existing evolution family, it takes its place in
that family by Pokédex number. Nothing you already hold is affected; it just
becomes unlockable after the member before it.

## The monthly workflow

`.github/workflows/update-pokedex.yml` runs the updater with `--refresh` at
04:17 UTC on the 1st of each month, and on demand from **Actions → Update
Pokédex → Run workflow**. Because it re-reads every species, it picks up
changes to existing Pokémon (tier, name, evolution family, colour) as well as
new ones.

**It never pushes to `main`.** If the updater changed anything, the workflow:

1. runs the tests against the new data,
2. commits the changes to a branch named `pokedex-update` (rebuilt from the
   default branch on every run), and
3. opens a pull request into the default branch, or refreshes the existing
   one, with the updater's summary as the description.

You review and merge it. If nothing changed, it stops without creating a
branch.

### One-time setup

**Settings → Actions → General → Workflow permissions → Allow GitHub Actions
to create and approve pull requests.** This is off by default. Until it is
on, the run fails at the last step with a permissions error and no pull
request is opened.

### Cost

GitHub Actions is free for public repositories. Private repositories on the
free plan get 2,000 minutes a month; this job uses a minute or two.

### Good to know

- GitHub pauses scheduled workflows in a repository with no activity for 60
  days and emails you first. Re-enable it from the Actions tab.
- Scheduled runs only start once the workflow file is on the default branch.

## After an update

Nothing else is needed. `pokedex.json` and `forms.json` are fetched network-first, so the site
picks up new data on the next load, and new sprite files are cached as they
are first used.

If you ever **replace** an existing sprite file with different artwork under
the same name, bump `VERSION` in `sw.js` so browsers drop their cached copy.
