/* Colores de asignatura visibles en el horario de escritorio y móvil. */
const fs = require('fs');
const assert = require('assert/strict');
const vm = require('vm');

const schedule = fs.readFileSync('src/js/schedule.js', 'utf8');
const css = fs.readFileSync('src/css/styles.css', 'utf8');
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(schedule + '\nthis.tones = PALETA; this.labels = PALETA_LABEL;', sandbox);
const tones = sandbox.tones;

assert.ok(schedule.includes('class="sg-cell sc-${a.color}"'), 'la cuadrícula recibe el color de la asignatura');
assert.ok(schedule.includes("cls = 'sc-' + a.color"), 'la vista móvil recibe el color de la asignatura');
assert.ok(schedule.includes('class="sg-color"') && schedule.includes('class="mc-color"'), 'el color también tiene un marcador de forma');

for (const tone of tones) {
  assert.equal(sandbox.colorValido(tone, 0), tone, `conserva ${tone} al normalizar o importar`);
  assert.ok(sandbox.labels[tone], `nombre accesible para ${tone}`);
  assert.ok(css.includes(`.sc-${tone} {`), `variables de color para ${tone}`);
  assert.ok(css.includes(`:root[data-theme="dark"] .sc-${tone} {`), `variante oscura para ${tone}`);
}
assert.equal(tones.length, 16);
assert.ok(css.includes('.sg-cell[class*="sc-"]'));
assert.ok(css.lastIndexOf('.schedule-mobile .mobile-class[class*="sc-"]') > css.lastIndexOf('.schedule-mobile .mobile-class { border: 0'),
  'los colores prevalecen sobre la antigua vista móvil neutra');
assert.ok(css.includes('background: var(--sc-bg)'));
assert.ok(css.includes('border-color: var(--sc-border)'));
assert.ok(css.includes('color: var(--sc-text)'));
console.log('OK: los 16 colores se conservan al normalizar y tienen nombre accesible y variantes clara/oscura');
