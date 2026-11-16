# Rewards

Code: [`js/rewards.js`](../js/rewards.js). Reveal animation:
[`js/views/reveal.js`](../js/views/reveal.js). Starter choice:
[`js/views/starter.js`](../js/views/starter.js).

## The track

| Position | What you get |
|---|---|
| 1 point | **Starter**: you choose Bulbasaur, Charmander, Squirtle or Pikachu |
| 100 points | Random Pokémon |
| 200 points | Random Pokémon |
| … | One more every 100 points |

Positions are measured against your **high-water mark** (the best net score
you have ever reached; see [scoring.md](scoring.md)), so chud time never
takes a Pokémon away.

## The starter

- Unlocks once, when the high-water mark first reaches `STARTER_POINTS` (1).
  In practice that is right after your first session that leaves the score
  positive.
- It is a choice, not a roll: `STARTERS = [1, 4, 7, 25]`.
- It is an **extra** reward. It is stored in `state.starter`, separate from
  the rolled `state.rewards`, and does not shift the rewards at 100, 200, …
- It counts as one copy of its species. Choosing Charmander means six more
  Charmander can be rolled, and the sixth (your seventh copy) is the shiny.
- It is not a roll, so it does not touch the pity counter.
- If you have no buddy yet, the starter becomes your buddy.

`starterOwed(highWater, starter)` decides whether the choice is due.
`collection(state)` returns every copy you hold, starter first, in one list;
views use it so they do not need to special-case the starter.

## Tiers

Every species in `data/pokedex.json` has a tier, taken from PokeAPI's
`is_legendary` and `is_mythical` flags.

| Tier | Chance per roll | Copies allowed | Shiny copy |
|---|---|---|---|
| Common | 94% | 7 | the 7th |
| Legendary | 5% | 5 | the 5th |
| Mythical | 1% | 2 | the 2nd |

These numbers live in the `TIERS` constant.

## How a roll works

`rollReward({ species, rewards, starter, rng })`:

1. **Pity check.** If the pity counter has reached `PITY_LIMIT` (20) and at
   least one legendary is still available, the tier is forced to legendary.
2. **Otherwise roll the tier** by weight, 94 / 5 / 1. A tier in which every
   species is already at its cap is left out, and the remaining tiers share
   the odds in proportion.
3. **Pick the species** uniformly at random from that tier's eligible pool:
   species below their cap that have a sprite.
4. **Shiny?** The copy is shiny if it brings you to the tier's cap. Every
   earlier copy is normal. There is no random shiny chance.

It returns `null` only when every species in the game is at its cap.

Random numbers come from `crypto.getRandomValues`. Tests pass their own
generator through the `rng` argument.

## Pity

The pity counter is the number of most recent rewards, counting back from the
newest, that were **not legendary** (`pityDry(rewards)`).

- A common roll adds one.
- A mythical roll also adds one. Mythicals do not reset pity.
- A legendary roll resets it to zero.
- At 20, the next roll is a guaranteed legendary.

Pity only ever produces a legendary. Mythicals come solely from the normal 1%
roll. A reward forced by pity is marked `pity: true`.

The dashboard shows the worst case: "Legendary guaranteed in N rewards or
fewer", where `N = 21 − counter`.

## Handing out rewards

`grantOwed()` is called after every saved session, at start-up, and after an
import. It rolls once for each reward owed:

```
owed = floor(highWater / 100) − rewards.length      (never below 0)
```

A long session can cross several marks at once; each gets its own roll and
its own reveal. With more than one waiting, the reveal dialog offers "Skip
all", which jumps to a summary grid.

Each reward is stored as:

```json
{ "n": 4, "trackPoints": 400, "dexId": 245, "tier": "legendary",
  "shiny": false, "pity": true, "at": "2026-11-20T18:04:11.000Z",
  "sessionId": "s-mwq2x1ab-9kd0" }
```

## What "every Pokémon is available" means

The pool is every species in `data/pokedex.json` with a sprite: all 1,025 at
the time of writing (931 common, 71 legendary, 23 mythical). Alternate forms
(regional forms, Mega Evolutions and so on) are not separate entries. When
PokeAPI adds species, the updater adds them to the pool; see
[pokedex-updater.md](pokedex-updater.md).

Filling the whole collection takes 931×7 + 71×5 + 23×2 = 6,918 copies.

## Buddy

Any Pokémon you hold can be set as your buddy from its Pokédex entry. It is
shown on the dashboard. If you hold the shiny copy you can choose the shiny
look. It is cosmetic.
