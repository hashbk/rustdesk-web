/**
 * Translation system for the JS bridge.
 *
 * Language data is generated at build time from RustDesk's native language
 * files (vendor/rustdesk/src/lang/*.rs) by scripts/gen-translations.mjs.
 * The generated JSON lives in ./generated/translations.json.
 *
 * The `translate` function mirrors RustDesk native behaviour
 * (src/lang.rs `translate_locale`):
 *   1. Resolve the language code from the browser locale.
 *   2. Look up the text in the language table.
 *   3. Fall back to English, then to the original text.
 *   4. Substitute {placeholder} values.
 */

import generatedTranslations from './generated/translations.json' with { type: 'json' };
import generatedLangs from './generated/langs.json' with { type: 'json' };

export const translations: Record<string, Record<string, string>> = generatedTranslations as Record<string, Record<string, string>>;

export const langs: [string, string][] = generatedLangs as [string, string][];

/**
 * Resolve a browser locale (e.g. "zh-CN", "pt-BR", "en-US") to a
 * RustDesk language code (e.g. "zh-cn", "pt", "en").
 *
 * Mirrors `resolve_lang` in RustDesk src/lang.rs.
 */
export function resolveLang(locale: string): string {
  const loc = locale.toLowerCase();
  if (loc.startsWith('zh')) {
    return loc.includes('tw') ? 'zh-tw' : 'zh-cn';
  }
  const part = loc.split('-')[0].split('_')[0];
  return part || 'en';
}

/**
 * Extract a {placeholder} from the input text.
 *
 * RustDesk uses `{value}` in UI strings and `{}` in translation files.
 * Returns the normalised key (with `{}` ) and the placeholder value.
 */
function extractPlaceholder(input: string): { key: string; value: string | null } {
  const match = input.match(/\{(.*?)\}/);
  if (match) {
    return { key: input.replace(/\{.*?\}/, '{}'), value: match[1] };
  }
  return { key: input, value: null };
}

/**
 * Translate a text key for the given locale.
 *
 * Falls back to English, then to the original text if no translation
 * is found — matching RustDesk native behaviour.
 */
export function translate(locale: string, text: string): string {
  const lang = resolveLang(locale);
  const { key, value } = extractPlaceholder(text);

  const lookup = (table: Record<string, string> | undefined, k: string): string | undefined => {
    if (!table) return undefined;
    const v = table[k];
    return v && v.length > 0 ? v : undefined;
  };

  let result = lookup(translations[lang], key);
  if (result === undefined && lang !== 'en') {
    result = lookup(translations['en'], key);
  }
  if (result === undefined) {
    result = key;
  }

  if (value !== null) {
    result = result.replace(/\{\}/g, value);
  }

  return result;
}
