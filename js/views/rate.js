/**
 * The two dialogs that turn time into a recorded session:
 *   openRating()  rate a stopwatch session that has just ended
 *   openManual()  add time after the fact
 * Both end in ctx.commitSession().
 */

import { h, fmtMinutes, fmtDateTime, fmtPoints } from '../dom.js';
import { starIcon } from '../pixelart.js';
import { signedPoints, STAR_MAX } from '../scoring.js';
import { roundMinutes } from '../stopwatch.js';
import { NOTE_MAX } from '../state.js';

/** What each rating means, per kind. Index = number of stars. */
const STAR_WORDS = {
  chad: ['WASTED', 'MEH', 'DECENT', 'GREAT', 'BEST'],
  chud: ['HARMLESS', 'MILD', 'BAD', 'AWFUL', 'PEAK CHUD'],
};

/**
 * Star picker: a "0" button and four stars. Stars up to the chosen value are
 * yellow; choosing 4 turns them all red (classic IV-judge look).
 *
 * @param {'chad'|'chud'} kind
 * @param {(stars:number) => void} onChange
 * @returns {{el: HTMLElement, value: () => number}}
 */
function starPicker(kind, onChange) {
  let value = 0;
  const word = h('div', { class: 'label star-word' }, '');
  const buttons = [];
  const group = h('div', { class: 'star-picker', role: 'radiogroup', 'aria-label': 'Rating' });

  function paint() {
    buttons.forEach((button, i) => {
      button.setAttribute('aria-checked', String(i === value));
      button.classList.toggle('selected', i === value);
      if (i === 0) return;
      const state = i > value ? 'empty' : value >= STAR_MAX ? 'red' : 'yellow';
      button.replaceChildren(starIcon(state, 3));
    });
    word.textContent = `${value} / ${STAR_MAX} · ${STAR_WORDS[kind][value]}`;
  }

  for (let i = 0; i <= STAR_MAX; i++) {
    const button = h('button', {
      class: `star-btn${i === 0 ? ' star-zero' : ''}`,
      type: 'button',
      role: 'radio',
      'aria-label': `${i} star${i === 1 ? '' : 's'}`,
      onclick: () => {
        value = i;
        paint();
        onChange(value);
      },
    }, i === 0 ? '0' : null);
    buttons.push(button);
    group.append(button);
  }
  paint();
  return { el: h('div', { class: 'stack tight' }, group, word), value: () => value };
}

function noteField() {
  const counter = h('span', { class: 'label muted' }, `0/${NOTE_MAX}`);
  const input = h('input', {
    class: 'input',
    type: 'text',
    maxlength: String(NOTE_MAX),
    placeholder: 'WHAT DID YOU DO?',
    'aria-label': 'Short description',
    autocomplete: 'off',
    oninput: () => {
      counter.textContent = `${input.value.length}/${NOTE_MAX}`;
    },
  });
  return { el: h('div', { class: 'stack tight' }, h('div', { class: 'row between' }, h('span', { class: 'label' }, 'DESCRIPTION'), counter), input), input };
}

function pointsPreview(kind) {
  const el = h('div', { class: `preview preview-${kind}`, 'aria-live': 'polite' }, '0 PTS');
  return {
    el,
    set(minutes, stars) {
      el.textContent = `${fmtPoints(signedPoints(kind, minutes, stars))} PTS`;
    },
  };
}

/** Rate the stopwatch session stored in ctx.state.pendingRating. */
export function openRating(ctx) {
  const pending = ctx.state.pendingRating;
  if (!pending) return;
  const { kind } = pending;
  const preview = pointsPreview(kind);
  const picker = starPicker(kind, (stars) => preview.set(pending.activeMinutes, stars));
  const note = noteField();
  preview.set(pending.activeMinutes, 0);

  const form = h('form', {
    class: 'stack',
    onsubmit: (event) => {
      event.preventDefault();
      ctx.commitSession(pending, picker.value(), note.input.value);
    },
  },
    h('h2', { class: `title-${kind}` }, `${kind.toUpperCase()} SESSION DONE`),
    pending.autoEnded
      ? h('p', { class: 'notice' }, 'ENDED AUTOMATICALLY AFTER A 35 MINUTE BREAK. TIME BEFORE THE BREAK IS KEPT.')
      : null,
    h('dl', { class: 'facts' },
      h('dt', {}, 'ACTIVE TIME'), h('dd', {}, fmtMinutes(pending.activeMinutes)),
      h('dt', {}, 'STARTED'), h('dd', {}, fmtDateTime(pending.startedAt)),
      h('dt', {}, 'BREAKS'), h('dd', {}, String(pending.pauses.length))),
    h('div', { class: 'label' }, kind === 'chad' ? 'HOW GOOD WAS IT?' : 'HOW BAD WAS IT?'),
    picker.el,
    note.el,
    preview.el,
    h('div', { class: 'row end' },
      h('button', {
        class: 'btn btn-quiet',
        type: 'button',
        onclick: async () => {
          const ok = await ctx.confirm('Discard this session? Its time will not be recorded.', { yes: 'DISCARD', danger: true });
          if (ok) ctx.discardPending();
        },
      }, 'DISCARD'),
      h('button', { class: `btn btn-${kind}`, type: 'submit' }, 'SAVE')));

  ctx.openModal(form, { locked: true, label: 'Rate your session' });
}

/** Add a session after the fact. */
export function openManual(ctx, kind) {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const hourAgo = new Date(now.getTime() - 3_600_000);

  const date = h('input', { class: 'input', type: 'date', value: today, max: today, required: true, 'aria-label': 'Date' });
  const time = h('input', { class: 'input', type: 'time', value: `${pad(hourAgo.getHours())}:${pad(hourAgo.getMinutes())}`, required: true, 'aria-label': 'Start time' });
  const hours = h('input', { class: 'input num', type: 'number', min: '0', max: '23', step: '1', value: '0', inputmode: 'numeric', 'aria-label': 'Hours' });
  const minutes = h('input', { class: 'input num', type: 'number', min: '0', max: '59', step: '1', value: '30', inputmode: 'numeric', 'aria-label': 'Minutes' });
  const problem = h('p', { class: 'notice', role: 'alert', hidden: true }, '');

  const duration = () => (Number(hours.value) || 0) * 60 + (Number(minutes.value) || 0);
  const preview = pointsPreview(kind);
  const picker = starPicker(kind, () => refresh());
  const note = noteField();
  function refresh() {
    preview.set(duration(), picker.value());
  }
  hours.addEventListener('input', refresh);
  minutes.addEventListener('input', refresh);
  refresh();

  const form = h('form', {
    class: 'stack',
    onsubmit: (event) => {
      event.preventDefault();
      const total = duration();
      const start = new Date(`${date.value}T${time.value}`);
      let message = '';
      if (Number.isNaN(start.getTime())) message = 'PICK A VALID DATE AND START TIME.';
      else if (!(total > 0)) message = 'DURATION MUST BE AT LEAST 1 MINUTE.';
      else if (total > 24 * 60) message = 'ONE ENTRY CAN COVER AT MOST 24 HOURS.';
      else if (start.getTime() + total * 60000 > Date.now() + 60000) message = 'THAT WOULD END IN THE FUTURE.';
      if (message) {
        problem.textContent = message;
        problem.hidden = false;
        ctx.sfx.play('error');
        return;
      }
      ctx.commitSession(
        {
          kind,
          method: 'manual',
          startedAt: start.toISOString(),
          endedAt: new Date(start.getTime() + total * 60000).toISOString(),
          activeMinutes: roundMinutes(total),
          pauses: [],
          autoEnded: false,
        },
        picker.value(),
        note.input.value,
      );
    },
  },
    h('h2', { class: `title-${kind}` }, `ADD PAST ${kind.toUpperCase()} TIME`),
    h('div', { class: 'grid2' },
      h('label', { class: 'stack tight' }, h('span', { class: 'label' }, 'DATE'), date),
      h('label', { class: 'stack tight' }, h('span', { class: 'label' }, 'STARTED AT'), time),
      h('label', { class: 'stack tight' }, h('span', { class: 'label' }, 'HOURS'), hours),
      h('label', { class: 'stack tight' }, h('span', { class: 'label' }, 'MINUTES'), minutes)),
    h('div', { class: 'label' }, kind === 'chad' ? 'HOW GOOD WAS IT?' : 'HOW BAD WAS IT?'),
    picker.el,
    note.el,
    preview.el,
    problem,
    h('div', { class: 'row end' },
      h('button', { class: 'btn btn-quiet', type: 'button', onclick: () => ctx.closeModal() }, 'CANCEL'),
      h('button', { class: `btn btn-${kind}`, type: 'submit' }, 'SAVE')));

  ctx.openModal(form, { label: `Add past ${kind} time` });
}
