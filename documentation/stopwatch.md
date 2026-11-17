# Stopwatch

Code: [`js/stopwatch.js`](../js/stopwatch.js) (logic),
[`js/encourage.js`](../js/encourage.js), [`js/messages.js`](../js/messages.js),
[`js/notify.js`](../js/notify.js),
[`js/wakelock.js`](../js/wakelock.js), [`js/favicon.js`](../js/favicon.js)
(messages, screen, tab icon),
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

## Messages

PokéChad speaks through a Pokémon you hold at two moments:

| Moment | Chad session | Chud session |
|---|---|---|
| **The stopwatch starts** | "Chad time started. Let's do this! Pikachu is with you." | "Chud time started. Really? Pikachu expected better." |
| **Every 45 minutes of active time** | "1H 30M of chad time. You are on fire! Charizard approves." | "45M of chud time. Even Snorlax gets up eventually." |

Chad lines cheer you on. Chud lines are meant to put you off: playful guilt,
never cruel.

| | On screen | System notification |
|---|---|---|
| Start message | Yes, with the Pokémon's picture | Yes, even though the tab is in front |
| 45-minute reminder | Yes, with the picture and a chime | Only when the tab is in the background. Clicking it brings the tab forward. |

### Where a line comes from

Code: [`js/encourage.js`](../js/encourage.js) picks; the lines are in
[`js/messages.js`](../js/messages.js).

| Pool | Used for | Example |
|---|---|---|
| `GENERAL` | Any Pokémon. Split by kind and by moment. | "{name} used Helping Hand! Keep it up." |
| `BY_TYPE` | A Pokémon of that type. A dual type draws from both of its types. | Fire: "You are on fire! {name} approves." |
| `BY_POKEMON` | One well-known Pokémon, keyed by its slug. Easter eggs. | Magikarp: "Keep splashing. Every Gyarados started here." |

`pickLine()` chooses the pool first, then a line in it:

| The Pokémon... | Own line | Type line | General line |
|---|---|---|---|
| has lines of its own | 1 in 2 | 1 in 4 | 1 in 4 |
| has none | – | 1 in 2 | 1 in 2 |

- A pool with nothing to offer gives its share to the general pool.
- The line shown last time is never shown again straight away.
- The Pokémon is picked evenly among the **species** you hold
  (`pickReminderCopy()`), so a hundred copies of one do not crowd out the
  rest. Within the species any copy may come up, in the form it arrived in.
- Types come from the data: `types` on each species in `data/pokedex.json`,
  and on each alternate form in `data/forms.json`. A copy in an alternate
  form uses the form's types (Alolan Vulpix gets Ice lines, not Fire).
- With no Pokémon held yet, a line from `NO_POKEMON` is used and the picture
  is the app icon.

**What keeps itself up to date:** the updater records the types of every new
Pokémon and form, so they get type and general lines with no edit.
**What does not:** the lines themselves, and above all `BY_POKEMON`, are
written by hand. A new Pokémon has no easter eggs until someone adds them.

**Adding a line** is adding a string to the right list in `js/messages.js`.
Use `{name}` for the Pokémon's name in `GENERAL` and `BY_TYPE`; `BY_POKEMON`
lines speak in the Pokémon's own voice and take no placeholder. The tests
check that every type and every Pokémon named there exists in the data.

### Timing and delivery

- Reminders follow active time. A break does not count towards the 45
  minutes, and nothing arrives during a break.
- `remindersSent` on the running session records how many 45-minute marks
  have been dealt with, so a refresh never repeats one. If several marks pass
  unseen (the computer slept), you get one reminder on return, not one per
  mark (`reminderStatus()`).
- The start message is not one of the 45-minute reminders; the first of
  those still arrives at 45:00. It is shown for the stopwatch only, not for
  "add past time".
- **Permission.** The first time you start a stopwatch the browser asks
  whether PokéChad may show notifications, and the start message follows
  your answer. If you say no, or the browser has none, you still get the
  on-screen messages. The question is asked once.
- **No server.** The page decides when to speak, so it has to be running. A
  background tab on a computer is fine. A phone that has locked, or put the
  browser to sleep, cannot be reached; that is why the screen is kept awake
  during a session. Time itself is always counted correctly from the saved
  timestamps, whatever happens to the messages.

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

The same with a chud line.

```js
pokechad.testStart()
```

```js
pokechad.testStart('chud')
```

The message a starting stopwatch would send, without starting one.

Each call picks a Pokémon and a line afresh, so running one a few times shows
the variety.

If nothing appears although it says "Sent": check that notifications are
switched on for your browser in the operating system's settings, and that Do
Not Disturb / Focus is off.
