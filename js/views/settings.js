/**
 * Backup and settings: export, import, sound, reset, and the small print.
 */

import { h, fmtDateTime, fmtDate } from '../dom.js';
import { STORAGE_KEY, SCHEMA } from '../state.js';
import { collection } from '../rewards.js';

export function render(ctx, root) {
  const { state, dex } = ctx;

  const file = h('input', {
    type: 'file',
    accept: 'application/json,.json',
    class: 'visually-hidden',
    'aria-label': 'Choose a backup file',
    onchange: () => {
      if (file.files && file.files[0]) ctx.importBackup(file.files[0]);
      file.value = '';
    },
  });

  root.append(
    h('div', { class: 'page-head' },
      h('a', { class: 'btn btn-small', href: '#/' }, '◀ BACK'),
      h('h1', {}, 'BACKUP')),

    h('section', { class: 'box pad stack' },
      h('h2', {}, 'EXPORT'),
      h('p', {}, 'Everything is saved only in this browser. Export a file now and then so clearing your browser data cannot wipe your progress.'),
      h('p', { class: 'label muted' },
        state.lastExportAt ? `LAST EXPORT: ${fmtDateTime(state.lastExportAt)}` : 'NEVER EXPORTED'),
      h('div', {}, h('button', { class: 'btn btn-primary', type: 'button', onclick: ctx.exportBackup }, 'EXPORT JSON'))),

    h('section', { class: 'box pad stack' },
      h('h2', {}, 'IMPORT'),
      h('p', {}, 'Loading a backup replaces what is saved here. Points and scores are recalculated from the sessions in the file, so a hand-edited backup is fine.'),
      h('div', {}, file, h('button', { class: 'btn', type: 'button', onclick: () => file.click() }, 'LOAD JSON'))),

    h('section', { class: 'box pad stack' },
      h('h2', {}, 'SOUND'),
      h('div', {},
        h('button', { class: 'btn', type: 'button', 'aria-pressed': String(!state.settings.muted), onclick: ctx.toggleMute },
          state.settings.muted ? 'SOUND IS OFF' : 'SOUND IS ON'))),

    h('section', { class: 'box pad stack' },
      h('h2', {}, 'ABOUT'),
      h('dl', { class: 'facts' },
        h('dt', {}, 'SESSIONS'), h('dd', {}, String(state.sessions.length)),
        h('dt', {}, 'POKéMON'), h('dd', {}, String(collection(state).length)),
        h('dt', {}, 'STARTED'), h('dd', {}, fmtDate(state.createdAt)),
        h('dt', {}, 'POKéDEX DATA'), h('dd', {}, `${dex.species.length} SPECIES · ${dex.updatedAt ? fmtDate(dex.updatedAt) : '?'}`),
        h('dt', {}, 'SAVE FORMAT'), h('dd', {}, `${STORAGE_KEY} · SCHEMA ${SCHEMA}`)),
      h('p', { class: 'muted small' },
        'PokéChad is an unofficial, non-commercial fan project. Pokémon and all related names and artwork belong to Nintendo, Game Freak and Creatures. Pokédex data and sprites come from PokeAPI.')),

    h('section', { class: 'box pad stack danger-zone' },
      h('h2', {}, 'DANGER ZONE'),
      h('p', {}, 'Delete every session and every Pokémon saved in this browser.'),
      h('div', {}, h('button', { class: 'btn btn-danger', type: 'button', onclick: ctx.resetAll }, 'DELETE ALL DATA'))),
  );
}
