/**
 * Conversão das cores computadas pelo navegador para o formato aceito por
 * `<input type="color">` (apenas `#rrggbb`, sem canal alfa).
 *
 * Funções puras, cobertas por `node --test`.
 */

/**
 * @typedef {object} Rgba
 * @property {number} r 0–255
 * @property {number} g 0–255
 * @property {number} b 0–255
 * @property {number} a 0–1
 */

/**
 * Interpreta as formas que `getComputedStyle` devolve: `rgb()`, `rgba()`,
 * `color(srgb …)` e `transparent`.
 *
 * @param {string} color
 * @returns {Rgba | null} `null` quando a cor não puder ser interpretada
 */
export function parseCssColor(color) {
  const value = String(color).trim().toLowerCase();
  if (!value || value === 'none') return null;
  if (value === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };

  const hex = value.match(/^#([\da-f]{3,8})$/);
  if (hex) {
    const digits = hex[1];
    if (digits.length === 3 || digits.length === 4) {
      const [r, g, b, a = 'f'] = digits;
      return {
        r: Number.parseInt(r + r, 16),
        g: Number.parseInt(g + g, 16),
        b: Number.parseInt(b + b, 16),
        a: Number.parseInt(a + a, 16) / 255,
      };
    }
    if (digits.length === 6 || digits.length === 8) {
      return {
        r: Number.parseInt(digits.slice(0, 2), 16),
        g: Number.parseInt(digits.slice(2, 4), 16),
        b: Number.parseInt(digits.slice(4, 6), 16),
        a: digits.length === 8 ? Number.parseInt(digits.slice(6, 8), 16) / 255 : 1,
      };
    }
    return null;
  }

  const channels = value.match(/-?[\d.]+%?/g);
  if (!channels || channels.length < 3) return null;

  // `color(srgb 0.1 0.2 0.3)` usa a faixa 0–1; `rgb()` usa 0–255 ou %.
  const normalized = value.startsWith('color(');
  const toByte = (raw) => {
    const numeric = Number.parseFloat(raw);
    if (Number.isNaN(numeric)) return 0;
    if (raw.endsWith('%')) return Math.round((numeric / 100) * 255);
    return Math.round(normalized ? numeric * 255 : numeric);
  };

  const alphaRaw = channels[3];
  const alpha =
    alphaRaw === undefined
      ? 1
      : alphaRaw.endsWith('%')
        ? Number.parseFloat(alphaRaw) / 100
        : Number.parseFloat(alphaRaw);

  return {
    r: clampByte(toByte(channels[0])),
    g: clampByte(toByte(channels[1])),
    b: clampByte(toByte(channels[2])),
    a: Number.isNaN(alpha) ? 1 : Math.min(1, Math.max(0, alpha)),
  };
}

/**
 * @param {number} value
 * @returns {number}
 */
function clampByte(value) {
  return Math.min(255, Math.max(0, Math.round(value)));
}

/**
 * @param {Rgba} rgba
 * @returns {string} `#rrggbb`
 */
export function rgbaToHex({ r, g, b }) {
  return `#${[r, g, b].map((channel) => clampByte(channel).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Converte uma cor computada para `#rrggbb`.
 *
 * Cores totalmente transparentes devolvem `null` em vez de `#000000`: tratar
 * `rgba(0, 0, 0, 0)` como preto fazia um fundo transparente aparecer preto no
 * seletor de cor — e virar preto de verdade no PDF ao tocar no campo.
 *
 * @param {string} color
 * @returns {string | null}
 */
export function cssColorToHex(color) {
  const parsed = parseCssColor(color);
  if (!parsed || parsed.a === 0) return null;
  return rgbaToHex(parsed);
}
