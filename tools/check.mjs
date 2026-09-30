/**
 * Проверка качества собранного расписания.
 *
 *     node tools/check.mjs
 *
 * Сверяет то, что лежит в data/rows.json, с тем, что сейчас отдают площадки:
 *   1. все ли турниры площадок попали на сайт (сверка по нормализованному названию);
 *   2. идут ли даты строго по возрастанию (иначе календарь и таблица путаются);
 *   3. у скольких строк есть число зарегистрированных.
 *
 * Ничего не правит — только показывает, что сломано.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchLlb } from './lib/llb.mjs';
import { fetchMsbs } from './lib/msbs.mjs';
import { fetchB4y } from './lib/b4y.mjs';
import { hasStarted, nowMsk } from './lib/util.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(ROOT, 'data', 'rows.json');
if (!fs.existsSync(file)) {
  console.log('НЕТ data/rows.json — сначала запусти node tools/update.mjs');
  process.exit(1);
}

const site = JSON.parse(fs.readFileSync(file, 'utf8'));
const now = new Date();
const YEAR = Number(process.argv[2]) || nowMsk(now).y;

const pad = n => String(n).padStart(2, '0');
const dm = d => pad(d.getDate()) + '.' + pad(d.getMonth() + 1);

/**
 * Дата старта из ключа строки. Форматы: «30.09», «09–12.10» (месяц в конце),
 * «31.10–01.11» (месяц есть с обеих сторон).
 */
const startOf = key => {
  const k = String(key || '');
  const parts = k.split('–');
  if (parts.length === 1) {
    const p = parts[0].split('.');
    return p.length === 2 ? new Date(YEAR, +p[1] - 1, +p[0]) : new Date(NaN);
  }
  const [l, r] = parts;
  const lp = l.split('.');
  const rp = r.split('.');
  if (lp.length === 2) return new Date(YEAR, +lp[1] - 1, +lp[0]);          // 31.10–01.11
  if (rp.length === 2) return new Date(YEAR, +rp[1] - 1, +l);            // 09–12.10
  return new Date(NaN);
};

const norm = s => String(s).toLowerCase().replace(/ё/g, 'е')
  .replace(/[^a-zа-я0-9]+/g, ' ').replace(/\s+/g, ' ').trim();

console.log('Проверка расписания. Сейчас ' + now.toLocaleString('ru-RU'));
console.log('Строк в data/rows.json: ' + site.length + '\n');

const siteNames = new Set(site.map(r => norm(r.name)));
let problems = 0;

for (const [name, fn] of [['ЛЛБ', fetchLlb], ['МСБС', fetchMsbs], ['B4Y', fetchB4y]]) {
  const all = await fn();
  const mine = site.filter(r => r.src === name).map(r => startOf(r.key)).filter(d => !isNaN(d)).sort((a, b) => a - b);
  if (!mine.length) { console.log(name.padEnd(5) + ' — на сайте нет строк'); continue; }
  const first = mine[0], last = mine[mine.length - 1];
  const inWindow = all.filter(r => !hasStarted(r, now) && r.from >= first && r.from <= last);
  const missing = inWindow.filter(r => !siteNames.has(norm(r.name)));
  problems += missing.length;
  console.log(
    name.padEnd(5) + ' окно ' + dm(first) + '…' + dm(last) +
    '  на площадке ' + String(inWindow.length).padStart(3) +
    '  на сайте ' + String(mine.length).padStart(3) +
    '  не хватает ' + String(missing.length).padStart(3));
  missing.slice(0, 8).forEach(r => console.log('        НЕТ  ' + dm(r.from) + '  ' + r.name.slice(0, 58)));
}

let disorder = 0, bad = 0, prev = null;
for (const r of site) {
  const d = startOf(r.key);
  if (isNaN(d)) { bad++; console.log('   НЕРАЗБОРЧИВАЯ ДАТА: ' + r.key + '  ' + r.name.slice(0, 40)); continue; }
  if (prev && d < prev) {
    disorder++;
    console.log('   СБОЙ ПОРЯДКА: ' + r.key + ' после ' + dm(prev));
  }
  prev = d;
}

const withCnt = site.filter(r => /^\d+$/.test(String(r.cnt))).length;
const exact = site.filter(r => !/tournaments\/next|calen\/$|rus-billiard\/tournament$/.test(r.url)).length;
const days = new Set(site.map(r => r.key.split(/[–-]/)[0])).size;

console.log('\nхронология: нарушений порядка ' + disorder + (bad ? ', неразобранных дат ' + bad : ''));
console.log('участников указано: ' + withCnt + ' из ' + site.length);
console.log('ссылка на страницу турнира: ' + exact + ' из ' + site.length);
console.log('дней в таблице: ' + days);
console.log('\nрасхождений со сбором: ' + problems);

process.exit(problems || disorder || bad ? 1 : 0);
