# Stopwatch

Code: [`js/stopwatch.js`](../js/stopwatch.js) (logic),
[`js/views/dashboard.js`](../js/views/dashboard.js) (`sessionPanel`, `tick`),
[`js/app.js`](../js/app.js) (`startSession`, `pauseSession`, `resumeSession`,
`stopSession`, `autoEnd`, `tick`).

## Two ways to record time

| Method | Stored as | How |
|---|---|---|
| Stopwatch | `"method": "stopwatch"` | Start it, optionally pause, stop it, then rate. This is the intended way. |
| Past time | `"method": "manual"` | Enter a date, start time and duration, and rate in the same form. |

Both use the same points formula. A manual entry must be at least 1 minute,
at most 23 hours 59 minutes, and cannot end in the future. The form opens with
a start time three hours before now. Mistakes are reported in the form's own
red notice, not in the browser's pop-up bubble.

## States

```
            start                 pause                  resume
 idle ───────────────► running ──────────► on break ──────────────► running
                          │                    │
                          │ stop               │ stop, or 35 minutes pass
                          ▼                    ▼
                    waiting for rating ◄───────┘
                          │
                 save ▼        ▼ discard
               recorded       dropped
```

Only one session can run at a time. While one is running, the two big
buttons are replaced by the stopwatch panel. While one is waiting for a
rating, the rating dialog stays open until you save or discard it.

## How time is measured

The stopwatch never counts ticks. The running session is stored as
timestamps:

```json
{ "kind": "chad", "startedAt": "…", "pauses": [{ "from": "…", "to": "…" }], "pausedAt": null }
```

and the active time is always computed from them:

```
active = (pausedAt or now) − startedAt − total length of finished pauses
```

This object is saved to `localStorage` the moment anything changes, so the
stopwatch carries on correctly through a page refresh, a closed tab, a
sleeping laptop or a browser restart.

| Function | What it does |
|---|---|
| `start(kind, now)` | New running session. |
| `pause(active, now)` | Sets `pausedAt`. |
| `resume(active, now)` | Moves the break into `pauses`, clears `pausedAt`. |
| `elapsedMs(active, now)` | Active time so far. |
| `breakMs(active, now)` | Length of the break in progress. |
| `breakStatus(active, now)` | `running`, `break`, `warning` or `expired`, plus time left. |
| `finish(active, now, { autoEnded })` | Turns the session into the unrated record. |

All of them take the current time as an argument and return new objects, so
they are easy to test.

## Breaks and the 35-minute limit

Paused time does not count towards `activeMinutes`.

| Break length | What you see |
|---|---|
| 0:00 – 29:59 | "On break mm:ss · ends at 35:00" |
| 30:00 – 34:59 | A flashing red box: **Continue or lose multiplier**, with a countdown from 5:00. A warning beep sounds when it appears and once a minute after. |
| 35:00 | The session ends automatically. |

Constants: `BREAK_LIMIT_MS` (35 minutes) and `BREAK_WARNING_MS` (the final 5
minutes).

When a session ends automatically:

- It keeps all the time earned **before** the break. `endedAt` is the moment
  the break began.
- It is marked `"autoEnded": true`.
- The rating dialog opens, with a note explaining what happened.
- Your next session starts a fresh stopwatch, so the multiplier starts again
  from the bottom. That is the "lose multiplier" in the warning.

The limit is enforced by the tick in `app.js`, which runs every 500 ms, and
again as the page loads. So if you pause, close the tab and come back two
hours later, the session is ended at once on return, with the same result as
if the tab had stayed open.

Stopping by hand during a break behaves the same way, minus the
`autoEnded` flag: the trailing break is not counted or listed.

## Rating

A session that has ended is stored as `pendingRating` until you rate it. The
dialog cannot be dismissed, and it reopens if you reload. You can:

- **Save** it with 0–4 stars and a description of up to 140 characters. The
  preview shows the points for the stars currently selected.
- **Discard** it (after a confirmation). Nothing is recorded.

## While a session runs

- The dashboard shows the clock, the display multiplier and the best-case
  points.
- On other screens a chip in the header shows the kind and the clock, and
  links back to the dashboard.
- The browser tab title shows the clock.
