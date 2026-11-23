/* Colores de asignatura visibles en el horario de escritorio y móvil. */
const fs = require('fs');
const assert = require('assert/strict');

const schedule = fs.readFileSync('src/js/schedule.js', 'utf8');
const css = fs.readFileSync('src/css/styles.css', 'utf8');
const tones = ['azul', 'verde', 'morado', 'naranja', 'rosa', 'turquesa', 'amarillo', 'gris'];

assert.ok(schedule.includes('class="sg-cell sc-${a.color}"'), 'la cuadrícula recibe el color de la asignatura');
assert.ok(schedule.includes("cls = 'sc-' + a.color"), 'la vista móvil recibe el color de la asignatura');
assert.ok(schedule.includes('class="sg-color"') && schedule.includes('class="mc-color"'), 'el color también tiene un marcador de forma');

for (const tone of tones) {
  assert.ok(css.includes(`.sg-cell.sc-${tone}`), `estilo de escritorio para ${tone}`);
  assert.ok(css.includes(`.schedule-mobile .mobile-class.sc-${tone}`), `estilo móvil para ${tone}`);
}
assert.ok(css.lastIndexOf('.schedule-mobile .mobile-class.sc-azul') > css.lastIndexOf('.schedule-mobile .mobile-class { border: 0'),
  'los colores prevalecen sobre la antigua vista móvil neutra');
assert.ok(css.includes('background: var(--sc-bg)'));
assert.ok(css.includes('border-color: var(--sc-border)'));
assert.ok(css.includes('color: var(--sc-text)'));
console.log('OK: los ocho colores se muestran en el horario y conservan una señal no cromática');
