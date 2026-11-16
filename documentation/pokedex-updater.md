# Pokédex updater

Code: [`tools/update_pokedex.py`](../tools/update_pokedex.py). Workflow:
[`.github/workflows/update-pokedex.yml`](../.github/workflows/update-pokedex.yml).

The site never calls PokeAPI. Everything it needs is committed to this
repository:

| Path | Contents |
|---|---|
| `data/pokedex.json` | Every species: number, name, generation, tier, sprite flags |
| `assets/sprites/normal/{id}.png` | Normal sprite, 96×96 |
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
| *(none)* | Incremental: fetch details only for species not yet in `pokedex.json`, and download only sprites not yet on disk. Takes a few seconds when nothing is new. |
| `--refresh` | Re-fetch every species. Use this to pick up a renamed or reclassified Pokémon. About a minute. |
| `--workers N` | Parallel downloads (default 8). |

It then prints a summary, for example:

```
PokeAPI lists 1025 species; fetching details for 0.
No changes to data/pokedex.json.
Species: 1025  {'common': 931, 'legendary': 71, 'mythical': 23}
New: 0  Changed: 0
```

Commit whatever it changed under `data/` and `assets/`.

## What it does, step by step

1. **List species.** `GET /api/v2/pokemon-species?limit=100000`.
2. **Fetch details** for the species it needs (`/pokemon-species/{id}/`) and
   keep: `id`, `slug` (PokeAPI's name), `name` (English), `gen`, and `tier`.
3. **Tier.** `is_mythical` → `mythical`; otherwise `is_legendary` →
   `legendary`; otherwise `common`.
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
    {"id": 1, "slug": "bulbasaur", "name": "Bulbasaur", "gen": 1, "tier": "common", "sprite": true, "shiny": true}
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

## Effect on existing saves

Saves refer to Pokémon by Pokédex number, so adding species changes nothing
for existing collections; the new species simply join the pool.

If a species changes tier, copies you already hold keep the tier they were
rolled with (it is stored on each reward). Future rolls and the copy cap use
the new tier.

## The monthly workflow

`.github/workflows/update-pokedex.yml` runs the updater at 04:17 UTC on the
1st of each month, and on demand from **Actions → Update Pokédex → Run
workflow**.

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

Nothing else is needed. `pokedex.json` is fetched network-first, so the site
picks up new data on the next load, and new sprite files are cached as they
are first used.

If you ever **replace** an existing sprite file with different artwork under
the same name, bump `VERSION` in `sw.js` so browsers drop their cached copy.
