/**
 * Alternate forms: Megas, Gigantamax, regional forms, fusions and so on.
 * Pure functions over data/forms.json, no DOM and no storage.
 * Documented in documentation/shop.md.
 *
 * data/forms.json is written by tools/update_pokedex.py. Each entry in
 * `forms` belongs to one species and has a `kind`:
 *
 *   variant    a free alternate form (Alolan, Origin, Heat Rotom ...).
 *              Unlocked by getting more copies of the species.
 *   upgrade    bought with Pokécoins (Mega, Gigantamax, Primal ...).
 *   milestone  unlocked by a copy count (Zygarde's 10% and Complete).
 *
 * `fusions` are separate: each joins two species into a new entry.
 *
 * A form is referred to by its `key`, unique within its species ("mega-x",
 * "alola", "galar-zen"). The plain form of a species has the key "base".
 */

/** Key of a species' ordinary form. A copy with no `form` is this. */
export const BASE = 'base';

/**
 * Build the lookups used everywhere else.
 * @param {{forms?: Array, fusions?: Array}} data Contents of data/forms.json.
 */
export function indexForms(data) {
  const bySpecies = new Map();
  for (const form of (data && data.forms) || []) {
    if (!bySpecies.has(form.species)) bySpecies.set(form.species, []);
    bySpecies.get(form.species).push(form);
  }
  const fusions = ((data && data.fusions) || []).slice();
  return {
    bySpecies,
    fusions,
    fusionById: new Map(fusions.map((f) => [f.id, f])),
  };
}

/** An index with no forms at all, for code and tests that do not need any. */
export const NO_FORMS = indexForms({ forms: [], fusions: [] });

/** Every extra form of a species, in the order PokeAPI lists them. */
export function formsOf(index, speciesId) {
  return (index || NO_FORMS).bySpecies.get(speciesId) || [];
}

/**
 * The free alternate forms of a species that can actually be shown
 * (a form whose sprite has not been published yet is skipped).
 */
export function variantsOf(index, speciesId) {
  return formsOf(index, speciesId).filter((f) => f.kind === 'variant' && f.sprite !== false);
}

/** One form of a species by key, or null. "base" has no entry and gives null. */
export function findForm(index, speciesId, key) {
  if (!key || key === BASE) return null;
  return formsOf(index, speciesId).find((f) => f.key === key) || null;
}

/** Short label for a form: "Base", "Mega X", "Alolan". */
export function formLabel(index, speciesId, key) {
  const form = findForm(index, speciesId, key);
  return form ? form.label : 'Base';
}

/**
 * Full name of a Pokémon in a form.
 *   ("Charizard", Mega X)       -> "Mega Charizard X"
 *   ("Tatsugiri", Droopy Mega)  -> "Droopy Mega Tatsugiri"
 *   ("Vulpix", Alolan)          -> "Alolan Vulpix"
 *   ("Vulpix", null)            -> "Vulpix"
 *
 * @param {string} speciesName
 * @param {{label:string}|null} form
 */
export function displayName(speciesName, form) {
  if (!form) return speciesName;
  const mega = /^(.*?)\s*Mega(?:\s+([A-Z]))?$/.exec(form.label);
  if (mega) {
    const [, prefix, suffix] = mega;
    return `${prefix ? `${prefix} ` : ''}Mega ${speciesName}${suffix ? ` ${suffix}` : ''}`;
  }
  return `${form.label} ${speciesName}`;
}

/**
 * Which form a new copy of a species arrives in.
 *
 *   - The first copy is always Base.
 *   - After that, each copy is the next alternate form not yet held, in
 *     Pokédex order, so no form repeats while another is still missing.
 *   - Once every form is held, the copy is random: Base or any alternate
 *     form, each equally likely.
 *
 * The same rule serves rolled copies and bought copies.
 *
 * @param {object} index            From indexForms().
 * @param {number} speciesId
 * @param {string[]} heldForms      Form key of every copy already held ("base" included).
 * @param {() => number} rng        Float in [0, 1). Only called once all forms are held.
 * @returns {string} A form key.
 */
export function nextForm(index, speciesId, heldForms, rng) {
  if (heldForms.length === 0) return BASE;
  const variants = variantsOf(index, speciesId);
  if (variants.length === 0) return BASE;
  const held = new Set(heldForms);
  const missing = variants.find((v) => !held.has(v.key));
  if (missing) return missing.key;
  const all = [BASE, ...variants.map((v) => v.key)];
  return all[Math.min(all.length - 1, Math.floor(rng() * all.length))];
}
