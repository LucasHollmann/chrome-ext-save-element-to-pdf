/**
 * Preferências da extensão, em `chrome.storage.local`.
 */

/** Resolução de referência do CSS: 1px equivale a 1/96 de polegada. */
export const CSS_DPI = 96;

/**
 * Presets de qualidade das imagens.
 *
 * `dpi` é a resolução alvo em relação ao tamanho físico da página: a largura em
 * pixels da imagem vira `larguraDaPágina × dpi / 96`. A imagem nunca é ampliada
 * — se o original já for menor que o alvo, ele é mantido.
 *
 * `quality` é a qualidade do JPEG resultante. Em `original`, os dois são nulos:
 * os bytes do arquivo seguem intactos, sem recompressão.
 */
export const IMAGE_PRESETS = Object.freeze({
  original: { dpi: null, quality: null },
  high: { dpi: 300, quality: 0.92 },
  medium: { dpi: 150, quality: 0.85 },
  screen: { dpi: CSS_DPI, quality: 0.8 },
});

/** @typedef {keyof typeof IMAGE_PRESETS} ImagePresetName */

/** Preset usado quando nada foi escolhido: não mexer nos arquivos originais. */
export const DEFAULT_IMAGE_PRESET = 'original';

const STORAGE_KEY = 'imagePreset';

/**
 * @param {unknown} name
 * @returns {ImagePresetName}
 */
export function normalizePreset(name) {
  return typeof name === 'string' && name in IMAGE_PRESETS
    ? /** @type {ImagePresetName} */ (name)
    : DEFAULT_IMAGE_PRESET;
}

/**
 * @returns {Promise<ImagePresetName>}
 */
export async function readImagePreset() {
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    return normalizePreset(stored?.[STORAGE_KEY]);
  } catch {
    return DEFAULT_IMAGE_PRESET;
  }
}

/**
 * @param {unknown} name
 * @returns {Promise<void>}
 */
export async function writeImagePreset(name) {
  await chrome.storage.local.set({ [STORAGE_KEY]: normalizePreset(name) });
}

/**
 * Converte um preset nas instruções concretas de reamostragem para uma página.
 *
 * @param {ImagePresetName} name
 * @param {number} boxWidth largura da página, em px de CSS
 * @returns {{ maxWidth: number | null, quality: number | null }}
 */
export function resampleTargetFor(name, boxWidth) {
  const preset = IMAGE_PRESETS[normalizePreset(name)];
  if (!preset.dpi) return { maxWidth: null, quality: null };

  return {
    maxWidth: Math.max(1, Math.round((boxWidth * preset.dpi) / CSS_DPI)),
    quality: preset.quality,
  };
}
