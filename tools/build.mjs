/**
 * Сборка страницы: подставляет собранные турниры в готовый HTML.
 *
 * ВАЖНО: страница остаётся единственным источником правди вёрстки. Скрипт
 * НЕ переписывает её целиком — он заменяет только три куска:
 *   1) массив const ROWS = [ … ];
 *   2) <span id="upd">…</span> — время последнего обновления;
 *   3) <title> — дата в заголовке вкладки.
 * Всё остальное (стили, календарь, фильтры, фон) правится руками в HTML.
 */
import fs from 'node:fs';
import path from 'node:path';
import { esc, jsStr, rangeKey } from './lib/util.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'), '..');
const SRC = path.join(ROOT, 'billiard-tournaments.html');
const OUT = path.join(ROOT, 'index.html');

/** Строка таблицы: [дата, время, название, город| площадка, вид, участники, площадка-источник, класс, ссылка] */
function toRow(r) {
  return [
    r.key,
    r.time || '—',
    r.name,
    r.venue ? r.city + '|' + r.venue : r.city,
    r.kind,
    r.cnt || '—',
    r.src,
    r.srcCls,
    r.url
  ];
}

export function buildHtml(html, rows, stamp, status) {
  // 0) год сезона — в датах строк («29.09») года нет, он нужен для Date
  const season = rows.reduce((y, r) => Math.max(y, r.from.getFullYear()), rows[0] ? rows[0].from.getFullYear() : new Date().getFullYear());
  if (!/const SEASON = \d{4};/.test(html))
    throw new Error('не нашёл строку «const SEASON = …» — страница сломана, сборку прекращаю');
  html = html.replace(/const SEASON = \d{4}; \/\/ <- автосбор/, 'const SEASON = ' + season + '; // <- автосбор');

  // 1) состояние площадок — из него страница рисует плашку при сбое
  if (status) {
    if (!/const SOURCE_STATUS =/.test(html))
      throw new Error('не нашёл «const SOURCE_STATUS = …» — страница сломана, сборку прекращаю');
    html = html.replace(/const SOURCE_STATUS = \{[\s\S]*?\}; \/\/ <- автосбор/,
      'const SOURCE_STATUS = ' + JSON.stringify(status, null, 1).replace(/\n\s*/g, ' ') + '; // <- автосбор');
  }

  // 2) массив ROWS
  const body = rows.map(r => '[' + toRow(r).map(jsStr).join(',') + ']').join(',\n');
  if (!/const ROWS = \[[\s\S]*?\n\];/.test(html))
    throw new Error('не нашёл блок «const ROWS = [ … ];» — страница сломана, сборку прекращаю');
  html = html.replace(/(const ROWS = \[)[\s\S]*?(\n\];)/, (_, a, b) => a + '\n' + body + b);

  // 3) время обновления
  if (!/<span id="upd">/.test(html))
    throw new Error('не нашёл <span id="upd"> — страница сломана, сборку прекращаю');
  html = html.replace(/(<span id="upd">)[^<]*(<\/span>)/, (_, a, b) => a + 'обновлено ' + stamp + b);

  // 4) заголовок вкладки — он же показывается в предпросмотре при отправке ссылки
  if (!/<title>[^<]*<\/title>/.test(html))
    throw new Error('не нашёл <title> — страница сломана, сборку прекращаю');
  html = html.replace(/<title>[^<]*<\/title>/,
    '<title>Ближайшие турниры по русскому бильярду — на одном листе</title>');

  return html;
}

export function writeSite(html) {
  fs.writeFileSync(SRC, html, 'utf8');
  fs.writeFileSync(OUT, html, 'utf8');
  return { src: SRC, out: OUT };
}

/** Ключ строки для сравнения «что изменилось». */
export const sig = r => [r.key, r.time, r.name, r.city, r.venue, r.kind, r.url].join('|');
export { rangeKey };
