import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { cssColorToHex, parseCssColor, rgbaToHex } from '../src/shared/color.js';

describe('parseCssColor', () => {
  it('lê as formas devolvidas por getComputedStyle', () => {
    assert.deepEqual(parseCssColor('rgb(18, 52, 86)'), { r: 18, g: 52, b: 86, a: 1 });
    assert.deepEqual(parseCssColor('rgba(18, 52, 86, 0.5)'), { r: 18, g: 52, b: 86, a: 0.5 });
    assert.deepEqual(parseCssColor('transparent'), { r: 0, g: 0, b: 0, a: 0 });
  });

  it('converte a faixa 0–1 de color(srgb …) para bytes', () => {
    assert.deepEqual(parseCssColor('color(srgb 0 0.5 1)'), { r: 0, g: 128, b: 255, a: 1 });
  });

  it('aceita hexadecimal de 3, 4, 6 e 8 dígitos', () => {
    assert.deepEqual(parseCssColor('#fff'), { r: 255, g: 255, b: 255, a: 1 });
    assert.deepEqual(parseCssColor('#0000'), { r: 0, g: 0, b: 0, a: 0 });
    assert.deepEqual(parseCssColor('#147d52'), { r: 20, g: 125, b: 82, a: 1 });
    assert.equal(parseCssColor('#147d5280').a, 128 / 255);
  });

  it('satura canais fora da faixa e devolve null no que não dá para ler', () => {
    assert.deepEqual(parseCssColor('rgb(300, -20, 10)'), { r: 255, g: 0, b: 10, a: 1 });
    assert.equal(parseCssColor(''), null);
    assert.equal(parseCssColor('none'), null);
    assert.equal(parseCssColor('rgb(1, 2)'), null);
  });
});

describe('cssColorToHex', () => {
  it('formata com dois dígitos por canal', () => {
    assert.equal(cssColorToHex('rgb(1, 2, 3)'), '#010203');
    assert.equal(rgbaToHex({ r: 255, g: 255, b: 255, a: 1 }), '#ffffff');
  });

  it('não transforma cor totalmente transparente em preto', () => {
    // O bug original: rgba(0, 0, 0, 0) virava #000000, então um fundo
    // transparente aparecia preto no seletor e ia preto para o PDF.
    assert.equal(cssColorToHex('rgba(0, 0, 0, 0)'), null);
    assert.equal(cssColorToHex('transparent'), null);
  });

  it('mantém cores apenas parcialmente transparentes', () => {
    assert.equal(cssColorToHex('rgba(20, 125, 82, 0.4)'), '#147d52');
  });
});
