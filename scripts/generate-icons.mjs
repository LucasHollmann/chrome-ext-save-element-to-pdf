/**
 * Gera os ícones da extensão em PNG.
 *
 * O Chrome só aceita bitmap em `manifest.icons`, e o projeto não tem (nem
 * precisa de) um rasterizador de SVG como dependência. O desenho é feito com
 * funções de distância e 4× de supersampling, o que basta para um ícone chapado
 * e entrega as bordas suaves que o tamanho de 16px exige.
 *
 * Uso: `npm run icons`
 */

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUTPUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
const SIZES = [16, 32, 48, 128];
const SAMPLES = 4;

const BACKGROUND = [20, 125, 82, 255];
const SHEET = [255, 255, 255, 255];
const LINE = [20, 125, 82, 255];

/**
 * Distância assinada até um retângulo de cantos arredondados, em coordenadas
 * normalizadas (0–1). Negativa dentro da forma.
 *
 * @param {number} x
 * @param {number} y
 * @param {number} left
 * @param {number} top
 * @param {number} right
 * @param {number} bottom
 * @param {number} radius
 * @returns {number}
 */
function roundedRectDistance(x, y, left, top, right, bottom, radius) {
  const halfWidth = (right - left) / 2;
  const halfHeight = (bottom - top) / 2;
  const centerX = left + halfWidth;
  const centerY = top + halfHeight;
  const clampedRadius = Math.min(radius, halfWidth, halfHeight);

  const dx = Math.abs(x - centerX) - (halfWidth - clampedRadius);
  const dy = Math.abs(y - centerY) - (halfHeight - clampedRadius);
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  return outside + Math.min(Math.max(dx, dy), 0) - clampedRadius;
}

/**
 * Cor da arte no ponto (x, y), em coordenadas normalizadas.
 * `null` significa transparente.
 *
 * @param {number} x
 * @param {number} y
 * @returns {number[] | null}
 */
function sample(x, y) {
  if (roundedRectDistance(x, y, 0.02, 0.02, 0.98, 0.98, 0.22) > 0) return null;

  // Folha de papel, com o canto superior direito dobrado.
  const insideSheet = roundedRectDistance(x, y, 0.26, 0.17, 0.74, 0.83, 0.05) <= 0;
  // Triângulo no canto superior direito da folha, sugerindo a dobra.
  const foldedCorner = x > 0.6 && y < 0.31 && x - 0.6 > y - 0.17;
  if (insideSheet && !foldedCorner) {
    // Três linhas de texto na metade inferior da folha.
    for (const lineTop of [0.44, 0.57, 0.7]) {
      const lineRight = lineTop === 0.7 ? 0.58 : 0.66;
      if (x >= 0.34 && x <= lineRight && y >= lineTop && y <= lineTop + 0.065) return LINE;
    }
    return SHEET;
  }

  return BACKGROUND;
}

/**
 * Rasteriza o ícone num buffer RGBA.
 *
 * @param {number} size
 * @returns {Buffer}
 */
function renderIcon(size) {
  const pixels = Buffer.alloc(size * size * 4);

  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;

      for (let subRow = 0; subRow < SAMPLES; subRow += 1) {
        for (let subColumn = 0; subColumn < SAMPLES; subColumn += 1) {
          const x = (column + (subColumn + 0.5) / SAMPLES) / size;
          const y = (row + (subRow + 0.5) / SAMPLES) / size;
          const color = sample(x, y);
          if (!color) continue;
          r += color[0];
          g += color[1];
          b += color[2];
          a += color[3];
        }
      }

      const total = SAMPLES * SAMPLES;
      const alpha = a / total;
      const offset = (row * size + column) * 4;
      // Pré-divide pelo número de amostras opacas para não escurecer as bordas.
      const opaqueSamples = a / 255 || 1;
      pixels[offset] = Math.round(r / opaqueSamples);
      pixels[offset + 1] = Math.round(g / opaqueSamples);
      pixels[offset + 2] = Math.round(b / opaqueSamples);
      pixels[offset + 3] = Math.round(alpha);
    }
  }

  return pixels;
}

/**
 * @param {string} type
 * @param {Buffer} data
 * @returns {Buffer}
 */
function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

/**
 * @param {Buffer} buffer
 * @returns {number}
 */
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Empacota pixels RGBA num PNG de 8 bits sem filtro por linha.
 *
 * @param {Buffer} pixels
 * @param {number} size
 * @returns {Buffer}
 */
function encodePng(pixels, size) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // profundidade de bits
  header[9] = 6; // RGBA
  header[10] = 0; // deflate
  header[11] = 0; // filtro adaptativo
  header[12] = 0; // sem entrelaçamento

  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let row = 0; row < size; row += 1) {
    raw[row * (stride + 1)] = 0; // filtro "None"
    pixels.copy(raw, row * (stride + 1) + 1, row * stride, (row + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(OUTPUT_DIR, { recursive: true });
for (const size of SIZES) {
  const file = resolve(OUTPUT_DIR, `icon-${size}.png`);
  writeFileSync(file, encodePng(renderIcon(size), size));
  process.stdout.write(`icone gerado: ${file}\n`);
}
