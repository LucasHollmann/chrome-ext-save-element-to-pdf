import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  isUnsafeAttributeName,
  isUnsafeUrl,
  resolveSrcset,
  resolveUrl,
} from '../src/shared/sanitize.js';
import { isValidId } from '../src/shared/messages.js';

describe('isUnsafeAttributeName', () => {
  it('rejeita handlers inline e srcdoc', () => {
    assert.equal(isUnsafeAttributeName('onclick'), true);
    assert.equal(isUnsafeAttributeName('ONERROR'), true);
    assert.equal(isUnsafeAttributeName('srcdoc'), true);
    assert.equal(isUnsafeAttributeName('src'), false);
    assert.equal(isUnsafeAttributeName('one'), true, 'prefixo "on" é tratado como handler');
  });
});

describe('isUnsafeUrl', () => {
  it('aceita os esquemas que o PDF precisa', () => {
    for (const url of [
      'https://exemplo.com/a.png',
      'http://x/y',
      'data:image/png;base64,AA',
      '/caminho',
      '#ancora',
      'imagem.png',
    ]) {
      assert.equal(isUnsafeUrl(url), false, url);
    }
  });

  it('rejeita esquemas executáveis', () => {
    assert.equal(isUnsafeUrl('javascript:alert(1)'), true);
    assert.equal(isUnsafeUrl('vbscript:msgbox'), true);
  });

  it('não se deixa enganar por espaços, controles e entidades', () => {
    assert.equal(isUnsafeUrl('  javascript:alert(1)'), true);
    assert.equal(isUnsafeUrl('java\tscript:alert(1)'), true);
    assert.equal(isUnsafeUrl('java\u0000script:alert(1)'), true);
    assert.equal(isUnsafeUrl('JaVaScRiPt:alert(1)'), true);
    assert.equal(isUnsafeUrl('&#106;avascript:alert(1)'), true);
    assert.equal(isUnsafeUrl('&#x6a;avascript:alert(1)'), true);
  });

  it('não confunde caminho com esquema', () => {
    assert.equal(isUnsafeUrl('/a/b?x=1:2'), false);
    assert.equal(isUnsafeUrl('pagina.html#secao:1'), false);
  });
});

describe('resolveUrl', () => {
  const base = 'https://exemplo.com/blog/post/';

  it('resolve relativo contra a página de origem', () => {
    assert.equal(resolveUrl('img.png', base), 'https://exemplo.com/blog/post/img.png');
    assert.equal(resolveUrl('/raiz.png', base), 'https://exemplo.com/raiz.png');
    assert.equal(resolveUrl('../up.png', base), 'https://exemplo.com/blog/up.png');
  });

  it('preserva data:, blob: e âncoras', () => {
    assert.equal(resolveUrl('data:image/png;base64,AA', base), 'data:image/png;base64,AA');
    assert.equal(resolveUrl('#topo', base), '#topo');
  });

  it('devolve null para esquema perigoso ou URL ilegível', () => {
    assert.equal(resolveUrl('javascript:alert(1)', base), null);
    assert.equal(resolveUrl('http://[', base), null);
  });
});

describe('resolveSrcset', () => {
  it('resolve cada candidato preservando o descritor', () => {
    assert.equal(
      resolveSrcset('a.png 1x, b.png 2x', 'https://exemplo.com/i/'),
      'https://exemplo.com/i/a.png 1x, https://exemplo.com/i/b.png 2x',
    );
  });

  it('descarta candidatos inválidos em vez de quebrar o atributo inteiro', () => {
    assert.equal(
      resolveSrcset('javascript:alert(1) 1x, ok.png 2x', 'https://exemplo.com/i/'),
      'https://exemplo.com/i/ok.png 2x',
    );
  });
});

describe('isValidId', () => {
  it('aceita apenas UUID no formato de crypto.randomUUID', () => {
    assert.equal(isValidId('6f2a1c3e-4b5d-4e6f-8a9b-0c1d2e3f4a5b'), true);
    assert.equal(isValidId('------------------------------------'), false);
    assert.equal(isValidId('6f2a1c3e4b5d4e6f8a9b0c1d2e3f4a5b'), false);
    assert.equal(isValidId(undefined), false);
  });
});
