/**
 * Build-time translation generator.
 *
 * Parses RustDesk language files (vendor/rustdesk/src/lang/*.rs) and emits
 * JSON that the bridge `translate` handler loads at runtime.
 *
 * Output:
 *   src/bridge/generated/translations.json   — { [langCode]: { [key]: value } }
 *   src/bridge/generated/langs.json          — [["code", "Display Name"], ...]
 *
 * Run automatically via npm pre-hooks (prelint, pretest, pretypecheck, prebuild).
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { join, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const LANG_DIR = join(__dirname, '..', 'vendor', 'rustdesk', 'src', 'lang');
const OUT_DIR = join(__dirname, '..', 'src', 'bridge', 'generated');

/** Map from .rs filename (without extension) to RustDesk language code. */
const FILE_TO_CODE = {
  cn: 'zh-cn',
  tw: 'zh-tw',
  ptbr: 'pt',
  pt_PT: null, // not used in lang.rs match
  template: null, // master template, not a real language
};

/** Language display names and order, from RustDesk src/lang.rs LANGS array. */
const LANG_DISPLAY_NAMES = [
  ['en', 'English'], ['it', 'Italiano'], ['fr', 'Français'], ['de', 'Deutsch'],
  ['nl', 'Nederlands'], ['nb', 'Norsk bokmål'], ['zh-cn', '简体中文'],
  ['zh-tw', '繁體中文'], ['pt', 'Português'], ['es', 'Español'], ['et', 'Eesti keel'],
  ['eu', 'Euskara'], ['hu', 'Magyar'], ['bg', 'Български'], ['be', 'Беларуская'],
  ['ru', 'Русский'], ['sk', 'Slovenčina'], ['id', 'Indonesia'], ['cs', 'Čeština'],
  ['da', 'Dansk'], ['eo', 'Esperanto'], ['tr', 'Türkçe'], ['vi', 'Tiếng Việt'],
  ['pl', 'Polski'], ['ja', '日本語'], ['ko', '한국어'], ['kz', 'Қазақ'],
  ['uk', 'Українська'], ['fa', 'فارسی'], ['ca', 'Català'], ['el', 'Ελληνικά'],
  ['sv', 'Svenska'], ['sq', 'Shqip'], ['sr', 'Srpski'], ['th', 'ภาษาไทย'],
  ['sl', 'Slovenščina'], ['ro', 'Română'], ['lt', 'Lietuvių'], ['lv', 'Latviešu'],
  ['ar', 'العربية'], ['he', 'עברית'], ['hr', 'Hrvatski'], ['sc', 'Sardu'],
  ['ta', 'தமிழ்'], ['ge', 'ქართული'], ['fi', 'Suomi'], ['ml', 'മലയാളം'],
  ['hi', 'हिंदी'], ['gu', 'ગુજરાતી'],
];

/**
 * Parse a Rust language file and extract key-value pairs.
 *
 * Each file contains lines like:  ("key", "value"),
 * Values may contain escaped characters (\\n, \\", \\\\).
 */
function parseLangFile(filePath) {
  const content = readFileSync(filePath, 'utf-8');
  const result = {};
  // Match ("key", "value") pairs, handling escaped quotes inside values.
  const re = /\("((?:\\.|[^"\\])*)"\s*,\s*"((?:\\.|[^"\\])*)"\)/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    const key = unescapeRust(m[1]);
    const value = unescapeRust(m[2]);
    result[key] = value;
  }
  return result;
}

/** Unescape Rust string escapes to get the actual string value. */
function unescapeRust(s) {
  return s
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

function main() {
  if (!existsSync(LANG_DIR)) {
    console.error('Error: RustDesk language directory not found at', LANG_DIR);
    console.error('Make sure the submodule is initialized: git submodule update --init vendor/rustdesk');
    process.exit(1);
  }

  mkdirSync(OUT_DIR, { recursive: true });

  const translations = {};
  const files = readdirSync(LANG_DIR).filter(f => extname(f) === '.rs');

  for (const file of files) {
    const baseName = basename(file, '.rs');
    const code = FILE_TO_CODE[baseName] !== undefined ? FILE_TO_CODE[baseName] : baseName;
    if (!code) continue; // skip pt_PT, template, etc.
    translations[code] = parseLangFile(join(LANG_DIR, file));
  }

  // Build langs list, only including languages that have translation data.
  const langs = LANG_DISPLAY_NAMES.filter(([code]) => translations[code]);

  writeFileSync(join(OUT_DIR, 'translations.json'), JSON.stringify(translations, null, 0));
  writeFileSync(join(OUT_DIR, 'langs.json'), JSON.stringify(langs, null, 0));

  const langCount = Object.keys(translations).length;
  const enKeys = Object.keys(translations['en'] ?? {}).length;
  console.log(`Generated translations: ${langCount} languages, ${enKeys} English keys`);
}

main();