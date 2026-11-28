// Pattern train's pieces: what a carriage can carry, and the words for it (🔊 and screen readers).

/** @typedef {'circle' | 'square' | 'triangle' | 'star' | 'heart' | 'cube' | 'ball' | 'cone' | 'cylinder'} Shape */
/** @typedef {'orange' | 'blue' | 'yellow' | 'green' | 'pink'} Colour */
/** @typedef {'big' | 'small'} Size */
/** @typedef {0 | 90 | 180 | 270} Turn */
/** @typedef {'shape' | 'colour' | 'size' | 'turn'} Attr */

/**
 * What one carriage carries.
 * @typedef {object} Car
 * @property {Shape} shape
 * @property {Colour} colour
 * @property {Size} size
 * @property {Turn} turn  Degrees clockwise. Only triangle and heart are ever turned (a turn shows on them).
 */

/**
 * @typedef {object} Puzzle
 * @property {(Car | null)[]} cars  The train, front first. `null` is the empty carriage.
 * @property {number} gap  Where the empty carriage is.
 * @property {Car[]} choices  What she can tap. Exactly one fits (the solver proves it).
 * @property {number} answer  Index of the choice that fits.
 * @property {Attr[]} changes  What changes along the train (for the hint).
 */

/** @type {readonly Attr[]} */
export const ATTRS = ['shape', 'colour', 'size', 'turn'];

/** @type {readonly Shape[]} */
export const FLAT = ['circle', 'square', 'triangle', 'star', 'heart'];
/** @type {readonly Shape[]} */
export const SOLIDS = ['cube', 'ball', 'cone', 'cylinder'];
/** Shapes where a turn can be seen. @type {readonly Shape[]} */
export const TURNABLE = ['triangle', 'heart'];
/** @type {readonly Colour[]} */
export const COLOURS = ['orange', 'blue', 'yellow', 'green', 'pink'];
/** @type {readonly Size[]} */
export const SIZES = ['big', 'small'];
/** @type {readonly Turn[]} */
export const TURNS = [0, 90, 180, 270];

/**
 * Colour-blind-friendly (the Okabe–Ito set): orange and green differ in lightness too, so a child with red-green
 * colour blindness can still tell them apart. #d55e00 is a red-orange, so it's called orange.
 * @type {Record<Colour, string>}
 */
export const PAINT = {
  orange: '#d55e00',
  blue: '#0072b2',
  yellow: '#f0e442',
  green: '#009e73',
  pink: '#cc79a7',
};

/** @type {Record<Turn, string>} where the tip of a triangle (or the point of a heart) is, as words */
const POINTING = { 0: 'up', 90: 'right', 180: 'down', 270: 'left' };

/** @type {Record<Shape, string>} */
const SHAPE_WORDS = {
  circle: 'circle',
  square: 'square',
  triangle: 'triangle',
  star: 'star',
  heart: 'heart',
  cube: 'cube',
  ball: 'ball',
  cone: 'cone',
  cylinder: 'tube',
};

/**
 * Short words for a carriage, e.g. "small orange circle" or "blue triangle pointing down".
 * @param {Car} car
 * @param {boolean} [turns]  Say which way it points (on levels where shapes turn).
 * @returns {string}
 */
export function describe(car, turns = false) {
  const size = car.size === 'small' ? 'small ' : '';
  // A heart's point is at the bottom when it isn't turned, so its words follow the point.
  const tip = car.shape === 'heart' ? ((car.turn + 180) % 360) : car.turn;
  const way = turns && TURNABLE.includes(car.shape) ? ` pointing ${POINTING[/** @type {Turn} */ (tip)]}` : '';
  return `${size}${car.colour} ${SHAPE_WORDS[car.shape]}${way}`;
}

/**
 * @param {Car} a
 * @param {Car} b
 * @returns {boolean}
 */
export function sameCar(a, b) {
  return ATTRS.every((k) => a[k] === b[k]);
}

/**
 * Is this a well-formed carriage? (Used to check saved data and puzzles.)
 * @param {unknown} x
 * @returns {x is Car}
 */
export function isCar(x) {
  if (!x || typeof x !== 'object') return false;
  const c = /** @type {Record<string, unknown>} */ (x);
  return (
    [...FLAT, ...SOLIDS].includes(/** @type {Shape} */ (c.shape)) &&
    COLOURS.includes(/** @type {Colour} */ (c.colour)) &&
    SIZES.includes(/** @type {Size} */ (c.size)) &&
    TURNS.includes(/** @type {Turn} */ (c.turn))
  );
}
