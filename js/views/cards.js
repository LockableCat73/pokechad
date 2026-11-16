/**
 * Pieces shared by the Pokédex and the Shop: the fusion card and the small
 * "price or reason" line used wherever something can be bought.
 */

import { h, sprite } from '../dom.js';
import { coins } from '../pixelart.js';
import { resolveMon } from '../mon.js';
import { fusionOffer, unfuseOffer, FUSION_SPARE_NEEDED } from '../shop.js';

/**
 * A button that buys something, or the reason it cannot be bought.
 *
 * @param {object} args
 * @param {string} args.label     e.g. "BUY", "UNLOCK", "FUSE".
 * @param {{ok:boolean, price:number, reason:string}} args.offer
 * @param {() => void} args.onBuy
 * @param {string} [args.kind]    Extra button class.
 */
export function buyButton({ label, offer, onBuy, kind = 'btn-primary' }) {
  if (offer.ok) {
    return h('button', { class: `btn btn-small ${kind}`, type: 'button', onclick: onBuy }, label, coins(offer.price));
  }
  // Still show the price when coins are the only thing missing.
  return h('span', { class: 'cannot' },
    h('span', { class: 'label muted' }, offer.reason),
    offer.reason === 'NOT ENOUGH COINS' ? coins(offer.price) : null);
}

/**
 * One fusion: what it is made from, where it stands, and what can be done.
 * Before it is made it shows as a named silhouette with the two Pokémon it
 * needs and how many spare copies of each are held. Once made it can be viewed in
 * shiny (when both Pokémon have theirs), set as the buddy, or undone.
 */
export function fusionCard(ctx, fusion) {
  const { state } = ctx;
  const offer = fusionOffer(state, ctx.forms, fusion);
  const mon = resolveMon(ctx, { fusion: fusion.id });
  const base = ctx.dex.byId.get(fusion.base);
  const partner = ctx.dex.byId.get(fusion.partner);
  const isBuddy = Boolean(state.buddy && state.buddy.fusion === fusion.id);
  let showShiny = offer.active && offer.shiny && isBuddy ? Boolean(state.buddy.shiny) : false;

  const art = h('div', { class: 'fusion-art' });
  const actions = h('div', { class: 'fusion-actions' });
  const need = (species, spare) =>
    h('div', { class: `label ${spare >= FUSION_SPARE_NEEDED ? '' : 'muted'}` },
      `${species.name}: ${Math.max(0, spare)} SPARE`);

  function paint() {
    art.replaceChildren(sprite(mon, { shiny: showShiny, silhouette: !offer.active, eager: true }));
    if (!offer.active) {
      actions.replaceChildren(
        need(base, offer.spare.base),
        need(partner, offer.spare.partner),
        buyButton({ label: 'FUSE', offer, onBuy: () => ctx.fuseFusion(fusion) }),
      );
      return;
    }
    const undo = unfuseOffer(state, fusion);
    const nowBuddy = Boolean(state.buddy && state.buddy.fusion === fusion.id && Boolean(state.buddy.shiny) === showShiny);
    const parts = [
      offer.shiny
        ? h('button', {
            class: 'btn btn-small',
            type: 'button',
            onclick: () => {
              showShiny = !showShiny;
              paint();
            },
          }, showShiny ? 'SHOW NORMAL' : 'SHOW SHINY')
        : null,
      h('button', {
        class: 'btn btn-small btn-primary',
        type: 'button',
        disabled: nowBuddy,
        onclick: () => {
          ctx.setBuddy({ fusion: fusion.id, shiny: showShiny });
          ctx.render();
        },
      }, nowBuddy ? 'YOUR BUDDY' : 'SET AS BUDDY'),
      undo.ok
        ? h('button', { class: 'btn btn-small', type: 'button', onclick: () => ctx.unfuseFusion(fusion) }, 'UNFUSE')
        : h('span', { class: 'label muted' }, undo.reason),
    ];
    actions.replaceChildren(...parts.filter(Boolean));
  }
  paint();

  return h('div', { class: `box fusion${offer.active ? ' owned' : ''}` },
    art,
    h('div', { class: 'fusion-name' }, fusion.label),
    h('div', { class: 'label muted' }, `${base.name} + ${partner.name}`),
    actions);
}
