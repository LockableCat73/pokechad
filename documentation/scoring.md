# Scoring

Code: [`js/scoring.js`](../js/scoring.js).

## Points for a session

```
points = floor( t / 60  +  t^1.05 × stars / 2 )
```

- `t` is the session's **active minutes**: clock time minus breaks. It can be
  fractional (a stopwatch session stores it to three decimals).
- `stars` is your rating, a whole number from 0 to 4.

A **chad** session adds the points. A **chud** session subtracts exactly the
same amount. The formula is identical for stopwatch sessions and for time
added after the fact.

| Active time | 0★ | 1★ | 2★ | 3★ | 4★ |
|---|---|---|---|---|---|
| 15 min | 0 | 8 | 17 | 26 | 34 |
| 30 min | 0 | 18 | 36 | 53 | 71 |
| 60 min | 1 | 37 | 74 | 111 | 148 |
| 120 min | 2 | 78 | 154 | 230 | 306 |

Two things follow from the shape of the formula:

- The `t^1.05` term grows slightly faster than time, so one long session is
  worth a little more than the same minutes split into short ones.
- With 0 stars only the `t / 60` term is left: one point per full hour.

Functions: `sessionPoints(minutes, stars)` returns the unsigned value,
`signedPoints(kind, minutes, stars)` applies the chad/chud sign, and
`clampStars()` forces a rating into 0–4.

## The multiplier on the stopwatch

```
multiplier = 1.05 × t^0.05 − 0.05
```

This number is shown beside the running stopwatch (for example `x1.22` at 42
minutes). It is roughly the slope of the `t^1.05` term, and it exists to show
that staying in the session keeps paying more per minute.

**It is display only.** `displayMultiplier()` is never used to compute
points; the formula above is the only thing that is.

Next to it the stopwatch shows "UP TO +N PTS": what the session would be
worth right now with 4 stars.

## Stars

Ratings follow the classic IV-judge look: 0 to 3 stars are drawn in yellow,
and a full 4 turns them all red. The colour is decoration only. The number of
stars feeds the formula; it has no effect on which Pokémon you receive.

| Stars | Chad wording | Chud wording |
|---|---|---|
| 0 | Wasted | Harmless |
| 1 | Meh | Mild |
| 2 | Decent | Bad |
| 3 | Great | Awful |
| 4 | Best | Peak chud |

For chad time, more stars means better work and more points. For chud time,
more stars means worse behaviour and a bigger loss.

## Net score and the high-water mark

`recalculate(sessions)` walks the sessions in the order they were recorded
and keeps two numbers:

- **net**: the running total of points. It goes down with chud time and can
  be negative.
- **highWater**: the highest value net has ever reached.

Rewards are owed against the high-water mark, not the current net:

```
rolled rewards owed = floor(highWater / 100) − rewards already given
```

That is what makes chud time a setback rather than a loss. If you reach 310
points, fall to 180, and climb back, you keep your three Pokémon and receive
nothing new on the way back up. The fourth arrives when you pass 400, a mark
you have never reached before.

`recalculate()` runs every time a session is saved and every time a save is
loaded or imported, so the stored `points`, `netAfter`, `net` and `highWater`
can always be rebuilt from the sessions alone.
