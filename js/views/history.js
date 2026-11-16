/**
 * History: every recorded session, newest first, with how it was recorded,
 * its rating, description, points and any Pokémon it earned.
 */

import { h, sprite, fmtDateTime, fmtMinutes, fmtPoints, fmtNumber } from '../dom.js';
import { starRow } from '../pixelart.js';
import { collection } from '../rewards.js';
import { resolveMon } from '../mon.js';

const PAGE = 50;

let filter = 'all';

export function render(ctx, root) {
  const { state, dex } = ctx;

  const rewardsBySession = new Map();
  for (const reward of collection(state)) {
    if (!reward.sessionId) continue;
    if (!rewardsBySession.has(reward.sessionId)) rewardsBySession.set(reward.sessionId, []);
    rewardsBySession.get(reward.sessionId).push(reward);
  }

  // Newest first, in the order they were recorded.
  const all = state.sessions.slice().reverse();
  const list = h('ol', { class: 'history-list' });
  const more = h('button', { class: 'btn', type: 'button' }, 'SHOW MORE');
  const summary = h('span', { class: 'label muted' }, '');
  let limit = PAGE;

  function row(session) {
    const earned = rewardsBySession.get(session.id) || [];
    return h('li', { class: `box entry entry-${session.kind}` },
      h('div', { class: 'row between' },
        h('span', { class: `tag tag-${session.kind}` }, session.kind.toUpperCase()),
        h('span', { class: `points ${session.points < 0 ? 'negative' : session.points > 0 ? 'positive' : ''}` }, `${fmtPoints(session.points)} PTS`)),
      h('div', { class: 'row between wrap' },
        h('span', { class: 'label' }, fmtDateTime(session.startedAt)),
        starRow(session.stars)),
      h('div', { class: 'label muted' },
        [
          fmtMinutes(session.activeMinutes),
          session.method === 'manual' ? 'ADDED BY HAND' : 'STOPWATCH',
          session.pauses.length ? `${session.pauses.length} BREAK${session.pauses.length === 1 ? '' : 'S'}` : null,
          session.autoEnded ? 'AUTO-ENDED' : null,
          `NET ${fmtNumber(session.netAfter)}`,
        ].filter(Boolean).join(' · ')),
      session.note ? h('p', { class: 'note' }, session.note) : null,
      earned.length
        ? h('div', { class: 'earned' },
            earned.map((reward) => {
              // In the form the copy arrived in (Alolan, Heat ...).
              const species = resolveMon(ctx, reward);
              return h('span', { class: `earned-item${reward.shiny ? ' shiny' : ''}` },
                sprite(species, { shiny: reward.shiny }),
                h('span', { class: 'label' }, `${species ? species.name : `#${reward.dexId}`}${reward.shiny ? ' (SHINY)' : ''}${reward.starter ? ' (STARTER)' : ''}`));
            }))
        : null);
  }

  function paint() {
    const matching = filter === 'all' ? all : all.filter((s) => s.kind === filter);
    list.replaceChildren(...matching.slice(0, limit).map(row));
    more.hidden = matching.length <= limit;
    summary.textContent = matching.length
      ? `${matching.length} SESSION${matching.length === 1 ? '' : 'S'}`
      : '';
    empty.hidden = matching.length > 0;
  }

  const empty = h('p', { class: 'box pad muted', hidden: true },
    'NO SESSIONS YET. START A STOPWATCH FROM THE DASHBOARD.');

  more.addEventListener('click', () => {
    limit += PAGE;
    paint();
  });

  const buttons = [['all', 'ALL'], ['chad', 'CHAD'], ['chud', 'CHUD']].map(([key, label]) =>
    h('button', {
      class: `btn btn-small${filter === key ? ' selected' : ''}`,
      type: 'button',
      'aria-pressed': String(filter === key),
      onclick: (event) => {
        filter = key;
        limit = PAGE;
        ctx.sfx.play('click');
        for (const b of buttons) {
          b.classList.toggle('selected', b === event.currentTarget);
          b.setAttribute('aria-pressed', String(b === event.currentTarget));
        }
        paint();
      },
    }, label));

  root.append(
    h('div', { class: 'page-head' },
      h('a', { class: 'btn btn-small', href: '#/' }, '◀ BACK'),
      h('h1', {}, 'HISTORY')),
    h('div', { class: 'filters' }, h('div', { class: 'row wrap' }, buttons), summary),
    empty,
    list,
    h('div', { class: 'center' }, more),
  );
  paint();
}
