/**
 * Основной сценарий автообновления.
 *
 * Порядок: собрать → проверить → собрать страницу → записать отчёт.
 * Если хоть одна площадка не ответила или отдала пустоту — ничего не пишем
 * и выходим с ошибкой. Так сайт не останется пустым из-за сбоя сети или
 * переделки вёрстки на стороне площадки.
 *
 * Запуск:  node tools/update.mjs [--dry-run] [--force]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchLlb } from './lib/llb.mjs';
import { fetchMsbs } from './lib/msbs.mjs';
import { fetchB4y } from './lib/b4y.mjs';
import { buildHtml, writeSite, sig } from './build.mjs';
import { nowMsk } from './lib/util.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'billiard-tournaments.html');
const DATA = path.join(ROOT, 'data');
const ROWS_JSON = path.join(DATA, 'rows.json');
const REPORT = path.join(DATA, 'last-run.json');
const MSG = path.join(DATA, 'commit-message.txt');

const args = process.argv.slice(2);
const dry = args.includes('--dry-run');
const force = args.includes('--force');
fs.mkdirSync(DATA, { recursive: true });

/** Горизонт расписания: от сегодня до конца 4-го месяца (сентябрь → конец декабря). */
function horizon() {
  const n = nowMsk();
  const end = new Date(n.y, n.m - 1 + 4, 0);
  return { from: new Date(n.y, n.m - 1, n.d), to: end, label: n.date };
}

const log = (...a) => console.log(...a);
const fail = msg => { console.error('ОШИБКА: ' + msg); process.exit(1); };

/* ---------- 1. Сбор ---------- */

const H = horizon();
const sources = [
  { name: 'ЛЛБ', fn: fetchLlb },
  { name: 'МСБС', fn: fetchMsbs },
  { name: 'B4Y', fn: fetchB4y }
];

const gathered = [];
for (const s of sources) {
  const t0 = Date.now();
  let rows;
  try {
    rows = await s.fn();
  } catch (e) {
    fail(`${s.name} не ответила: ${e.message}. Страница не тронута, старые данные остаются.`);
  }
  if (!rows.length) fail(`${s.name} вернула 0 турниров — похоже на сбой или смену вёрстки. Страница не тронута.`);
  const inHorizon = rows.filter(r => r.to >= H.from && r.from <= H.to);
  log(`  ${s.name.padEnd(5)} ${String(rows.length).padStart(3)} всего, ${String(inHorizon.length).padStart(3)} в горизонте, ${((Date.now() - t0) / 1000).toFixed(1)} с`);
  gathered.push({ name: s.name, rows: inHorizon });
}

const all = gathered.flatMap(g => g.rows);

/* ---------- 2. Страховка ---------- */

if (all.length < 15) fail(`всего ${all.length} турниров — слишком мало, что-то пошло не так. Страница не тронута.`);

let prev = [];
if (fs.existsSync(ROWS_JSON)) {
  try { prev = JSON.parse(fs.readFileSync(ROWS_JSON, 'utf8')); } catch (e) { prev = []; }
}
if (prev.length && all.length < prev.length * 0.5) {
  fail(`собралось ${all.length}, а в прошлый раз было ${prev.length} — потеряли больше половины. Страница не тронута, проверь площадки.`);
}

const bySrc = {};
for (const g of gathered) bySrc[g.name] = g.rows.length;
log('  всего: ' + all.length + '  по площадкам: ' + Object.entries(bySrc).map(([k, v]) => k + '=' + v).join(' '));

/* ---------- 3. Что изменилось ---------- */

const prevSigs = new Set(prev.map(r => r.key + '|' + r.url));
const curSigs = new Set(all.map(r => r.key + '|' + r.url));
const added = all.filter(r => !prevSigs.has(r.key + '|' + r.url));
const removed = prev.filter(r => !curSigs.has(r.key + '|' + r.url));

const exact = all.filter(r => !/tournaments\/next|calen\/$|rus-billiard\/tournament$/.test(r.url)).length;
log(`  ссылок на страницу турнира: ${exact} из ${all.length}`);

if (!prev.length) log('  прошлых данных нет — это первый запуск, все строки считаются новыми');
else {
  log(`  новых: ${added.length}, исчезло: ${removed.length}`);
  added.slice(0, 5).forEach(r => log('    + ' + r.key + ' ' + r.name.slice(0, 60)));
  removed.slice(0, 5).forEach(r => log('    − ' + r.key + ' ' + (r.name || '').slice(0, 60)));
}

/* ---------- 4. Сборка страницы ---------- */

const n = nowMsk();
const stamp = n.stamp;
const html = buildHtml(fs.readFileSync(SRC, 'utf8'), all, stamp);
const changed = html !== fs.readFileSync(SRC, 'utf8');

if (dry) {
  log('\n--dry-run: файлы не записываю. Страница ' + (changed ? 'изменилась бы' : 'осталась бы прежней'));
} else {
  writeSite(html);
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(ROWS_JSON, JSON.stringify(all.map(r => ({
    key: r.key, time: r.time, name: r.name, city: r.city, venue: r.venue,
    kind: r.kind, cnt: r.cnt, src: r.src, srcCls: r.srcCls, url: r.url
  })), null, 1), 'utf8');
  fs.writeFileSync(REPORT, JSON.stringify({
    ranAt: stamp, total: all.length, bySource: bySrc, exactLinks: exact,
    added: added.length, removed: removed.length, pageChanged: changed
  }, null, 1), 'utf8');
  log('\nзаписано: ' + path.relative(ROOT, SRC) + ' и ' + path.relative(ROOT, path.join(ROOT, 'index.html')));
  log('время обновления на странице: ' + stamp);
}

/* ---------- 5. Итог для коммита ---------- */

const summary = [
  `обновление ${stamp}`,
  `турниров: ${all.length} (было ${prev.length || '—'})`,
  `новых: ${added.length}, исчезло: ${removed.length}`,
  bySrc
].join(', ');

fs.writeFileSync(MSG,
  'Расписание на ' + stamp + '\n\n' + summary + '\n', 'utf8');

process.stdout.write('\n' + (changed || force ? 'ИЗМЕНЕНИЯ ЕСТЬ' : 'БЕЗ ИЗМЕНЕНИЙ') + '\n');
if (force) process.exit(0);
process.exit(changed ? 0 : 10);
