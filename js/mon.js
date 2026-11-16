/**
 * Turning a reference to a Pokémon into something that can be drawn.
 *
 * Three kinds of thing can be shown: a species in its ordinary form, a
 * species in one of its alternate forms, and a fusion. Rewards, bought
 * copies and the buddy all refer to them the same way:
 *
 *   { dexId: 37 }                  Vulpix
 *   { dexId: 37, form: 'alola' }   Alolan Vulpix
 *   { fusion: 643646000 }          White Kyurem
 *
 * resolveMon() returns an object the sprite() helper in dom.js accepts
 * (`id` is the sprite's file number, `shiny` says whether shiny art exists).
 */

import { BASE, findForm, displayName } from './forms.js';
import { activeFusions, unlockedForms, hasShiny } from './shop.js';

/**
 * @param {{dex: object, forms: object}} ctx
 * @param {{dexId?: number, form?: string, fusion?: number}|null} ref
 * @returns {{id:number, name:string, shiny:boolean, label:string,
 *            species:object|null, form:object|null, fusion:object|null}|null}
 */
export function resolveMon(ctx, ref) {
  if (!ref) return null;
  if (ref.fusion) {
    const fusion = ctx.forms.fusionById.get(ref.fusion);
    if (!fusion) return null;
    return {
      id: fusion.pid,
      name: fusion.label,
      shiny: fusion.shiny !== false,
      label: 'Fused',
      species: null,
      form: null,
      fusion,
    };
  }
  const species = ctx.dex.byId.get(ref.dexId);
  if (!species) return null;
  const form = findForm(ctx.forms, species.id, ref.form);
  // A form whose artwork is not published yet falls back to the plain sprite.
  if (form && form.sprite !== false) {
    return {
      id: form.pid,
      name: displayName(species.name, form),
      shiny: form.shiny !== false,
      label: form.label,
      species,
      form,
      fusion: null,
    };
  }
  return { id: species.id, name: species.name, shiny: species.shiny !== false, label: 'Base', species, form: null, fusion: null };
}

/**
 * The buddy as it should be shown now, or null when there is none.
 *
 * A save can point at something that no longer holds (a hand-edited file, or
 * a form that was never unlocked). Rather than break, a form the player does
 * not have falls back to the plain Pokémon, and a fusion that does not exist
 * gives no buddy.
 *
 * @returns {{mon: object, shiny: boolean}|null}
 */
export function currentBuddy(ctx) {
  const buddy = ctx.state.buddy;
  if (!buddy) return null;
  if (buddy.fusion) {
    if (!activeFusions(ctx.state).has(buddy.fusion)) return null;
    const mon = resolveMon(ctx, { fusion: buddy.fusion });
    if (!mon) return null;
    const shiny = Boolean(buddy.shiny) && hasShiny(ctx.state, mon.fusion.base) && hasShiny(ctx.state, mon.fusion.partner);
    return { mon, shiny };
  }
  const unlocked = unlockedForms(ctx.state, ctx.forms, buddy.dexId);
  const form = buddy.form && unlocked.has(buddy.form) ? buddy.form : BASE;
  const mon = resolveMon(ctx, { dexId: buddy.dexId, form });
  if (!mon) return null;
  return { mon, shiny: Boolean(buddy.shiny) };
}
