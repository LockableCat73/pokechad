/**
 * Stats: all-time totals and two charts over a chosen range.
 *   1. Minutes per day, chad above the zero line and chud below it.
 *   2. Net score at the end of each day.
 * Charts are hand-built SVG drawn at the container's real width. Every day
 * has a hover / focus target with a tooltip, and a table view sits below.
 */

import { h, dayKey, fmtMinutes, fmtNumber } from '../dom.js';
import { collection } from '../rewards.js';

const SVG = 'http://www.w3.org/2000/svg';
const COLOR = { chad: '#2868c0', chud: '#c05828', ink: '#282030', grid: '#d8d0c0', muted: '#786858' };
const RANGES = [14, 30, 90];
const DAY = 86_400_000;
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

let range = 14;
let resizeBound = false;

function svg(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.append(...children);
  return el;
}

/** Per-day totals for the last `days` days, oldest first, ending today. */
function dailySeries(sessions, days) {
  const byEnd = sessions.slice().sort((a, b) => Date.parse(a.endedAt) - Date.parse(b.endedAt));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const series = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(today.getTime());
    date.setDate(today.getDate() - i);
    series.push({ key: dayKey(date), date, chad: 0, chud: 0, net: 0, sessions: 0 });
  }
  const index = new Map(series.map((d) => [d.key, d]));
  for (const s of sessions) {
    const day = index.get(dayKey(s.startedAt));
    if (!day) continue;
    day[s.kind] += s.activeMinutes;
    day.sessions++;
  }
  // Closing net score of each day: points of every session that ended by then.
  let running = 0;
  let cursor = 0;
  for (const day of series) {
    const endOfDay = day.date.getTime() + DAY;
    while (cursor < byEnd.length && Date.parse(byEnd[cursor].endedAt) < endOfDay) {
      running += byEnd[cursor].points;
      cursor++;
    }
    day.net = running;
  }
  return series;
}

/** A round step so that about `count` gridlines cover `max`. */
function niceStep(max, count, steps) {
  const raw = max / count;
  if (steps) return steps.find((s) => s >= raw) || steps[steps.length - 1];
  const power = 10 ** Math.floor(Math.log10(Math.max(raw, 1)));
  return [1, 2, 5, 10].map((m) => m * power).find((s) => s >= raw);
}

const axisMinutes = (m) => (m === 0 ? '0' : m % 60 === 0 ? `${m / 60}h` : `${m}m`);
const dayLabel = (d) => `${d.date.getDate()} ${MONTHS[d.date.getMonth()]}`;

/** Shared hover/focus layer: one invisible column per day plus a tooltip. */
function addHover(wrap, plot, series, geometry, describe, highlight) {
  const tip = h('div', { class: 'chart-tip', hidden: true });
  wrap.append(tip);
  const { left, top, innerW, innerH, band } = geometry;
  series.forEach((day, i) => {
    const hit = svg('rect', {
      x: left + i * band, y: top, width: band, height: innerH,
      fill: 'transparent', tabindex: '0', role: 'img', 'aria-label': describe(day).join('. '),
    });
    const show = () => {
      tip.replaceChildren(...describe(day).map((line, n) => h('div', { class: n === 0 ? 'chart-tip-head' : '' }, line)));
      tip.hidden = false;
      const x = left + i * band + band / 2;
      tip.style.left = `${Math.min(Math.max(x, 70), left + innerW - 60)}px`;
      highlight(i, true);
    };
    const hide = () => {
      tip.hidden = true;
      highlight(i, false);
    };
    hit.addEventListener('pointerenter', show);
    hit.addEventListener('pointerleave', hide);
    hit.addEventListener('focus', show);
    hit.addEventListener('blur', hide);
    plot.append(hit);
  });
}

/** Chart 1: minutes per day, chad up and chud down from a shared zero line. */
function minutesChart(series, width) {
  const height = 240;
  const left = 44, right = 20, top = 12, bottom = 28;
  const innerW = width - left - right;
  const innerH = height - top - bottom;
  const maxChad = Math.max(...series.map((d) => d.chad), 0);
  const maxChud = Math.max(...series.map((d) => d.chud), 0);
  const step = niceStep(Math.max(maxChad + maxChud, 30), 5, [5, 10, 15, 30, 60, 120, 180, 240, 360, 480, 720, 1440]);
  const up = Math.max(step, Math.ceil(maxChad / step) * step);
  const down = Math.max(step, Math.ceil(maxChud / step) * step);
  const scale = innerH / (up + down);
  const zero = top + up * scale;
  const band = innerW / series.length;
  const barW = Math.max(2, Math.floor(band) - 2);

  const plot = svg('svg', { width, height, viewBox: `0 0 ${width} ${height}`, role: 'group', 'aria-label': 'Minutes per day, chad above the line and chud below' });
  for (let v = -down; v <= up; v += step) {
    const y = Math.round(zero - v * scale);
    plot.append(
      svg('line', { x1: left, x2: left + innerW, y1: y, y2: y, stroke: v === 0 ? COLOR.ink : COLOR.grid, 'stroke-width': v === 0 ? 2 : 1 }),
      svg('text', { x: left - 6, y: y + 3, 'text-anchor': 'end', class: 'axis' }, axisMinutes(Math.abs(v))));
  }
  const labelEvery = Math.ceil(series.length / Math.max(2, Math.floor(innerW / 64)));
  const bars = [];
  series.forEach((day, i) => {
    const x = Math.round(left + i * band + (band - barW) / 2);
    const group = svg('g', {});
    if (day.chad > 0) {
      const hgt = Math.max(2, Math.round(day.chad * scale));
      group.append(svg('rect', { x, y: zero - 1 - hgt, width: barW, height: hgt, fill: COLOR.chad }));
    }
    if (day.chud > 0) {
      const hgt = Math.max(2, Math.round(day.chud * scale));
      group.append(svg('rect', { x, y: zero + 1, width: barW, height: hgt, fill: COLOR.chud }));
    }
    bars.push(group);
    plot.append(group);
    if ((series.length - 1 - i) % labelEvery === 0) {
      plot.append(svg('text', { x: left + i * band + band / 2, y: height - 8, 'text-anchor': 'middle', class: 'axis' }, dayLabel(day)));
    }
  });

  const wrap = h('div', { class: 'chart' }, plot);
  addHover(wrap, plot, series, { left, top, innerW, innerH, band },
    (day) => [dayLabel(day), `CHAD ${fmtMinutes(day.chad)}`, `CHUD ${fmtMinutes(day.chud)}`],
    (i, on) => bars.forEach((bar, n) => bar.setAttribute('opacity', on && n !== i ? '0.35' : '1')));
  return wrap;
}

/** Chart 2: closing net score per day, drawn as a stepped line. */
function netChart(series, width) {
  const height = 200;
  const left = 56, right = 20, top = 12, bottom = 28;
  const innerW = width - left - right;
  const innerH = height - top - bottom;
  const values = series.map((d) => d.net);
  let lo = Math.min(0, ...values);
  let hi = Math.max(0, ...values);
  const step = niceStep(Math.max(hi - lo, 10), 4);
  lo = Math.floor(lo / step) * step;
  hi = Math.max(lo + step, Math.ceil(hi / step) * step);
  const y = (v) => Math.round(top + ((hi - v) / (hi - lo)) * innerH);
  const band = innerW / series.length;

  const plot = svg('svg', { width, height, viewBox: `0 0 ${width} ${height}`, role: 'group', 'aria-label': 'Net score at the end of each day' });
  for (let v = lo; v <= hi; v += step) {
    plot.append(
      svg('line', { x1: left, x2: left + innerW, y1: y(v), y2: y(v), stroke: v === 0 ? COLOR.ink : COLOR.grid, 'stroke-width': v === 0 ? 2 : 1 }),
      svg('text', { x: left - 6, y: y(v) + 3, 'text-anchor': 'end', class: 'axis' }, fmtNumber(v)));
  }
  let path = '';
  series.forEach((day, i) => {
    const x0 = Math.round(left + i * band);
    const x1 = Math.round(left + (i + 1) * band);
    path += `${i === 0 ? 'M' : 'L'}${x0} ${y(day.net)} L${x1} ${y(day.net)} `;
  });
  plot.append(svg('path', { d: path, fill: 'none', stroke: COLOR.chad, 'stroke-width': 3, 'stroke-linejoin': 'miter' }));

  const labelEvery = Math.ceil(series.length / Math.max(2, Math.floor(innerW / 64)));
  series.forEach((day, i) => {
    if ((series.length - 1 - i) % labelEvery === 0) {
      plot.append(svg('text', { x: left + i * band + band / 2, y: height - 8, 'text-anchor': 'middle', class: 'axis' }, dayLabel(day)));
    }
  });
  const cursor = svg('rect', { x: 0, y: top, width: 2, height: innerH, fill: COLOR.ink, visibility: 'hidden' });
  const dot = svg('rect', { x: 0, y: 0, width: 10, height: 10, fill: COLOR.chad, stroke: '#fffaf0', 'stroke-width': 2, visibility: 'hidden' });
  plot.append(cursor, dot);

  const wrap = h('div', { class: 'chart' }, plot);
  addHover(wrap, plot, series, { left, top, innerW, innerH, band },
    (day) => [dayLabel(day), `NET ${fmtNumber(day.net)}`],
    (i, on) => {
      const x = Math.round(left + i * band + band / 2);
      cursor.setAttribute('x', x - 1);
      dot.setAttribute('x', x - 5);
      dot.setAttribute('y', y(series[i].net) - 5);
      cursor.setAttribute('visibility', on ? 'visible' : 'hidden');
      dot.setAttribute('visibility', on ? 'visible' : 'hidden');
    });
  return wrap;
}

function tile(label, value, sub) {
  return h('div', { class: 'tile' },
    h('div', { class: 'label muted' }, label),
    h('div', { class: 'tile-value' }, value),
    sub ? h('div', { class: 'label muted' }, sub) : null);
}

function totalTime(minutes) {
  const whole = Math.round(minutes);
  return `${fmtNumber(Math.floor(whole / 60))}h ${String(whole % 60).padStart(2, '0')}m`;
}

export function render(ctx, root) {
  const { state } = ctx;
  const chad = state.sessions.filter((s) => s.kind === 'chad');
  const chud = state.sessions.filter((s) => s.kind === 'chud');
  const sum = (list, f) => list.reduce((total, s) => total + f(s), 0);
  const chadMin = sum(chad, (s) => s.activeMinutes);
  const chudMin = sum(chud, (s) => s.activeMinutes);
  const average = (list) => (list.length ? (sum(list, (s) => s.stars) / list.length).toFixed(1) : '-');
  const share = chadMin + chudMin > 0 ? `${Math.round((chadMin / (chadMin + chudMin)) * 100)}%` : '-';
  const copies = collection(state);

  const charts = h('div', { class: 'stack' });
  const rangeButtons = RANGES.map((days) =>
    h('button', {
      class: `btn btn-small${range === days ? ' selected' : ''}`,
      type: 'button',
      'aria-pressed': String(range === days),
      onclick: () => {
        range = days;
        ctx.sfx.play('click');
        ctx.render();
      },
    }, `${days} DAYS`));

  function draw() {
    const series = dailySeries(state.sessions, range);
    // The chart sits inside a .box.pad: 4px margin + 16px padding on each side.
    const width = Math.max(240, Math.floor(charts.clientWidth) - 40);
    const active = series.filter((d) => d.sessions > 0);
    charts.replaceChildren(
      h('section', { class: 'box pad stack' },
        h('h2', {}, 'MINUTES PER DAY'),
        h('div', { class: 'legend' },
          h('span', {}, h('i', { style: { background: COLOR.chad } }), 'CHAD'),
          h('span', {}, h('i', { style: { background: COLOR.chud } }), 'CHUD')),
        minutesChart(series, width)),
      h('section', { class: 'box pad stack' },
        h('h2', {}, 'NET SCORE BY DAY'),
        netChart(series, width)),
      h('details', { class: 'box pad' },
        h('summary', {}, 'TABLE VIEW'),
        active.length === 0
          ? h('p', { class: 'muted' }, 'NO SESSIONS IN THIS RANGE.')
          : h('div', { class: 'table-scroll' },
              h('table', { class: 'table' },
                h('thead', {}, h('tr', {},
                  h('th', {}, 'DAY'), h('th', {}, 'CHAD'), h('th', {}, 'CHUD'), h('th', {}, 'NET'))),
                h('tbody', {}, active.slice().reverse().map((d) =>
                  h('tr', {},
                    h('td', {}, dayLabel(d)),
                    h('td', {}, fmtMinutes(d.chad)),
                    h('td', {}, fmtMinutes(d.chud)),
                    h('td', {}, fmtNumber(d.net)))))))),
    );
  }

  root.append(
    h('div', { class: 'page-head' },
      h('a', { class: 'btn btn-small', href: '#/' }, '◀ BACK'),
      h('h1', {}, 'STATS')),
    h('section', { class: 'box pad stack', 'aria-label': 'All-time totals' },
      h('h2', {}, 'ALL TIME'),
      h('div', { class: 'tiles' },
        tile('CHAD TIME', totalTime(chadMin), `${chad.length} SESSIONS`),
        tile('CHUD TIME', totalTime(chudMin), `${chud.length} SESSIONS`),
        tile('CHAD SHARE', share, 'OF ALL RECORDED TIME'),
        tile('AVG CHAD STARS', average(chad), 'OUT OF 4'),
        tile('AVG CHUD STARS', average(chud), 'OUT OF 4'),
        tile('POKéMON', fmtNumber(copies.length), `${copies.filter((r) => r.shiny).length} SHINY`))),
    h('div', { class: 'filters' }, h('div', { class: 'row wrap' }, rangeButtons)),
    charts,
  );
  draw();

  if (!resizeBound) {
    resizeBound = true;
    let timer = 0;
    window.addEventListener('resize', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (document.body.dataset.view === 'stats') ctx.render();
      }, 200);
    });
  }
}
