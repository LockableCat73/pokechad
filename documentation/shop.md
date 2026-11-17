# Pokécoins, the shop and alternate forms

Code: [`js/shop.js`](../js/shop.js) (prices, purchases, fusions, Zygarde),
[`js/holdings.js`](../js/holdings.js) (reading the save: copies, unlocked
forms, fusions, coins),
[`js/forms.js`](../js/forms.js) (form data and form order),
[`js/mon.js`](../js/mon.js) (turning a form or fusion into a sprite),
[`js/views/shop.js`](../js/views/shop.js) and
[`js/views/cards.js`](../js/views/cards.js) (screens).
Data: [`data/forms.json`](../data/forms.json), written by the updater from
[`tools/forms_rules.json`](../tools/forms_rules.json).

## Pokécoins

- **1 coin for every reward on the track**: each 100-point reward, and the
  starter.
- The balance is worked out, never typed in: `balance = earned − spent`.
  - **Earned:** 1 per copy with `"source": "track"`, 1 for the starter, plus
    anything in `grants`.
  - **Spent:** the `cost` of every bought copy, every bought form and every
    fusion made, including fusions since undone.
  The save carries the three numbers as `wallet` so they can be read in the
  file, but they are recalculated on every load and every write.
- Buying things never earns coins and never moves the track or the luck
  gauge. A bought copy has `"source": "shop"`, so it is not a station.
- An entry in `grants` adds coins. The site never writes one; it is for test
  saves and hand-edited files.

**Test saves.** Two files for trying the shop, loaded from Backup → Load
JSON. Both leave Charmander out, hold exactly 1,000,000 Pokécoins through one
grant, and have no history. Every Pokémon in them is a **gift**
(`"source": "gift"`): held, but not earned on the track, so the track stays
at START with nothing claimed and the first reward you earn is reward
number 1.

| File | Holds |
|---|---|
| [`tests/all-pokemon-save.json`](../tests/all-pokemon-save.json) | 1 copy of every Pokémon: all Base, no shinies |
| [`tests/all-pokemon-x10-save.json`](../tests/all-pokemon-x10-save.json) | 10 copies of every Pokémon: every shiny and every free alternate form, Zygarde's 10% form, and spare copies for all six fusions |

`node tools/make_test_save.mjs` regenerates both.

## Prices

| Item | Cost |
|---|---|
| A copy of a common / legendary / mythical already found | 5 / 20 / 120 |
| An upgrade form | 150 |
| A fusion | 150, plus one copy of each of the two Pokémon set aside |
| A Zygarde copy | 1 |
| Mega Zygarde | 120 |

`PRICES` and `COLLECTOR` in `js/shop.js`.

## Buying copies

`copyOffer()` decides whether a copy can be bought; `buyCopy()` does it.

- **Only Pokémon you have already found.** New species come from the track.
- A bought copy is a real copy: it counts towards the species' total, and the
  copy that brings the total to 7 / 5 / 2 is the shiny.
- **Past the limit.** Rolls stop at 7 / 5 / 2. The shop may go further:

| Tier | Bought copies |
|---|---|
| Common, legendary | No upper limit. Copies beyond 7 / 5 are ordinary. |
| Mythical | Stop at 2. |
| A mythical with alternate formes still to unlock | May continue until all are unlocked. Today this is Deoxys alone: three formes, so 4 copies. |
| Zygarde | Up to 100 (see below). |

Extra copies of a common or legendary are useful for unlocking forms that
need more copies than the limit allows (Minior has seven colours) and as
spares for fusions.

## Alternate forms

Forms in `data/forms.json` have one of three kinds.

### Free forms (`variant`): one per copy, in Pokédex order

Regional forms (Alolan, Galarian, Hisuian, Paldean), Origin, Therian, Rotom's
appliances, Deoxys's formes, Oricorio's styles and the like, plus minor state
changes (Castform's weather, Hangry Morpeko, Busted Mimikyu).

`nextForm()` in `js/forms.js` decides which form a copy arrives in, whether
it was rolled or bought:

1. The first copy of a species is always Base.
2. Each later copy is the **next form not yet held**, in the order PokeAPI
   lists them. No form repeats while another is missing.
3. Once every form is held, the copy's form is random: Base or any alternate,
   each equally likely.

Rotom: Base, then Heat, Wash, Frost, Fan, Mow on copies 2 to 6, then random.

A form is unlocked once a copy has arrived in it. Each copy records its form
(`form` on the copy; absent means Base), and the encounter, the track and
History show that form.

### Paid forms (`upgrade`): 150 coins each, or a lucky reward

Mega, Mega X / Y / Z, Gigantamax, Primal, Crowned, School, Hero, Unbound,
Ultra, Eternamax, Ash, Terastal, Stellar, Blade, Zen, Pirouette.

`upgradeOffer()` / `buyUpgrade()`:

- Needs at least one copy of the Pokémon.
- Bought once per form; it then belongs to that Pokémon for good. Several can
  be bought for one Pokémon (Charizard: Mega X, Mega Y, Gigantamax).
- Each unlocked form is one entry in `state.unlocks`.
- **Or free, by luck:** a reward on the track for a Pokémon you already hold
  has a 1-in-12 chance of unlocking one of these forms at no cost. Bought
  copies never do, and Zygarde is left out. See
  [rewards.md](rewards.md#bonus-forms).
- Some need something else first, recorded as `requires` in the data
  (`formNeeds()`); a bonus respects these too:
  - `{ "form": "galar-standard" }`: an alternate form must be unlocked
    first. Galarian Zen needs Galarian Darmanitan; Rapid Strike Gigantamax
    needs Rapid Strike Urshifu.
  - `{ "fusionOf": 800 }`: a fusion of that Pokémon must exist at the time.
    Ultra Necrozma needs Dusk Mane or Dawn Wings.
- A form whose sprite PokeAPI has not published yet is listed but cannot be
  bought ("Art not available yet"). At the time of writing that is Mega
  Zygarde.

### Copy-count forms (`milestone`): Zygarde

See [Zygarde](#zygarde).

### Shiny forms

If you hold a species' shiny, every form of it that you have unlocked is
available in shiny too, including forms you unlock afterwards. Nothing is
stored for this: `hasShiny()` is asked each time.

## Fusions

| Fusion | Made from |
|---|---|
| White Kyurem, Black Kyurem | Kyurem + Reshiram, Kyurem + Zekrom |
| Dusk Mane Necrozma, Dawn Wings Necrozma | Necrozma + Solgaleo, Necrozma + Lunala |
| Ice Rider Calyrex, Shadow Rider Calyrex | Calyrex + Glastrier, Calyrex + Spectrier |

`fusionOffer()`, `fuse()`, `unfuseOffer()`, `unfuse()`:

- **To fuse:** both Pokémon found, at least 2 spare copies of each, and 150
  coins. Fusing sets one copy of each aside. Those copies still count towards
  the species' total; they are just not spare while the fusion exists
  (`fusedCopies()`, `spareCopies()`).
- A fusion is its own entry in the Pokédex's **Fused** tab.
- It is shiny when both of its Pokémon have their shiny.
- **To unfuse:** the two copies become spare again. **The coins are not
  refunded**, and fusing again costs 150 again. The fuse dialog and the
  unfuse dialog both say this.
- A fusion can be the buddy, and cannot be unfused while it is.
- One of each fusion at a time. Kyurem can be in both of its fusions at once
  if it has the spare copies.

**Fusion numbers.** Each fusion has an internal number that is never shown:
`1,000,000 × y + 1,000 × x`, where `x` is the Pokédex number of whichever of
the two Pokémon comes first alphabetically and `y` is the other. White Kyurem
is Kyurem (646) and Reshiram (643), so `643,646,000`.

## Zygarde

Zygarde is a "collector" species: its forms unlock by how many copies you
hold. A species is treated this way when the data gives it a `milestone`
form (`isCollector()`); the numbers are in `COLLECTOR`.

- It must be found once on the track first, like anything else in the shop.
- After that its copies cost **1 coin** each, up to **100**. Rolls still stop
  at 5, and its 5th copy is the shiny as usual.
- **10 copies** unlock the 10% form. **100 copies** unlock Complete.
- Mega Zygarde can then be bought for **120**. It needs Complete, and its
  artwork.

The Shop has a panel for it with "Buy 1" and "Buy 10".

## The buddy

Any unlocked form, in normal or shiny, and any fusion can be the buddy. The
save holds `{ dexId, shiny, form? }` or `{ fusion, shiny }`. If a save points
at a form you do not have, the plain Pokémon is shown instead
(`currentBuddy()` in `js/mon.js`).

## What a purchase writes

Each kind of purchase changes the save in one place:

| Purchase | What is written |
|---|---|
| A copy | A copy in `pokemon`: `{ "source": "shop", "dexId": 479, "tier": "common", "form": "wash", "shiny": false, "cost": 5, "at": "…" }` |
| An upgrade form | An entry in `unlocks`: `{ "dexId": 6, "form": "mega-x", "source": "shop", "cost": 150, "at": "…" }` |
| A fusion | An entry in `fusions`: `{ "fusion": 643646000, "cost": 150, "at": "…", "undoneAt": null }` |
| Unfusing | `undoneAt` is set on that fusion's entry. The entry and its cost stay, which is how "no refund" is recorded. |

Everything else is read from those lists by `holdings.js`: `balance()`,
`copiesOf()`, `unlockedForms()`, `activeFusions()`. The Shop's "Recent" list
comes from `activity()`, which gathers bought copies, unlocked forms (bought
or bonus), fusions made and undone, and grants, newest first. See
[storage.json.md](storage.json.md) for editing the save by hand.

## What updates itself and what does not

`data/forms.json` is regenerated by the updater (and so by the monthly
workflow). How a form is treated comes from `tools/forms_rules.json`.

| Picked up automatically | Needs an edit to `tools/forms_rules.json` |
|---|---|
| A new Mega (PokeAPI flags it) | A new fusion, and which two Pokémon make it |
| A new Gigantamax, or any form whose name ends in one of `upgradeForms` | A new *kind* of paid upgrade |
| Any other new form (becomes a free alternate form) | A nicer display label ("alola" → "Alolan") |
| New artwork for a form that had none | A form that should be left out |
| | Anything about Zygarde's chain |

So the forms system is only partly automatic. Details in
[pokedex-updater.md](pokedex-updater.md#alternate-forms).

### Left out on purpose

Totem forms, Pikachu's caps and cosplay outfits, the "starter" Pikachu and
Eevee, Minior's meteor shells, Koraidon's and Miraidon's ride modes (no
sprites), and exact look-alikes (Power Construct Zygarde, Battle Bond
Greninja, Own Tempo Rockruff). They are listed under `skipped` in
`data/forms.json` with the reason.
