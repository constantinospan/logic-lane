// Pattern train's pictures, drawn as SVG (no image files). Every string here is fixed or built from the puzzle's own
// values (shape names, colours from PAINT, numbers), never from text a person typed.

import { PAINT } from './model.js';

/** @typedef {import('./model.js').Car} Car */
/** @typedef {import('./model.js').Shape} Shape */

const INK = '#1f2933';
const LINE = `stroke="${INK}" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"`;
const LIGHT = 'fill="#ffffff" fill-opacity="0.4"';
const DARK = `fill="${INK}" fill-opacity="0.25"`;

/** Five-point star around (50, 52). */
const STAR = (() => {
  /** @type {string[]} */
  const points = [];
  for (let k = 0; k < 10; k++) {
    const r = k % 2 === 0 ? 42 : 18;
    const a = (Math.PI / 5) * k - Math.PI / 2;
    points.push(`${(50 + r * Math.cos(a)).toFixed(1)},${(54 + r * Math.sin(a)).toFixed(1)}`);
  }
  return points.join(' ');
})();

/**
 * The shape itself, in a 100 × 100 box. 3D shapes get a light top and a dark side.
 * @param {Shape} shape
 * @param {string} paint
 * @returns {string}
 */
function body(shape, paint) {
  const fill = `fill="${paint}"`;
  switch (shape) {
    case 'circle':
      return `<circle cx="50" cy="50" r="38" ${fill} ${LINE}/>`;
    case 'square':
      return `<rect x="14" y="14" width="72" height="72" rx="8" ${fill} ${LINE}/>`;
    case 'triangle':
      return `<path d="M50 10 L90 84 L10 84 Z" ${fill} ${LINE}/>`;
    case 'star':
      return `<polygon points="${STAR}" ${fill} ${LINE}/>`;
    case 'heart':
      return `<path d="M50 88 C20 66 8 50 8 34 C8 20 19 12 30 12 C40 12 47 18 50 26 C53 18 60 12 70 12 ` +
        `C81 12 92 20 92 34 C92 50 80 66 50 88 Z" ${fill} ${LINE}/>`;
    case 'cube':
      return `<path d="M12 34 L34 14 L88 14 L88 66 L66 86 L12 86 Z" ${fill}/>` +
        `<path d="M12 34 L34 14 L88 14 L66 34 Z" ${LIGHT}/>` +
        `<path d="M66 34 L88 14 L88 66 L66 86 Z" ${DARK}/>` +
        `<path d="M12 34 L34 14 L88 14 L88 66 L66 86 L12 86 Z M12 34 L66 34 L88 14 M66 34 L66 86" ` +
        `fill="none" ${LINE}/>`;
    case 'ball':
      return `<circle cx="50" cy="50" r="38" ${fill}/>` +
        `<path d="M88 50 A38 38 0 0 1 12 50 A38 26 0 0 0 88 50 Z" ${DARK}/>` +
        `<ellipse cx="36" cy="34" rx="12" ry="8" ${LIGHT}/>` +
        `<circle cx="50" cy="50" r="38" fill="none" ${LINE}/>`;
    case 'cone':
      return `<path d="M50 10 L84 78 A34 10 0 0 1 16 78 Z" ${fill}/>` +
        `<path d="M50 10 L84 78 A34 10 0 0 1 50 88 Z" ${DARK}/>` +
        `<path d="M50 10 L84 78 A34 10 0 0 1 16 78 Z" fill="none" ${LINE}/>`;
    case 'cylinder':
      return `<path d="M18 24 L18 76 A32 10 0 0 0 82 76 L82 24 Z" ${fill}/>` +
        `<path d="M64 33 L64 85 A32 10 0 0 0 82 76 L82 24 A32 10 0 0 1 64 33 Z" ${DARK}/>` +
        `<ellipse cx="50" cy="24" rx="32" ry="10" ${fill}/>` +
        `<ellipse cx="50" cy="24" rx="32" ry="10" ${LIGHT}/>` +
        `<path d="M18 24 L18 76 A32 10 0 0 0 82 76 L82 24" fill="none" ${LINE}/>` +
        `<ellipse cx="50" cy="24" rx="32" ry="10" fill="none" ${LINE}/>`;
  }
}

/**
 * One carriage's load as an SVG string: its shape, colour, size and turn.
 * @param {Car} car
 * @returns {string}
 */
export function loadSvg(car) {
  const scale = car.size === 'small' ? 0.55 : 1;
  const transform = `translate(50 50) rotate(${car.turn}) scale(${scale}) translate(-50 -50)`;
  return `<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false"><g transform="${transform}">` +
    `${body(car.shape, PAINT[car.colour])}</g></svg>`;
}

/** The engine at the front, facing left (the train goes left, so the next carriage joins at the right end). */
export const ENGINE_SVG =
  '<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">' +
  '<rect x="58" y="22" width="34" height="50" rx="6" fill="#2a9d8f" stroke="#1f2933" stroke-width="4"/>' +
  '<rect x="66" y="30" width="18" height="16" rx="3" fill="#fdf6ec" stroke="#1f2933" stroke-width="3"/>' +
  '<path d="M10 72 L10 50 Q10 40 20 40 L60 40 L60 72 Z" fill="#2a9d8f" stroke="#1f2933" stroke-width="4"/>' +
  '<rect x="22" y="22" width="12" height="20" rx="2" fill="#1f2933"/>' +
  '<rect x="52" y="16" width="44" height="8" rx="3" fill="#ef476f" stroke="#1f2933" stroke-width="3"/>' +
  '<path d="M4 72 L10 60 L10 72 Z" fill="#ffd166" stroke="#1f2933" stroke-width="3"/>' +
  '<circle cx="26" cy="80" r="10" fill="#1f2933"/><circle cx="72" cy="80" r="12" fill="#1f2933"/>' +
  '<circle cx="26" cy="80" r="4" fill="#fdf6ec"/><circle cx="72" cy="80" r="5" fill="#fdf6ec"/>' +
  '</svg>';
