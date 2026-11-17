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

## The idea in one paragraph

Everything you hold is written down once, in the place that says what it is:
`pokemon` is every copy of every Pokémon, `unlocks` is every paid form,
`fusions` is every fusion, `grants` is coins handed out directly. Each copy
in `pokemon` says where it came from in its `source`. **Only copies with
`"source": "track"` are stations on the reward track.** A copy that was
bought, given, or chosen as the starter is held just the same, but it does
not claim a station, does not count as a reward, and does not move the luck
gauge.

## The golden rule: sources and derived fields

Some fields are the **source of truth**. Others are **derived**: the site
works them out from the sources every time a save is loaded, imported or
written, and ignores whatever value the file holds.

| Source of truth (edit these) | Derived (do not bother editing) |
|---|---|
| `sessions[].kind`, `activeMinutes`, `stars`, `note`, `startedAt`, `endedAt`, `method`, `pauses`, `autoEnded` | `sessions[].points`, `sessions[].netAfter` |
| The order of `sessions` | `score.net`, `score.highWater` |
| `pokemon[]`: `source`, `dexId`, `tier`, `shiny`, `form`, `at`, and per source `pity`, `sessionId`, `bonusForm`, `cost` | `pokemon[].n`, `pokemon[].trackPoints` (track copies only) |
| The order of the `track` copies within `pokemon` | `pity.dry` |
| `unlocks`, `fusions`, `grants` | `wallet.earned`, `wallet.spent`, `wallet.balance` |
| `buddy`, `settings`, `createdAt`, `lastExportAt` | |

So to change history you edit the sessions, and the score follows. You never
need to do the arithmetic yourself. The same goes for Pokécoins: `wallet` is
there so you can read your balance in the file, but it is worked out from the
rest each time and anything you type into it is thrown away.

## A complete example

```json
{
  "app": "pokechad",
  "schema": 2,
  "createdAt": "2026-11-16T08:55:12.000Z",
  "lastExportAt": "2026-11-18T19:02:44.000Z",
  "score": { "net": 76, "highWater": 112 },
  "pity": { "dry": 1 },
  "wallet": { "earned": 12, "spent": 5, "balance": 7 },
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
  "pokemon": [
    { "source": "starter", "dexId": 4, "tier": "common", "shiny": false,
      "at": "2026-11-16T10:31:20.000Z", "sessionId": "s-mwj4id8d-78x1" },
    { "source": "track", "n": 1, "trackPoints": 100, "dexId": 162, "tier": "common",
      "shiny": false, "pity": false,
      "at": "2026-11-16T10:31:20.000Z", "sessionId": "s-mwj4id8d-78x1" },
    { "source": "shop", "dexId": 162, "tier": "common", "shiny": false,
      "at": "2026-11-17T08:00:00.000Z", "cost": 5 }
  ],
  "unlocks": [],
  "fusions": [],
  "grants": [
    { "coins": 10, "at": "2026-11-17T07:59:00.000Z" }
  ],
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
| `schema` | integer | Format version. Currently `2`. Required. See [Schema versions](#schema-versions). |
| `createdAt` | date-time | When this save was first created. |
| `lastExportAt` | date-time or `null` | When you last exported. Drives the "no backup for 14 days" reminder. |
| `exportedAt` | date-time | Only in exported files: when this file was written. Ignored on import. |
| `score` | object | **Derived.** See [score](#score). |
| `sessions` | list | Every recorded session, oldest first. See [sessions](#sessions). |
| `pity` | object | **Derived.** `{ "dry": n }`, see [pity](#pity). |
| `wallet` | object | **Derived.** Your Pokécoins: `{ "earned", "spent", "balance" }`. See [wallet](#wallet). |
| `pokemon` | list | Every copy of every Pokémon you hold. See [pokemon](#pokemon). |
| `unlocks` | list | Every paid form you can use (Mega, Gigantamax ...). See [unlocks](#unlocks). |
| `fusions` | list | Every fusion made, including ones since undone. See [fusions](#fusions). |
| `grants` | list | Pokécoins handed out directly. See [grants](#grants). |
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
| `id` | string | source | Unique id. Copies point at it through `sessionId`. If missing or duplicated, a new one is generated on import. |
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

## `pokemon`

One object per copy. Every copy you hold is here, whatever its origin.

```json
{ "source": "starter", "dexId": 4,   "tier": "common", "shiny": false, "at": "…", "sessionId": "s-…" }
{ "source": "track",   "dexId": 162, "tier": "common", "shiny": false, "at": "…", "sessionId": "s-…",
  "n": 1, "trackPoints": 100, "pity": false, "form": "…", "bonusForm": "…" }
{ "source": "shop",    "dexId": 479, "tier": "common", "shiny": false, "at": "…", "form": "wash", "cost": 5 }
{ "source": "gift",    "dexId": 150, "tier": "legendary", "shiny": false, "at": "…" }
```

### `source`: where a copy came from

| `source` | What it is | On the track? | Earns a coin? |
|---|---|---|---|
| `starter` | The one you chose at 1 point. At most one; a second is kept as a `gift`. | The START station | Yes, 1 |
| `track` | Rolled at a 100-point mark. | Yes: the 1st is the station at 100, the 2nd at 200 ... | Yes, 1 each |
| `shop` | Bought with Pokécoins. | No | No (it cost `cost`) |
| `gift` | Simply given. Never written by the site; for test saves and hand edits. | No | No |

`source` is required. Whatever the source, a copy counts towards its species'
total, can be the shiny one, can unlock an alternate form, and can be set
aside for a fusion.

### Fields

| Field | On | Source? | Meaning |
|---|---|---|---|
| `source` | all | source | See above. |
| `dexId` | all | source | National Pokédex number. Required. Look numbers up in [`data/pokedex.json`](../data/pokedex.json). |
| `tier` | all | source | `"common"`, `"legendary"` or `"mythical"`. Used by the pity counter (track copies) and for display. Anything else is read as `"common"`. |
| `shiny` | all | source | Whether this copy is the shiny one. |
| `form` | all | source | The alternate form this copy arrived in, e.g. `"alola"` or `"heat"`. Left out for the ordinary (Base) form. Form keys are listed per species in [`data/forms.json`](../data/forms.json). |
| `at` | all | source | When you got it. |
| `sessionId` | `track`, `starter` | source | The session that earned it; History shows the Pokémon on that session. `null` is fine. |
| `pity` | `track` | source | `true` if the pity rule forced this legendary. Informational. |
| `bonusForm` | `track` | source | The paid form that came free with this reward, if one did. Informational: what actually unlocks the form is its entry in [`unlocks`](#unlocks). |
| `cost` | `shop` | source | Pokécoins paid. |
| `n` | `track` | **derived** | Which reward this is, starting at 1: its place among the track copies. |
| `trackPoints` | `track` | **derived** | `n × 100`. |

### Order

Copies are appended as you get them. **The order of the `track` copies
matters**: it is the order of the stations. Where the other copies sit in the
list makes no difference.

### The track

The number of rewards you are owed is
`floor(highWater / 100) − (number of track copies)`. If that is positive when
the site loads, it rolls the missing ones on the spot. If it is zero or
negative, nothing happens: **Pokémon are never removed automatically**.

The starter choice is offered when `highWater` is at least 1 and there is no
`starter` copy.

## `unlocks`

One object per paid form you can use. These are the forms of kind `upgrade`
in `data/forms.json`: Mega, Gigantamax, Primal, Crowned and so on.

```json
{ "dexId": 6,  "form": "mega-x", "source": "shop",  "cost": 150, "at": "2026-11-21T09:12:00.000Z" }
{ "dexId": 94, "form": "mega",   "source": "bonus", "cost": 0,   "at": "2026-11-22T10:00:00.000Z" }
```

| Field | Meaning |
|---|---|
| `dexId` | The Pokémon. Required. |
| `form` | The form's key in `data/forms.json`. Required. |
| `source` | `"shop"` (bought), `"bonus"` (came free with a track reward) or `"gift"` (given). Defaults to `"shop"`. |
| `cost` | Pokécoins paid. Always 0 unless `source` is `"shop"`. |
| `at` | When it was unlocked. |

Free alternate forms (Alolan, Heat Rotom ...) are **not** listed here: one is
unlocked by holding a copy that arrived in it, so it follows from `pokemon`.
Zygarde's 10% and Complete follow from how many Zygarde copies you hold.

## `fusions`

One object per fusion made.

```json
{ "fusion": 643646000, "cost": 150, "at": "2026-11-22T10:00:00.000Z", "undoneAt": null }
```

| Field | Meaning |
|---|---|
| `fusion` | The fusion's number in `data/forms.json`. Required. |
| `cost` | Pokécoins paid. |
| `at` | When it was made. |
| `undoneAt` | `null` while the fusion exists. When it is unfused, the time is written here and **the entry stays**, cost and all. That is how "unfusing does not refund" is recorded. |

A fusion exists when it has an entry with `"undoneAt": null`. Fusing the same
two Pokémon again later adds a new entry.

## `grants`

```json
{ "coins": 500, "at": "2026-11-17T07:59:00.000Z" }
```

Pokécoins handed out directly. The site never writes one; they are for test
saves and hand edits. `coins` must be a whole number, 0 or more.

## `wallet`

Entirely derived.

| Field | Meaning |
|---|---|
| `earned` | 1 per `track` copy, plus 1 for the `starter` copy, plus every `coins` in `grants`. |
| `spent` | Every `cost`: on `shop` copies, on `unlocks`, and on `fusions` (undone ones included). |
| `balance` | `earned − spent`. What the Shop shows. |

The rules behind coins and purchases are in [shop.md](shop.md).

## `pity`

`{ "dry": n }`: how many of the most recent `track` copies, counting back
from the newest, were not legendary. Copies from any other source are not
rewards and are skipped. When it reaches 20 the next roll is a guaranteed
legendary.

## `active`

A stopwatch in progress, or `null`.

```json
{
  "kind": "chad",
  "startedAt": "2026-11-18T18:00:00.000Z",
  "pauses": [{ "from": "2026-11-18T18:20:00.000Z", "to": "2026-11-18T18:25:00.000Z" }],
  "pausedAt": null,
  "remindersSent": 1
}
```

`pausedAt` is the start of the break in progress, or `null` when running.
`remindersSent` is how many 45-minute reminders this session has already
shown, so that a refresh does not show one again (see
[stopwatch.md](stopwatch.md#timing-and-delivery)).

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
The score drops accordingly. Any Pokémon it earned stay in `pokemon`; their
`sessionId` simply no longer matches anything, which is harmless.

### Add a session you forgot

Append an object to the end of `sessions`. The minimum is:

```json
{ "kind": "chad", "startedAt": "2026-11-12T14:00:00Z", "activeMinutes": 90, "stars": 3 }
```

Everything else is filled in. If the new total passes a 100-point mark you
have never reached, the site rolls the new Pokémon when you load the file.

### Give yourself a Pokémon

Append a **gift** to `pokemon`:

```json
{ "source": "gift", "dexId": 150, "tier": "legendary" }
```

It is held from then on, and nothing else changes: the track, the coins and
the luck gauge stay as they were. The file is trusted here: the 7 / 5 / 2
limits and the shiny rule are only enforced when the site rolls or sells, not
when you type. Add `"shiny": true` or `"form": "alola"` if you want them.

Do **not** use `"source": "track"` for this. A track copy is a claimed
station: it would use up the next 100-point reward, add a coin, and count
towards the luck gauge.

### Remove a Pokémon

Delete its object from `pokemon`.

- A `gift` or `shop` copy just goes (a `shop` copy's `cost` returns to your
  balance).
- A `track` copy frees its station. If your high-water mark still covers it,
  the site rolls a replacement on load. To keep the station but lose the
  Pokémon, there is no way; lower the score too, or accept the re-roll.
- The `starter` copy: see the next recipe.

### Start the starter choice over

Delete the copy with `"source": "starter"`. You are asked again the next time
the site loads (provided `highWater` is at least 1).

### Give yourself coins

There is no coin field to raise: `wallet` is worked out, not stored. Append
to `grants`:

```json
{ "coins": 500 }
```

### Get coins back for a purchase

Delete what was bought: the `shop` copy from `pokemon`, the entry from
`unlocks`, or the entry from `fusions`. Its `cost` returns to your balance
and the thing itself is gone. To keep the thing and still get the coins back,
set its `cost` to 0 (or, for a copy, change its `source` to `"gift"`).

### Change the form of a copy

Set or remove `"form"` on the copy. Use a key from that species' entries in
`data/forms.json`; an unknown key is shown as the ordinary Pokémon.

### Unlock a paid form or make a fusion by hand

Append to `unlocks` or `fusions`, for example
`{ "dexId": 94, "form": "mega", "source": "gift" }` or
`{ "fusion": 643646000, "cost": 0 }`. The file is trusted here too:
requirements such as spare copies are checked when you buy in the shop, not
when you type.

### Undo a fusion by hand

Set its `undoneAt` to a date-time (keeps the cost spent, like the UNFUSE
button), or delete the entry (returns the cost).

## What happens on import

1. The text must be valid JSON, an object, with `"app": "pokechad"` and a
   `schema` this version understands. Otherwise the import is refused with a
   message and nothing changes.
2. A version 1 file is converted to version 2 (see
   [Schema versions](#schema-versions)).
3. Every session must have a valid `kind`, `startedAt` and `activeMinutes`;
   every copy a valid `source` and `dexId`; every unlock a `dexId` and a
   `form`; every fusion a `fusion` number; every grant a whole number of
   `coins`. One bad entry refuses the whole file and names the entry (for
   example "Session 12: …" or "Pokémon 3: …").
4. Derived fields are recalculated.
5. `active` is dropped.
6. You are asked to confirm, then the browser's save is replaced.
7. If the starter or any rewards are owed, they are handed out.

If the save in `localStorage` itself is ever unreadable, the site starts
fresh and keeps the unreadable text under `pokechad.v1.corrupt` so it can be
recovered by hand.

## Schema versions

`schema` is bumped when the format changes in a way older code could not
read.

| Version | Shape |
|---|---|
| 1 | `starter` (an object), `rewards` (the rolled Pokémon) and `shop.ledger` (a list of purchases of type `copy`, `upgrade`, `fuse`, `unfuse`, `grant`). A Pokémon could only be described as earned on the track or bought. |
| 2 | `pokemon`, `unlocks`, `fusions`, `grants`, and the derived `wallet`. Every copy says where it came from, so a Pokémon can be held without being a reward. |

A file with a higher `schema` than the site knows is refused ("update the
site first").

### Version 1 files still load

`upgradeFromV1()` in `js/state.js` converts a version 1 save, whether it is
the one in your browser or a backup file you import:

| Version 1 | Version 2 |
|---|---|
| `starter` | a copy in `pokemon` with `"source": "starter"` |
| `rewards`, in order | copies in `pokemon` with `"source": "track"`, in the same order |
| ledger `copy` | a copy in `pokemon` with `"source": "shop"` and its `cost` |
| ledger `upgrade` | an entry in `unlocks` with `"source": "shop"` and its `cost` |
| ledger `fuse` | an entry in `fusions` with its `cost` |
| ledger `unfuse` | `undoneAt` on the fusion it undid |
| ledger `grant` | an entry in `grants` |

Nothing is dropped and no number changes: the same copies, the same stations
on the track, the same coin balance.

The storage key is still `pokechad.v1` (the name is historical), so the save
already in your browser is found and converted the first time the new
version of the site loads. As a safety net, the untouched version 1 text is
kept once under **`pokechad.v1.before-schema-2`**. You can read it in the
browser's developer tools (Application → Local Storage), and delete it
whenever you like.
