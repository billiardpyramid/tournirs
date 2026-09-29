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
import { nowMsk, hasStarted } from './lib/util.mjs';

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

/**
 * Останавливаем сборку с внятной причиной. В GitHub Actions причина дополнительно
 * попадает в Annotations — там её видно без открытия полного лога.
 */
const fail = msg => {
  console.error('ОШИБКА: ' + msg);
  if (process.env.GITHUB_ACTIONS) console.error('::error title=Сбор не удался::' + msg);
  try {
    fs.writeFileSync(REPORT, JSON.stringify({ ranAt: nowMsk().stamp, ok: false, error: msg }, null, 1), 'utf8');
  } catch (e) { /* отчёт не записался — не страшно */ }
  process.exit(1);
};

/* ---------- 1. Сбор ---------- */

const H = horizon();
const sources = [
  { name: 'ЛЛБ', cls: 'llb', fn: fetchLlb },
  { name: 'МСБС', cls: 'msbs', fn: fetchMsbs },
  { name: 'B4Y', cls: 'b4y', fn: fetchB4y }
];

const cacheFile = cls => path.join(DATA, 'cache-' + cls + '.json');

/** Из JSON даты приходят строками — возвращаем их в Date, иначе сборка страницы падает. */
const revive = r => ({
  ...r,
  from: r.from instanceof Date ? r.from : new Date(r.from),
  to: r.to instanceof Date ? r.to : new Date(r.to)
});

/**
 * Связь с площадками нестабильна: mosbilliard.ru с разных адресов GitHub то отвечает
 * за секунду, то уходит в таймаут. Проверено диагностикой: curl до него доходит,
 * падает именно Node-запрос, и не в каждом запуске.
 *
 * Поэтому сбой по одной площадке не роняет всю сборку: берём её прошлые данные из кэша
 * и пишем в отчёт, что они устаревшие. Если кэша нет — тогда уже останавливаемся,
 * чтобы не опубликовать неполное расписание.
 */
const gathered = [];
const stale = [];

for (const s of sources) {
  const t0 = Date.now();
  let rows = null, problem = null;
  try {
    rows = await s.fn();
    if (!rows || !rows.length) problem = 'вернула 0 турниров';
  } catch (e) {
    problem = ((e && (e.reason || e.detail || e.message)) || String(e) || 'причина неизвестна').toString();
  }

  if (problem) {
    const file = cacheFile(s.cls);
    let cached = null;
    if (fs.existsSync(file)) { try { cached = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { cached = null; } }
    if (cached && cached.rows && cached.rows.length) {
      log(`  ${s.name.padEnd(5)} НЕ ОТВЕТИЛА (${problem}) — беру прошлые данные от ${cached.at}`);
      stale.push(s.name);
      gathered.push({ name: s.name, cls: s.cls, rows: cached.rows.map(revive), fromCache: true });
    } else {
      fail(`${s.name} не ответила: ${problem} Прошлых данных тоже нет, страница не тронута.`);
    }
    continue;
  }

  const now = new Date();
  const inHorizon = rows.filter(r => !hasStarted(r, now)).filter(r => r.to >= H.from && r.from <= H.to);
  const skippedStarted = rows.filter(r => hasStarted(r, now)).length;
  log(`  ${s.name.padEnd(5)} ${String(rows.length).padStart(3)} всего, ${String(inHorizon.length).padStart(3)} в горизонте` +
    (skippedStarted ? `, уже начавшихся пропущено ${skippedStarted}` : '') +
    `, ${((Date.now() - t0) / 1000).toFixed(1)} с`);
  fs.writeFileSync(cacheFile(s.cls), JSON.stringify({
    at: nowMsk().stamp, total: rows.length, rows: inHorizon
  }, null, 1), 'utf8');
  gathered.push({ name: s.name, cls: s.cls, rows: inHorizon, fromCache: false });
}

const all = gathered.flatMap(g => g.rows);
if (stale.length) {
  console.log('  ВНИМАНИЕ: устаревшие данные по: ' + stale.join(', ') + '. Расписание собрано не полностью свежим.');
}

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
    added: added.length, removed: removed.length, pageChanged: changed,
    staleSources: stale
  }, null, 1), 'utf8');
  log('\nзаписано: ' + path.relative(ROOT, SRC) + ' и ' + path.relative(ROOT, path.join(ROOT, 'index.html')));
  log('время обновления на странице: ' + stamp);
}

/* ---------- 5. Итог для коммита ---------- */

const summary = [
  `обновление ${stamp}`,
  `турниров: ${all.length} (было ${prev.length || '—'})`,
  `новых: ${added.length}, исчезло: ${removed.length}`,
  Object.entries(bySrc).map(([k, v]) => k + '=' + v).join(' '),
  stale.length ? 'устаревшие данные: ' + stale.join(', ') : ''
].filter(Boolean).join(', ');

fs.writeFileSync(MSG,
  'Расписание на ' + stamp + '\n\n' + summary + '\n', 'utf8');

process.stdout.write('\n' + (changed || force ? 'ИЗМЕНЕНИЯ ЕСТЬ' : 'БЕЗ ИЗМЕНЕНИЙ') + '\n');
if (force) process.exit(0);
process.exit(changed ? 0 : 10);
