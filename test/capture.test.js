import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { describe, it } from 'node:test';

import { pseudoContentToText } from '../src/shared/capture.js';

describe('pseudoContentToText', () => {
  it('extrai texto literal de ::before/::after', () => {
    assert.equal(pseudoContentToText('"→"'), '→');
    assert.equal(pseudoContentToText("'nota'"), 'nota');
    assert.equal(pseudoContentToText('"\\2713 "'), '✓');
  });

  it('ignora conteúdo que depende de contexto que não sobrevive ao clone', () => {
    for (const value of ['none', 'normal', '', 'attr(data-x)', 'counter(item)', 'url(a.png)']) {
      assert.equal(pseudoContentToText(value), null, value);
    }
  });
});

describe('_locales', () => {
  const localesDir = new URL('../public/_locales/', import.meta.url);
  const locales = readdirSync(localesDir);

  it('tem ao menos os dois idiomas suportados', () => {
    assert.deepEqual([...locales].sort(), ['en', 'pt_BR']);
  });

  it('declara exatamente as mesmas chaves em todos os idiomas', () => {
    const keysByLocale = locales.map((locale) => {
      const file = new URL(`${locale}/messages.json`, localesDir);
      const messages = JSON.parse(readFileSync(file, 'utf8'));
      return [locale, Object.keys(messages).sort()];
    });

    const [, reference] = keysByLocale[0];
    for (const [locale, keys] of keysByLocale.slice(1)) {
      assert.deepEqual(keys, reference, `${locale} divergiu das chaves de ${keysByLocale[0][0]}`);
    }
  });

  it('usa placeholders declarados em toda mensagem com $1', () => {
    for (const locale of locales) {
      const file = new URL(`${locale}/messages.json`, localesDir);
      const messages = JSON.parse(readFileSync(file, 'utf8'));
      for (const [key, entry] of Object.entries(messages)) {
        const named = entry.message.match(/\$[A-Za-z_][\w]*\$/g) ?? [];
        if (named.length === 0) continue;
        assert.ok(entry.placeholders, `${locale}/${key} usa placeholder sem declará-lo`);
        for (const token of named) {
          const name = token.slice(1, -1).toLowerCase();
          assert.ok(
            Object.keys(entry.placeholders).some((candidate) => candidate.toLowerCase() === name),
            `${locale}/${key} não declara o placeholder ${token}`,
          );
        }
      }
    }
  });
});
