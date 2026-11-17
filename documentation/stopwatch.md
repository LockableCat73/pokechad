# Stopwatch

Code: [`js/stopwatch.js`](../js/stopwatch.js) (logic),
[`js/encourage.js`](../js/encourage.js), [`js/notify.js`](../js/notify.js),
[`js/wakelock.js`](../js/wakelock.js), [`js/favicon.js`](../js/favicon.js)
(reminders, screen, tab icon),
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
{ "kind": "chad", "startedAt": "…", "pauses": [{ "from": "…", "to": "…" }], "pausedAt": null, "remindersSent": 0 }
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
| `reminderStatus(active, now)` | Whether a 45-minute reminder is due. |
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
- The browser tab icon changes: **Crowned Zacian** during a chad session,
  **Gigantamax Snorlax** during a chud session, and the ordinary icon when
  nothing is running (`setFavicon()` in `js/favicon.js`). The sprites have a
  wide empty margin, so each is trimmed to its visible pixels and enlarged by
  a whole number before it is used.
- The screen is kept awake where the browser allows it (`js/wakelock.js`).
  There is no switch for this.

## Reminders

Every **45 minutes of active time** the site shows a short encouraging
message with a random Pokémon you hold: "1H 30M of chad time. Pikachu is
cheering you on. Keep going!". During chud time it suggests wrapping up
instead.

| Where you are | What you get |
|---|---|
| PokéChad is in front | A message at the bottom of the screen with the Pokémon, and a chime. |
| The tab is in the background | The same, plus a **system notification**. Clicking it brings the tab forward. |

Details:

- Reminders follow active time. A break does not count towards the 45
  minutes, and nothing arrives during a break.
- `remindersSent` on the running session records how many 45-minute marks
  have been dealt with, so a refresh never repeats one. If several marks pass
  unseen (the computer slept), you get one reminder on return, not one per
  mark (`reminderStatus()`).
- The words are in `js/encourage.js`. With no Pokémon yet, a line without a
  name is used and the picture is the app icon.
- **Permission.** The first time you start a stopwatch the browser asks
  whether PokéChad may show notifications. If you say no, or the browser has
  none, you still get the on-screen message. The question is asked once.
- **No server.** The page decides when to remind you, so it has to be
  running. A background tab on a computer is fine. A phone that has locked,
  or put the browser to sleep, cannot be reached; that is why the screen is
  kept awake during a session. Time itself is always counted correctly from
  the saved timestamps, whatever happens to the reminders.

### Trying it from the browser's console

Open the developer tools (F12, or right-click → Inspect), choose the
**Console** tab, and type:

```js
Notification.permission
```

`"granted"` means system notifications are allowed, `"denied"` that they are
blocked for this site, `"default"` that you have not been asked yet.

```js
pokechad.testReminder()
```

Asks for permission if needed, then sends a chad reminder now: on screen and
as a system notification, even though the tab is in front. It answers with
what happened in words.

```js
pokechad.testReminder('chud')
```

The same with the chud wording.

If nothing appears although it says "Sent": check that notifications are
switched on for your browser in the operating system's settings, and that Do
Not Disturb / Focus is off.
