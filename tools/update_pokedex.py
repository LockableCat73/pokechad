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
6. Does the same for alternate forms (Megas, Gigantamax, regional forms,
   fusions ...): reads every non-default Pokémon from PokeAPI, sorts it with
   the hand-written rules in ``tools/forms_rules.json``, downloads its
   sprites, and writes ``data/forms.json``.

It uses the Python standard library only (Python 3.9+), so there is nothing
to install:

    python3 tools/update_pokedex.py            # incremental update
    python3 tools/update_pokedex.py --refresh  # re-check every species

See ``documentation/pokedex-updater.md`` for the full description.
"""

from __future__ import annotations

import argparse
import fnmatch
import http.client
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
FORMS_JSON = ROOT / "data" / "forms.json"
FORMS_RULES = Path(__file__).resolve().parent / "forms_rules.json"
SPRITE_DIR = ROOT / "assets" / "sprites"
ICON_DIR = ROOT / "assets" / "icons"

API = "https://pokeapi.co/api/v2"
SPRITE_HOST = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon"

# Dashboard button art, also used for the browser tab icon while a stopwatch
# runs. Gigantamax Snorlax (10206) and Zacian's Crowned Sword form (10188)
# are separate "pokemon" entries in PokeAPI, not species, so they are
# fetched by hand here.
ICONS = {
    "snorlax-gmax.png": f"{SPRITE_HOST}/10206.png",
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
        except (
            urllib.error.URLError,
            TimeoutError,
            ConnectionError,
            http.client.HTTPException,  # e.g. IncompleteRead: the transfer was cut off
        ) as error:
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


# --------------------------------------------------------------------- forms
#
# PokeAPI models an alternate form as a separate "pokemon" whose id is 10001
# or higher and which points back at its species. It also says whether the
# form is a Mega. Everything else about how PokéChad treats a form (paid
# upgrade, free alternate form, fusion, left out, display label) comes from
# tools/forms_rules.json. Raw facts are kept in data/forms.json so the rules
# can be edited and re-applied without fetching anything again.


def variety_facts(pokemon_id: int) -> dict:
    """Fetch the raw facts about one non-default Pokémon from PokeAPI."""
    pokemon = fetch_json(f"{API}/pokemon/{pokemon_id}/")
    form = fetch_json(pokemon["forms"][0]["url"]) if pokemon.get("forms") else {}
    return {
        "pid": pokemon["id"],
        "name": pokemon["name"],
        "species": id_from_url(pokemon["species"]["url"]),
        "mega": bool(form.get("is_mega")),
    }


def title_label(key: str) -> str:
    """Fallback display label: "rapid-strike" -> "Rapid Strike"."""
    return " ".join(part.capitalize() for part in key.split("-"))


def classify_forms(facts: list[dict], species: dict[int, dict], rules: dict) -> tuple[list, list, list]:
    """Sort raw varieties into (forms, fusions, skipped) using the rules.

    Kinds of form:
      variant    a free alternate form, unlocked by getting more copies
      upgrade    bought with Pokécoins (Mega, Gigantamax, Primal, ...)
      milestone  unlocked by a copy count (Zygarde 10% and Complete)
    """
    labels = rules.get("labels", {})
    overrides = rules.get("overrides", {})
    upgrade_names = sorted(rules.get("upgradeForms", []), key=len, reverse=True)
    fusion_rules = {f["pokemon"]: f for f in rules.get("fusions", [])}
    by_slug = {s["slug"]: s for s in species.values()}

    def key_of(fact: dict) -> str:
        slug = species[fact["species"]]["slug"]
        name = fact["name"]
        return name[len(slug) + 1 :] if name.startswith(slug + "-") else name

    def upgrade_parts(key: str, mega: bool) -> tuple[str, str] | None:
        """Split an upgrade key into (prefix, label), or None if not an upgrade.

        "mega-x" -> ("", "Mega X"); "droopy-mega" -> ("droopy", "Mega");
        "galar-zen" -> ("galar", "Zen"); "gmax" -> ("", "Gigantamax").
        """
        parts = key.split("-")
        if mega:
            at = parts.index("mega") if "mega" in parts else len(parts)
            suffix = " ".join(p.upper() for p in parts[at + 1 :])
            return "-".join(parts[:at]), ("Mega " + suffix).strip()
        for name in upgrade_names:
            if key == name:
                return "", labels.get(name, title_label(name))
            if key.endswith("-" + name):
                return key[: -len(name) - 1], labels.get(name, title_label(name))
        return None

    forms: list[dict] = []
    fusions: list[dict] = []
    skipped: list[dict] = []
    pending_upgrades: list[tuple[dict, str, str, str]] = []

    for fact in sorted(facts, key=lambda f: f["pid"]):
        if fact["species"] not in species:
            skipped.append({**fact, "reason": "unknown species"})
            continue
        name = fact["name"]
        key = key_of(fact)
        override = overrides.get(name, {})
        if name in fusion_rules:
            rule = fusion_rules[name]
            partner = by_slug.get(rule["with"])
            if not partner:
                skipped.append({**fact, "reason": f"fusion partner {rule['with']} not found"})
                continue
            base = species[fact["species"]]
            first, second = sorted([base, partner], key=lambda s: s["name"].lower())
            fusions.append(
                {
                    # 1,000,000 * y + 1,000 * x, x being the alphabetically first of the two.
                    "id": 1_000_000 * second["id"] + 1_000 * first["id"],
                    "pid": fact["pid"],
                    "name": name,
                    "mega": fact["mega"],
                    "label": rule["label"],
                    "base": base["id"],
                    "partner": partner["id"],
                }
            )
        elif "kind" in override:
            entry = {
                "species": fact["species"],
                "key": override.get("key", key),
                "pid": fact["pid"],
                "name": name,
                "mega": fact["mega"],
                "label": override.get("label", title_label(key)),
                "kind": override["kind"],
            }
            if "requires" in override:
                entry["requires"] = override["requires"]
            forms.append(entry)
        elif any(fnmatch.fnmatch(name, pattern) for pattern in rules.get("exclude", [])):
            skipped.append({**fact, "reason": "left out by forms_rules.json"})
        else:
            parts = upgrade_parts(key, fact["mega"])
            if parts is None:
                forms.append(
                    {
                        "species": fact["species"],
                        "key": key,
                        "pid": fact["pid"],
                        "name": name,
                        "mega": fact["mega"],
                        "label": labels.get(key, title_label(key)),
                        "kind": "variant",
                    }
                )
            else:
                pending_upgrades.append((fact, key, parts[0], parts[1]))

    # Upgrades are resolved after the variants, because an upgrade may belong
    # to one of them ("galar-zen" needs the Galarian form, and is labelled so).
    for fact, key, prefix, label in pending_upgrades:
        owner = None
        if prefix:
            owner = next(
                (
                    f
                    for f in forms
                    if f["species"] == fact["species"]
                    and f["kind"] == "variant"
                    and (f["key"] == prefix or f["key"].startswith(prefix + "-"))
                ),
                None,
            )
        entry = {
            "species": fact["species"],
            "key": key,
            "pid": fact["pid"],
            "name": fact["name"],
            "mega": fact["mega"],
            "label": f"{owner['label']} {label}" if owner else label,
            "kind": "upgrade",
        }
        if owner:
            entry["requires"] = {"form": owner["key"]}
        extra = overrides.get(fact["name"], {}).get("requires")
        if extra:
            if "fusionOf" in extra:
                target = by_slug.get(extra["fusionOf"])
                extra = {"fusionOf": target["id"]} if target else None
            if extra:
                entry["requires"] = extra
        forms.append(entry)

    forms.sort(key=lambda f: (f["species"], f["pid"]))
    fusions.sort(key=lambda f: f["id"])
    skipped.sort(key=lambda f: f["pid"])
    return forms, fusions, skipped


def update_forms(species: dict[int, dict], refresh: bool, workers: int) -> None:
    """Bring data/forms.json and the form sprites up to date."""
    rules = json.loads(FORMS_RULES.read_text(encoding="utf-8"))
    previous = json.loads(FORMS_JSON.read_text(encoding="utf-8")) if FORMS_JSON.exists() else {}
    # Raw facts already on file, so only new forms need fetching. A fusion
    # records its species as "base".
    known: dict[int, dict] = {}
    for group in ("forms", "fusions", "skipped"):
        for entry in previous.get(group, []):
            owner = entry.get("species", entry.get("base"))
            if owner is None or not all(k in entry for k in ("pid", "name", "mega")):
                continue
            known[entry["pid"]] = {
                "pid": entry["pid"],
                "name": entry["name"],
                "species": owner,
                "mega": entry["mega"],
            }

    listing = fetch_json(f"{API}/pokemon?limit=100000")
    variety_ids = sorted(
        i for i in (id_from_url(item["url"]) for item in listing["results"]) if i >= 10000
    )
    wanted = variety_ids if refresh else [i for i in variety_ids if i not in known]
    print(f"PokeAPI lists {len(variety_ids)} alternate forms; fetching details for {len(wanted)}.")
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for fact in pool.map(variety_facts, wanted):
            known[fact["pid"]] = fact
    facts = [known[i] for i in variety_ids if i in known]

    forms, fusions, skipped = classify_forms(facts, species, rules)

    def sync(entry: dict) -> tuple[bool, bool]:
        pid = entry["pid"]
        return (
            download_png(f"{SPRITE_HOST}/{pid}.png", SPRITE_DIR / "normal" / f"{pid}.png"),
            download_png(f"{SPRITE_HOST}/shiny/{pid}.png", SPRITE_DIR / "shiny" / f"{pid}.png"),
        )

    listed = forms + fusions
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for entry, (normal, shiny) in zip(listed, pool.map(sync, listed)):
            entry["sprite"] = normal
            entry["shiny"] = shiny

    counts = {
        "upgrade": sum(1 for f in forms if f["kind"] == "upgrade"),
        "variant": sum(1 for f in forms if f["kind"] == "variant"),
        "milestone": sum(1 for f in forms if f["kind"] == "milestone"),
        "fusion": len(fusions),
        "skipped": len(skipped),
    }
    body = {"forms": forms, "fusions": fusions, "skipped": skipped}
    unchanged = all(previous.get(k) == body[k] for k in body)
    if not unchanged or not FORMS_JSON.exists():
        def lines(entries: list[dict]) -> str:
            return ",\n".join(
                "    " + json.dumps(e, ensure_ascii=False, separators=(", ", ": ")) for e in entries
            )

        head = json.dumps(
            {
                "source": "https://pokeapi.co",
                "updatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                "counts": counts,
            },
            ensure_ascii=False,
            indent=2,
        )
        text = (
            head[:-2]
            + ',\n  "forms": [\n' + lines(forms)
            + '\n  ],\n  "fusions": [\n' + lines(fusions)
            + '\n  ],\n  "skipped": [\n' + lines(skipped)
            + "\n  ]\n}\n"
        )
        json.loads(text)  # refuse to write anything that is not valid JSON
        FORMS_JSON.write_text(text, encoding="utf-8")
        print(f"Wrote {FORMS_JSON.relative_to(ROOT)}.")
    else:
        print("No changes to data/forms.json.")

    print(f"Forms: {counts}")
    before = {e["pid"] for g in ("forms", "fusions") for e in previous.get(g, [])}
    fresh = [e for e in listed if e["pid"] not in before]
    for entry in fresh[:20]:
        print(f"  + {entry['name']} ({entry.get('kind', 'fusion')}: {entry['label']})")
    if len(fresh) > 20:
        print(f"  ... and {len(fresh) - 20} more")
    no_art = [e["name"] for e in listed if not e["sprite"]]
    if no_art:
        print(f"No sprite yet (listed but cannot be unlocked): {no_art}")


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

    update_forms(species, args.refresh, args.workers)
    return 0


if __name__ == "__main__":
    sys.exit(main())
