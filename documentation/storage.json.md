# The save file (`storage.json`)

PokéChad keeps one JSON object. The same object is

- stored in the browser's `localStorage` under the key **`pokechad.v1`**, and
- written to the file you get from **Backup → Export JSON**
  (`pokechad-backup-YYYY-MM-DD.json`).

The export is that object, pretty-printed, with one extra field
(`exportedAt`). Nothing else is stored anywhere.

This page describes every field so that you can open a backup in a text
editor, change it, and load it back with **Backup → Load JSON**.

Code: [`js/state.js`](../js/state.js) (`defaultState`, `normalize`,
`exportJSON`, `importJSON`).

## The golden rule: sources and derived fields

Some fields are the **source of truth**. Others are **derived**: the site
works them out from the sources every time a save is loaded or imported, and
ignores whatever value the file holds.

| Source of truth (edit these) | Derived (do not bother editing) |
|---|---|
| `sessions[].kind`, `activeMinutes`, `stars`, `note`, `startedAt`, `endedAt`, `method`, `pauses`, `autoEnded` | `sessions[].points`, `sessions[].netAfter` |
| The order of `sessions` | `score.net`, `score.highWater` |
| `starter` | `pity.dry` |
| `rewards[].dexId`, `tier`, `shiny`, `pity`, `form`, `at`, `sessionId` | `rewards[].n`, `rewards[].trackPoints` |
| The order of `rewards` | |
| `shop.ledger` (every purchase) | The Pokécoin balance, which is not stored at all |
| `buddy`, `settings`, `createdAt`, `lastExportAt` | |

So to change history you edit the sessions, and the score follows. You never
need to do the arithmetic yourself. The same goes for Pokécoins: the balance
is `rewards + starter − everything spent in the ledger`, worked out each time.

## A complete example

```json
{
  "app": "pokechad",
  "schema": 1,
  "createdAt": "2026-11-16T08:55:12.000Z",
  "lastExportAt": "2026-11-18T19:02:44.000Z",
  "score": { "net": 76, "highWater": 112 },
  "sessions": [
    {
      "id": "s-mwj4id8d-78x1",
      "kind": "chad",
      "method": "stopwatch",
      "startedAt": "2026-11-16T09:00:00.000Z",
      "endedAt": "2026-11-16T10:31:17.000Z",
      "activeMinutes": 60.285,
      "pauses": [
        { "from": "2026-11-16T09:42:17.000Z", "to": "2026-11-16T10:13:17.000Z" }
      ],
      "autoEnded": false,
      "stars": 3,
      "note": "Wrote the thesis intro",
      "points": 112,
      "netAfter": 112
    },
    {
      "id": "s-mwk0aa11-q2zd",
      "kind": "chud",
      "method": "manual",
      "startedAt": "2026-11-17T22:00:00.000Z",
      "endedAt": "2026-11-17T22:30:00.000Z",
      "activeMinutes": 30,
      "pauses": [],
      "autoEnded": false,
      "stars": 2,
      "note": "Scrolling in bed",
      "points": -36,
      "netAfter": 76
    }
  ],
  "starter": {
    "dexId": 4,
    "at": "2026-11-16T10:31:20.000Z",
    "sessionId": "s-mwj4id8d-78x1"
  },
  "rewards": [
    {
      "n": 1,
      "trackPoints": 100,
      "dexId": 162,
      "tier": "common",
      "shiny": false,
      "pity": false,
      "at": "2026-11-16T10:31:20.000Z",
      "sessionId": "s-mwj4id8d-78x1"
    }
  ],
  "pity": { "dry": 1 },
  "buddy": { "dexId": 4, "shiny": false },
  "active": null,
  "pendingRating": null,
  "settings": { "muted": false },
  "exportedAt": "2026-11-18T19:02:44.000Z"
}
```

All dates and times are ISO 8601 strings in UTC (the trailing `Z`). The site
shows them in your local time zone.

## Top-level fields

| Field | Type | Meaning |
|---|---|---|
| `app` | `"pokechad"` | Marks the file as a PokéChad save. Required; a file without it is rejected. |
| `schema` | integer | Format version. Currently `1`. Required. See [Schema versions](#schema-versions). |
| `createdAt` | date-time | When this save was first created. |
| `lastExportAt` | date-time or `null` | When you last exported. Drives the "no backup for 14 days" reminder. |
| `exportedAt` | date-time | Only in exported files: when this file was written. Ignored on import. |
| `score` | object | **Derived.** See [score](#score). |
| `sessions` | list | Every recorded session, oldest first. See [sessions](#sessions). |
| `starter` | object or `null` | The starter you chose. See [starter](#starter). |
| `rewards` | list | Every rolled Pokémon, oldest first. See [rewards](#rewards). |
| `pity` | object | **Derived.** `{ "dry": n }`, see [pity](#pity). |
| `shop` | object | `{ "ledger": [...] }`: everything bought with Pokécoins. See [shop](#shop). |
| `buddy` | object or `null` | What is shown on the dashboard. A Pokémon: `{ "dexId": 4, "shiny": false }`, optionally with `"form": "mega-x"`. Or a fusion: `{ "fusion": 643646000, "shiny": false }`. |
| `active` | object or `null` | A stopwatch that is running right now. See [active](#active). |
| `pendingRating` | object or `null` | A stopwatch session that has ended but is not rated yet. See [pendingRating](#pendingrating). |
| `settings` | object | `{ "muted": false }`. `muted: true` turns the sound effects off. |

## `sessions`

One object per recorded session. **The order of the list matters**: it is the
order in which sessions were recorded, and the running score is added up in
that order. New sessions are appended at the end, including manual entries
dated in the past.

| Field | Type | Source? | Meaning |
|---|---|---|---|
| `id` | string | source | Unique id. Rewards point at it through `sessionId`. If missing or duplicated, a new one is generated on import. |
| `kind` | `"chad"` or `"chud"` | source | Good time or bad time. Required. |
| `method` | `"stopwatch"` or `"manual"` | source | How it was recorded: timed live, or added after the fact. Anything else is read as `"stopwatch"`. |
| `startedAt` | date-time | source | When the session began. Required. Used to place the session on a day in Stats. |
| `endedAt` | date-time | source | When it ended. Defaults to `startedAt` if missing. For a session that ended during a break, this is when the break began. |
| `activeMinutes` | number ≥ 0 | source | Minutes that count: clock time minus breaks. **This is the `t` in the points formula.** Required. Stored to 3 decimals. |
| `pauses` | list of `{ "from", "to" }` | source | Each completed break. Informational; the time is already excluded from `activeMinutes`. |
| `autoEnded` | boolean | source | `true` if the 35-minute break limit ended the session. Informational. |
| `stars` | integer 0–4 | source | Your rating. Clamped into 0–4 and rounded on import. |
| `note` | string | source | Your description. Cut to 140 characters on import. |
| `points` | integer | **derived** | `floor(t/60 + t^1.05 × stars/2)`, negative for chud. |
| `netAfter` | integer | **derived** | Net score once this session is counted. |

## `score`

Entirely derived from `sessions`.

| Field | Meaning |
|---|---|
| `net` | Sum of every session's `points`. Can be negative. |
| `highWater` | The highest value `net` has ever reached while adding the sessions up in order (never below 0). Rewards are owed against this number, which is why chud time cannot take a Pokémon away. |

## `starter`

`null` until you choose. Once the high-water mark reaches 1 point the site
asks you to pick one of Bulbasaur (1), Charmander (4), Squirtle (7) or
Pikachu (25).

| Field | Type | Meaning |
|---|---|---|
| `dexId` | integer | Pokédex number of the starter. The site offers four, but any valid number is accepted in the file. |
| `at` | date-time | When you chose it. |
| `sessionId` | string or `null` | The session that first took the score to 1 or more. |

The starter is an extra reward. It is **not** part of `rewards` and does not
move the rewards at 100, 200, 300 … points. It does count as one copy of its
species (so a Charmander starter means six more Charmander can be rolled, and
the sixth is the shiny).

Set `starter` to `null` to be asked again the next time the site loads
(provided `highWater` is at least 1).

## `rewards`

One object per rolled Pokémon, oldest first. Reward number `n` belongs to
`n × 100` points on the track.

| Field | Type | Source? | Meaning |
|---|---|---|---|
| `n` | integer | **derived** | Position in the list, starting at 1. |
| `trackPoints` | integer | **derived** | `n × 100`. |
| `dexId` | integer | source | National Pokédex number. Required. Look numbers up in [`data/pokedex.json`](../data/pokedex.json). |
| `tier` | `"common"`, `"legendary"`, `"mythical"` | source | The tier at the time of the roll. Used by the pity counter and for display. Anything else is read as `"common"`. |
| `shiny` | boolean | source | Whether this copy is the shiny one. |
| `pity` | boolean | source | `true` if the pity rule forced this legendary. Informational. |
| `form` | string | source | The alternate form this copy arrived in, e.g. `"alola"` or `"heat"`. Left out for the ordinary (Base) form. Form keys are listed per species in [`data/forms.json`](../data/forms.json). |
| `at` | date-time | source | When it was awarded. |
| `sessionId` | string or `null` | source | The session that earned it; History shows the Pokémon on that session. `null` is fine. |

The number of rewards you are owed is `floor(highWater / 100) − rewards.length`.
If that is positive when the site loads, it rolls the missing ones on the
spot. If it is zero or negative, nothing happens: **rewards are never
removed automatically**.

## `shop`

```json
"shop": {
  "ledger": [
    { "type": "copy",    "dexId": 479, "tier": "common", "form": "wash", "shiny": false, "cost": 5,   "at": "2026-11-20T18:04:11.000Z" },
    { "type": "upgrade", "dexId": 6,   "form": "mega-x",                                 "cost": 150, "at": "2026-11-21T09:12:00.000Z" },
    { "type": "fuse",    "fusion": 643646000,                                           "cost": 150, "at": "2026-11-22T10:00:00.000Z" },
    { "type": "unfuse",  "fusion": 643646000,                                           "cost": 0,   "at": "2026-11-23T10:00:00.000Z" }
  ]
}
```

`ledger` is the list of everything bought, oldest first. **Order matters**
for fusions: a `fuse` followed later by an `unfuse` of the same number means
the fusion no longer exists.

| `type` | Fields | Meaning |
|---|---|---|
| `copy` | `dexId`, `tier`, `shiny`, `form` (optional), `cost`, `at` | A bought copy of a Pokémon. Counts as a copy exactly like a reward does. |
| `upgrade` | `dexId`, `form`, `cost`, `at` | An upgrade form (Mega, Gigantamax ...) unlocked for that Pokémon. `form` is its key in `data/forms.json`. |
| `fuse` | `fusion`, `cost`, `at` | A fusion made. `fusion` is its number in `data/forms.json`. |
| `unfuse` | `fusion`, `at` | That fusion undone. Its `cost` is always 0. |

Nothing else about the shop is stored. From the ledger the site works out:

- **the coin balance**: one coin per entry in `rewards`, plus one for the
  starter, minus the sum of every `cost`;
- **your copies**: rewards, the starter, and every `copy` entry;
- **unlocked forms**: free forms from the `form` of your copies, paid ones
  from `upgrade` entries, Zygarde's from its number of copies;
- **active fusions**: `fuse` entries not later undone.

The rules behind all this are in [shop.md](shop.md).

## `pity`

`{ "dry": n }`: how many of the most recent rewards, counting back from the
newest, were not legendary. Derived from `rewards`. When it reaches 20 the
next roll is a guaranteed legendary.

## `active`

A stopwatch in progress, or `null`.

```json
{
  "kind": "chad",
  "startedAt": "2026-11-18T18:00:00.000Z",
  "pauses": [{ "from": "2026-11-18T18:20:00.000Z", "to": "2026-11-18T18:25:00.000Z" }],
  "pausedAt": null
}
```

`pausedAt` is the start of the break in progress, or `null` when running.

`active` matters in `localStorage` (it is how the stopwatch survives a
refresh). **On import it is always dropped**: a stopwatch that was running
when the backup was made would otherwise count all the time since.

## `pendingRating`

A stopwatch session that has ended and is waiting for stars and a
description, or `null`. Same fields as a session, without `id`, `stars`,
`note`, `points` and `netAfter`. If it is present when the site loads, the
rating dialog opens straight away.

## Editing recipes

Always start from a fresh export, and keep an untouched copy until you have
loaded the edited one and checked it.

### Change a rating or a description

Find the session (search for its `note` or `startedAt`) and change `stars`
(0–4) or `note`. Leave `points` and `netAfter` alone; they are recalculated.

### Fix a wrong duration

Change `activeMinutes`. For tidiness also adjust `endedAt`, though only
`activeMinutes` affects the score.

### Remove a session

Delete its whole `{ … }` object from `sessions`, taking care with the commas.
The score drops accordingly. Any Pokémon it earned stay in `rewards`; their
`sessionId` simply no longer matches anything, which is harmless.

### Add a session you forgot

Append an object to the end of `sessions`. The minimum is:

```json
{ "kind": "chad", "startedAt": "2026-11-12T14:00:00Z", "activeMinutes": 90, "stars": 3 }
```

Everything else is filled in. If the new total passes a 100-point mark you
have never reached, the site rolls the new Pokémon when you load the file.

### Remove a Pokémon

Delete its object from `rewards`. If your high-water mark still covers that
slot, the site rolls a replacement on load. To avoid that, lower the score
too, or accept the re-roll.

### Add or change a Pokémon

Add or edit an object in `rewards` with the `dexId` you want:

```json
{ "dexId": 150, "tier": "legendary", "shiny": false, "at": "2026-11-18T12:00:00Z", "sessionId": null }
```

The file is trusted here: caps and shiny rules are only enforced when the
site rolls, not when you type. A reward beyond what your score has earned is
kept, and you then need that many more points before the next roll.

### Start the starter choice over

Set `"starter": null`.

### Get coins back for a purchase

Delete its entry from `shop.ledger`. The cost returns to your balance and
whatever it bought (the copy, the upgrade, the fusion) is gone.

### Give yourself coins

There is no coin field to raise. Coins come from rewards, so either add
entries to `rewards` (each is one coin, and one Pokémon), or lower the `cost`
of ledger entries.

### Change the form of a copy

Set or remove `"form"` on the reward or on the `copy` ledger entry. Use a key
from that species' entries in `data/forms.json`; an unknown key is shown as
the ordinary Pokémon.

### Unlock an upgrade or make a fusion by hand

Append a ledger entry, for example
`{ "type": "upgrade", "dexId": 94, "form": "mega", "cost": 0 }` or
`{ "type": "fuse", "fusion": 643646000, "cost": 0 }`. The file is trusted
here, as it is for rewards: requirements such as spare copies are checked
when you buy in the shop, not when you type.

## What happens on import

1. The text must be valid JSON, an object, with `"app": "pokechad"` and a
   `schema` this version understands. Otherwise the import is refused with a
   message and nothing changes.
2. Every session must have a valid `kind`, `startedAt` and `activeMinutes`,
   every reward a valid `dexId`, and every shop entry a known `type` with the
   fields that type needs. One bad entry refuses the whole file and names the
   entry (for example "Session 12: …" or "Shop entry 3: …").
3. Derived fields are recalculated.
4. `active` is dropped.
5. You are asked to confirm, then the browser's save is replaced.
6. If the starter or any rewards are owed, they are handed out.

If the save in `localStorage` itself is ever unreadable, the site starts
fresh and keeps the unreadable text under `pokechad.v1.corrupt` so it can be
recovered by hand.

## Schema versions

`schema` is bumped only when the format changes in a way older code could not
read.

| Version | Changes |
|---|---|
| 1 | First version. Later additions that old files simply lack, and that load with sensible defaults, do not change the number: `shop`, `rewards[].form`, and `form` / `fusion` on `buddy`. |

A file with a higher `schema` than the site knows is refused ("update the
site first"). When a version 2 arrives, `normalize()` in `js/state.js` is the
place that will upgrade version 1 files.
