#!/usr/bin/env python3
"""Refresh the Pokédex data and sprites that PokéChad ships in this repo.

What it does
------------
1. Asks PokeAPI (https://pokeapi.co) for the list of every Pokémon species.
2. Fetches details only for species that are not in ``data/pokedex.json`` yet,
   or whose entry is missing a field this version records (``--refresh``
   re-fetches every species, e.g. to pick up a reclassification or a change
   to an evolution family).
3. Downloads any missing normal and shiny sprites into ``assets/sprites/``.
4. Downloads the two dashboard button icons into ``assets/icons/``.
5. Rewrites ``data/pokedex.json`` only when something actually changed, so a
   run with nothing new leaves the working tree clean.

It uses the Python standard library only (Python 3.9+), so there is nothing
to install:

    python3 tools/update_pokedex.py            # incremental update
    python3 tools/update_pokedex.py --refresh  # re-check every species

See ``documentation/pokedex-updater.md`` for the full description.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
POKEDEX_JSON = ROOT / "data" / "pokedex.json"
SPRITE_DIR = ROOT / "assets" / "sprites"
ICON_DIR = ROOT / "assets" / "icons"

API = "https://pokeapi.co/api/v2"
SPRITE_HOST = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon"

# Dashboard button art. Zacian's Crowned Sword form is a separate "pokemon"
# entry in PokeAPI (id 10188), not a species, so it is fetched by hand here.
ICONS = {
    "snorlax.png": f"{SPRITE_HOST}/143.png",
    "zacian-crowned.png": f"{SPRITE_HOST}/10188.png",
}

# Fields every species entry must carry. An existing entry without one of
# them (written by an older version of this script) is fetched again.
SPECIES_FIELDS = ("id", "slug", "name", "gen", "tier", "family", "color")

USER_AGENT = "pokedex-updater/1.0 (python-urllib)"
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
RETRIES = 4


def fetch(url: str) -> bytes | None:
    """GET ``url`` and return the body, or ``None`` when the server says 404.

    Network errors and 5xx/429 responses are retried with exponential backoff;
    anything still failing after ``RETRIES`` attempts raises.
    """
    last_error: Exception | None = None
    for attempt in range(RETRIES):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(request, timeout=30) as response:
                return response.read()
        except urllib.error.HTTPError as error:
            if error.code == 404:
                return None
            last_error = error
            if error.code not in (429, 500, 502, 503, 504):
                break
        except (urllib.error.URLError, TimeoutError, ConnectionError) as error:
            last_error = error
        time.sleep(2**attempt)
    raise RuntimeError(f"could not fetch {url}: {last_error}")


def fetch_json(url: str) -> dict:
    """GET ``url`` and decode it as JSON. A 404 is an error here."""
    body = fetch(url)
    if body is None:
        raise RuntimeError(f"not found: {url}")
    return json.loads(body)


def id_from_url(url: str) -> int:
    """Pull the trailing numeric id out of a PokeAPI resource URL."""
    return int(url.rstrip("/").rsplit("/", 1)[1])


def tier_of(detail: dict) -> str:
    """Map PokeAPI's flags onto PokéChad's three reward tiers."""
    if detail["is_mythical"]:
        return "mythical"
    if detail["is_legendary"]:
        return "legendary"
    return "common"


def species_entry(species_id: int) -> dict:
    """Fetch one species from PokeAPI and reduce it to what the site needs.

    ``family`` is the id of the species' evolution chain: every member of one
    evolutionary line (Weedle, Kakuna, Beedrill; or Pichu, Pikachu, Raichu)
    shares it. The site uses it to unlock a family in Pokédex order. It comes
    straight from PokeAPI; nothing about families is written by hand.

    ``color`` is PokeAPI's Pokédex colour for the species (red, blue, green,
    yellow, ...). The site uses it to tint the starter choice.
    """
    detail = fetch_json(f"{API}/pokemon-species/{species_id}/")
    english = next(
        (n["name"] for n in detail["names"] if n["language"]["name"] == "en"),
        detail["name"].replace("-", " ").title(),
    )
    return {
        "id": detail["id"],
        "slug": detail["name"],
        "name": english,
        "gen": id_from_url(detail["generation"]["url"]),
        "tier": tier_of(detail),
        "family": id_from_url(detail["evolution_chain"]["url"])
        if detail.get("evolution_chain")
        else None,
        "color": detail["color"]["name"] if detail.get("color") else None,
    }


def download_png(url: str, target: Path) -> bool:
    """Save ``url`` to ``target`` if it is a PNG. Returns whether the file exists."""
    if target.exists():
        return True
    body = fetch(url)
    if body is None or not body.startswith(PNG_MAGIC):
        return False
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix(".tmp")
    temporary.write_bytes(body)
    temporary.replace(target)
    return True


def load_existing() -> dict[int, dict]:
    """Read the species already recorded in ``data/pokedex.json``, keyed by id."""
    if not POKEDEX_JSON.exists():
        return {}
    data = json.loads(POKEDEX_JSON.read_text(encoding="utf-8"))
    return {entry["id"]: entry for entry in data.get("species", [])}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    parser.add_argument(
        "--refresh",
        action="store_true",
        help="re-fetch every species from PokeAPI, not only the new ones",
    )
    parser.add_argument(
        "--workers", type=int, default=8, help="parallel downloads (default: 8)"
    )
    args = parser.parse_args()

    existing = load_existing()
    listing = fetch_json(f"{API}/pokemon-species?limit=100000")
    all_ids = sorted(id_from_url(item["url"]) for item in listing["results"])
    incomplete = [
        i for i in all_ids if i in existing and any(f not in existing[i] for f in SPECIES_FIELDS)
    ]
    wanted = (
        all_ids
        if args.refresh
        else [i for i in all_ids if i not in existing or i in incomplete]
    )
    print(f"PokeAPI lists {len(all_ids)} species; fetching details for {len(wanted)}.")

    species = {i: dict(existing[i]) for i in all_ids if i in existing}
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        for entry in pool.map(species_entry, wanted):
            # Keep the sprite flags already on record; they are refreshed below.
            flags = {k: v for k, v in species.get(entry["id"], {}).items() if k in ("sprite", "shiny")}
            species[entry["id"]] = {**entry, **flags}

    # Sprites: download what is missing, then record what is really on disk.
    def sync_sprites(species_id: int) -> tuple[int, bool, bool]:
        normal = download_png(
            f"{SPRITE_HOST}/{species_id}.png", SPRITE_DIR / "normal" / f"{species_id}.png"
        )
        shiny = download_png(
            f"{SPRITE_HOST}/shiny/{species_id}.png",
            SPRITE_DIR / "shiny" / f"{species_id}.png",
        )
        return species_id, normal, shiny

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        for species_id, normal, shiny in pool.map(sync_sprites, all_ids):
            species[species_id]["sprite"] = normal
            species[species_id]["shiny"] = shiny

    for filename, url in ICONS.items():
        if not download_png(url, ICON_DIR / filename):
            print(f"warning: icon {filename} is not available at {url}")

    ordered = [species[i] for i in all_ids]
    added = [e for e in ordered if e["id"] not in existing]
    changed = [
        e for e in ordered if e["id"] in existing and existing[e["id"]] != e
    ]
    tiers = {t: sum(1 for e in ordered if e["tier"] == t) for t in ("common", "legendary", "mythical")}
    no_sprite = [e["id"] for e in ordered if not e["sprite"]]
    no_shiny = [e["id"] for e in ordered if e["sprite"] and not e["shiny"]]

    if added or changed or not POKEDEX_JSON.exists():
        POKEDEX_JSON.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "source": "https://pokeapi.co",
            "updatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "count": len(ordered),
            "tiers": tiers,
            "species": ordered,
        }
        lines = ",\n".join(
            "    " + json.dumps(e, ensure_ascii=False, separators=(", ", ": "))
            for e in ordered
        )
        head = json.dumps(
            {k: v for k, v in payload.items() if k != "species"},
            ensure_ascii=False,
            indent=2,
        )
        text = head[:-2] + ',\n  "species": [\n' + lines + "\n  ]\n}\n"
        json.loads(text)  # refuse to write anything that is not valid JSON
        POKEDEX_JSON.write_text(text, encoding="utf-8")
        print(f"Wrote {POKEDEX_JSON.relative_to(ROOT)}.")
    else:
        print("No changes to data/pokedex.json.")

    families = len({e["family"] for e in ordered if e.get("family") is not None})
    print(f"Species: {len(ordered)}  {tiers}  Evolution families: {families}")
    print(f"New: {len(added)}  Changed: {len(changed)}")
    for entry in added[:20]:
        print(f"  + #{entry['id']} {entry['name']} ({entry['tier']})")
    if len(added) > 20:
        print(f"  ... and {len(added) - 20} more")
    for entry in changed[:20]:
        before = existing[entry["id"]]
        fields = ", ".join(
            f"{key} {before.get(key)!r} -> {value!r}"
            for key, value in entry.items()
            if before.get(key) != value
        )
        print(f"  ~ #{entry['id']} {entry['name']}: {fields}")
    if len(changed) > 20:
        print(f"  ... and {len(changed) - 20} more")
    if no_sprite:
        print(f"No sprite yet (kept out of the reward pool): {no_sprite}")
    if no_shiny:
        print(f"No shiny sprite yet (normal sprite is shown instead): {no_shiny}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
