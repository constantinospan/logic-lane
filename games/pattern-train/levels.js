// Pattern train's ladder (D14, D28): what each level asks for. The generator builds puzzles to these rules and the unit
// tests check every puzzle stays inside them (D12).
//
// The plan's order (docs/PLAN.md, "Game ideas"): colour (AB), size, turned shapes, ABB and ABC, a gap in the middle,
// 3D shapes, then two things changing at once. About 4 levels each; the train gets a little longer as she climbs.

/** @typedef {import('./model.js').Attr} Attr */
/** @typedef {'AB' | 'AAB' | 'ABB' | 'ABC'} Unit */
/** @typedef {'end' | 'middle' | 'any'} GapRule */

/**
 * @typedef {object} Rules
 * @property {Attr[][]} change  The ways the train can change: one is picked per puzzle (e.g. colour, or shape).
 *   Two attributes in one entry change together.
 * @property {Unit[]} units  The repeating units to pick from.
 * @property {boolean} [split]  Two attributes, each with its own unit (one AB, one ABC), instead of the same one.
 * @property {[number, number]} length  Carriages, the empty one included: [min, max]. At most 8 (one row on a phone).
 * @property {GapRule} gap  end: what comes next. middle: a gap inside the train (not the first or last). any: either.
 * @property {3 | 4} choices
 * @property {boolean} [solids]  Solid shapes (cube, ball, cone, tube) instead of flat ones.
 * @property {number} [gapFrom]  The empty carriage is never before this place (0 = the first carriage).
 * @property {boolean} [shift]  The train may start part-way into its unit (B A A B A A …). Off on early levels, so
 *   the unit starts at the front where she can see it.
 */

/** @type {Rules[]} index 0 = level 1 */
export const LEVELS = [
  // Colour, AB: orange blue orange blue …
  { change: [['colour']], units: ['AB'], length: [5, 5], gap: 'end', choices: 3 },
  { change: [['colour']], units: ['AB'], length: [5, 5], gap: 'end', choices: 3 },
  { change: [['colour']], units: ['AB'], length: [6, 6], gap: 'end', choices: 3 },
  { change: [['colour']], units: ['AB'], length: [6, 6], gap: 'end', choices: 3 },
  // Size, AB: big small big small …
  { change: [['size']], units: ['AB'], length: [5, 5], gap: 'end', choices: 3 },
  { change: [['size']], units: ['AB'], length: [5, 5], gap: 'end', choices: 3 },
  { change: [['size']], units: ['AB'], length: [6, 6], gap: 'end', choices: 3 },
  { change: [['size']], units: ['AB'], length: [6, 6], gap: 'end', choices: 3 },
  // Turned shapes: up down up down …, then three ways.
  { change: [['turn']], units: ['AB'], length: [5, 5], gap: 'end', choices: 3 },
  { change: [['turn']], units: ['AB'], length: [6, 6], gap: 'end', choices: 3 },
  { change: [['turn']], units: ['AB', 'ABC'], length: [6, 7], gap: 'end', choices: 3 },
  { change: [['turn']], units: ['ABC'], length: [7, 7], gap: 'end', choices: 3 },
  // ABB and ABC, in colour or shape.
  { change: [['colour'], ['shape']], units: ['AAB', 'ABB'], length: [7, 7], gap: 'end', choices: 3 },
  { change: [['colour'], ['shape']], units: ['AAB', 'ABB'], length: [7, 7], gap: 'end', choices: 3 },
  { change: [['colour'], ['shape']], units: ['ABC'], length: [7, 7], gap: 'end', choices: 3 },
  { change: [['colour'], ['shape']], units: ['ABC'], length: [7, 8], gap: 'end', choices: 3 },
  // A gap in the middle.
  { change: [['colour'], ['shape'], ['size']], units: ['AB'], length: [7, 7], gap: 'middle', choices: 3, shift: true },
  { change: [['colour'], ['shape'], ['size']], units: ['AAB', 'ABB'], length: [7, 7], gap: 'middle', choices: 3,
    shift: true },
  { change: [['colour'], ['shape']], units: ['ABC'], length: [7, 7], gap: 'middle', choices: 3, shift: true },
  { change: [['colour'], ['shape'], ['size']], units: ['AB', 'AAB', 'ABB', 'ABC'], length: [8, 8], gap: 'middle',
    choices: 3, shift: true },
  // 3D shapes.
  { change: [['shape']], units: ['AB'], length: [6, 6], gap: 'end', choices: 3, solids: true, shift: true },
  { change: [['shape']], units: ['AAB', 'ABB'], length: [7, 7], gap: 'end', choices: 3, solids: true, shift: true },
  { change: [['shape']], units: ['ABC'], length: [7, 7], gap: 'any', choices: 4, solids: true, shift: true },
  { change: [['shape']], units: ['AB', 'AAB', 'ABB', 'ABC'], length: [8, 8], gap: 'any', choices: 4, solids: true,
    shift: true },
  // Two things changing at once: together first, then each with its own pattern.
  { change: [['colour', 'shape'], ['colour', 'size'], ['shape', 'size']], units: ['AB'], length: [7, 7], gap: 'any',
    choices: 4, shift: true },
  { change: [['colour', 'shape'], ['colour', 'size'], ['shape', 'size']], units: ['AB', 'AAB', 'ABB'],
    length: [7, 7], gap: 'any', choices: 4, shift: true },
  { change: [['colour', 'shape']], units: ['ABC'], length: [7, 7], gap: 'any', choices: 4, shift: true },
  { change: [['colour', 'shape'], ['colour', 'size'], ['shape', 'size']], units: ['AAB', 'ABB', 'ABC'],
    length: [8, 8], gap: 'any', choices: 4, shift: true },
  { change: [['colour', 'shape'], ['size', 'shape'], ['size', 'colour']], units: ['AB', 'ABC'], split: true,
    length: [8, 8], gap: 'any', gapFrom: 2, choices: 4, shift: true },
  { change: [['colour', 'shape'], ['size', 'shape'], ['size', 'colour']], units: ['AB', 'ABC'], split: true,
    length: [8, 8], gap: 'any', gapFrom: 2, choices: 4, shift: true },
];

/** What 🔊 reads: the empty carriage at the end, or anywhere else. */
export const ASK = { next: 'What comes next? Tap it.', missing: 'What is missing? Tap it.' };

/** Most carriages in one train: one row on a 360 px phone. */
export const MAX_LENGTH = 8;

/**
 * The rules for a level. Above the top level, puzzles keep level 30's rules (endless, D14).
 * @param {number} level
 * @returns {Rules}
 */
export function rulesFor(level) {
  const i = Math.min(Math.max(1, Math.floor(level)), LEVELS.length) - 1;
  return LEVELS[i];
}

/**
 * How many carriages make one repeat of a unit.
 * @param {Unit} unit
 * @returns {number}
 */
export function period(unit) {
  return unit.length;
}

/**
 * How many different values a unit needs (AB: 2, AAB: 2, ABC: 3).
 * @param {Unit} unit
 * @returns {number}
 */
export function letters(unit) {
  return new Set(unit).size;
}
