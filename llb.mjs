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
import { get } from './http.mjs';
import { clean, pyramidKind, isPyramidOnly, rangeKey, nowMsk, findCity } from './util.mjs';

const BASE = 'https://www.llb.su';
const NEXT = BASE + '/tournaments/next?page=';
const ONLINE = BASE + '/tournaments/online';

function yearFromText(t) {
  const m = String(t).match(/\b(20\d{2})\b/);
  return m ? +m[1] : null;
}

function parseCard($tr) {
  const $a = $tr.find('div.comp-teaser.links-new a[href*="/t/"]').first();
  if (!$a.length) return null;
  const href = $a.attr('href') || '';
  const id = (href.match(/\/t\/(\d+)/) || [])[1];
  if (!id) return null;

  const name = clean($a.text());
  const dateCell = clean($tr.find('td.date').first().text());
  const d = (dateCell.match(/(\d{2})\.(\d{2})\.(\d{2,4})/) || [])[1];
  const mo = (dateCell.match(/(\d{2})\.(\d{2})\.(\d{2,4})/) || [])[2];
  const yy = (dateCell.match(/(\d{2})\.(\d{2})\.(\d{2,4})/) || [])[3];
  const time = (dateCell.match(/(\d{1,2}:\d{2})/) || [])[1] || '';
  if (!d || !mo) return null;

  const year = yy ? (+yy < 100 ? 2000 + +yy : +yy) : (yearFromText(name) || nowMsk().y);
  const start = new Date(year, +mo - 1, +d);

  const club = clean($tr.find('a.club-link').first().text());
  const partsLink = $tr.find('a.parts-link').first();
  let cnt = clean(partsLink.text());
  const title = partsLink.attr('title') || '';
  const reg = title.match(/Участники:\s*(\d+)\s*из\s*(\d+)/);
  if (reg) cnt = reg[1] + ' / ' + reg[2];
  if (!/^\d/.test(cnt)) cnt = '—';

  const kind = pyramidKind(name);
  if (!isPyramidOnly(kind, name)) return null;

  return {
    from: start, to: start,
    time: time || '—',
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
  pages.push(ONLINE);

  const seen = new Set();
  const out = [];
  for (const url of pages) {
    const html = await get(url);
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
