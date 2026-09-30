/**
 * ЛЛБ — Лига бильярда России, llb.su
 *
 * Разметка карточки (одна строка таблицы на турнир):
 *   <tr>
 *     <td class="date">30.09.26<br>19:00</td>
 *     <td>
 *       <div class="comp-teaser links-new"><a href="/t/5545038">Название</a></div>
 *       <a class="club-link" href="/node/…">Клуб</a>
 *       <a class="parts-link" title="Участники: 20 из 36">20</a>
 *     </td>
 *   </tr>
 *
 * Страницы: /tournaments/next?page=0..N (предстоящие) и /tournaments/online (идущие).
 * Идти/прошедшие нужны, иначе в ленте пропадают турниры текущего дня.
 */
import * as cheerio from 'cheerio';
import { get, patient } from './http.mjs';
import { clean, pyramidKind, isPyramidOnly, rangeKey, nowMsk, findCity } from './util.mjs';

const BASE = 'https://www.llb.su';
const NEXT = BASE + '/tournaments/next?page=';

/* Вкладку /tournaments/online («текущие») НЕ берём: там идущие турниры, а нужны
   только те, что ещё не начались. */

/**
 * Ячейка с датой выглядит как «30.09.26<br>19:00». Если брать её текст целиком,
 * дата и время слипаются в «30.09.2619:00», и регулярка с двумя цифрами года
 * съедает «2619» — получается год 2619, турнир улетает за горизонт и пропадает.
 * Поэтому режем по <br> и разбираем каждую строку отдельно.
 */
function splitDateCell($td) {
  const html = $td.html() || '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .split('\n')
    .map(clean)
    .filter(Boolean);
}

function parseCard($tr) {
  const $a = $tr.find('div.comp-teaser.links-new a[href*="/t/"]').first();
  if (!$a.length) return null;
  const href = $a.attr('href') || '';
  const id = (href.match(/\/t\/(\d+)/) || [])[1];
  if (!id) return null;

  const name = clean($a.text());
  const lines = splitDateCell($tr.find('td.date').first());
  if (!lines.length) return null;

  const dateLine = lines[0];
  const rest = lines.slice(1).join(' ');

  // «30.09.26» — начало; у многодневных «23.10.26 26.10» — конец позже в этой же строке
  const startM = dateLine.match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
  if (!startM) return null;
  const toYear = y => (+y < 100 ? 2000 + +y : +y);
  const start = new Date(toYear(startM[3]), +startM[2] - 1, +startM[1]);
  if (isNaN(start)) return null;

  let end = new Date(start);
  const tail = dateLine.slice((dateLine.indexOf(startM[0]) || 0) + startM[0].length);
  const endM = tail.match(/(\d{1,2})\.(\d{1,2})/);
  if (endM) {
    const e = new Date(start.getFullYear(), +endM[2] - 1, +endM[1]);
    if (!isNaN(e) && e >= start) end = e;
  }
  // время может быть во второй строке, а у части карточек — сразу после даты
  const time = (rest + ' ' + tail).match(/(\d{1,2}:\d{2})/);
  const timeStr = time ? time[1] : '';

  // В дату.start кладём и время, если оно есть. Иначе турнир сегодня в 19:00
  // сравнивается с полуночью и считается уже начавшимся.
  const applyTime = d => {
    if (!timeStr) return d;
    const [hh, mm] = timeStr.split(':').map(Number);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), hh, mm);
  };

  const club = clean($tr.find('a.club-link').first().text());
  const partsLink = $tr.find('a.parts-link').first();
  // показываем число зарегистрированных (как в первой версии сайта), а не «N из M»
  const title = partsLink.attr('title') || '';
  let cnt = (title.match(/Участники:\s*(\d+)/) || [])[1] || clean(partsLink.text());
  if (!/^\d/.test(cnt)) cnt = '';

  const kind = pyramidKind(name);
  if (!isPyramidOnly(kind, name)) return null;

  return {
    from: applyTime(start), to: end,
    time: timeStr,
    name,
    city: findCity(name, club) || '—',
    venue: club,
    kind: kind || 'пирамида',
    cnt,
    src: 'ЛЛБ', srcCls: 'llb',
    url: BASE + '/t/' + id
  };
}

export async function fetchLlb() {
  const pages = [];
  for (let p = 0; p < 3; p++) pages.push(NEXT + p);

  const seen = new Set();
  const out = [];
  for (const url of pages) {
    const html = await get(url, patient);
    const $ = cheerio.load(html);
    $('tr').each((_, tr) => {
      const card = parseCard($(tr));
      if (!card) return;
      if (seen.has(card.url)) return;
      seen.add(card.url);
      out.push(card);
    });
  }
  out.sort((a, b) => a.from - b.from || a.time.localeCompare(b.time));
  return out.map(r => ({ ...r, key: rangeKey(r.from, r.to) }));
}
