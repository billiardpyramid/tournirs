/**
 * МСБС — Московский союз бильярдного спорта, mosbilliard.ru/calen/
 *
 * Обычная таблица #ts_finstand. Строки: заголовок, разделитель месяца (tr.separator)
 * и турниры. У турнира 5 ячеек:
 *   Организатор | Название | Даты проведения | Дисциплина | Место проведения
 *
 * Отдельных страниц турниров у площадки нет вообще. Единственное, что ведёт
 * на конкретный турнир, — PDF/DOC регламента в /upload/iblock/… внутри строки.
 */
import * as cheerio from 'cheerio';
import { get, patient } from './http.mjs';
import { clean, pyramidKind, isPyramidOnly, rangeKey, parseRuRange, nowMsk } from './util.mjs';

const CAL = 'https://mosbilliard.ru/calen/';
const THIS_YEAR = nowMsk().y;

function splitPlace(place) {
  // В ячейке бывает «ДБС «Москвич»», «Касимов (Рязанская обл.)» или «Новосибирск, …».
  // Площадка — это то, что в кавычках или со словом «клуб/дворец/центр».
  const s = clean(place);
  if (!s) return { city: 'Москва', venue: '' };
  const parts = s.split(',').map(clean).filter(Boolean);
  const isVenue = t => /«|"|дворец|клуб|бильярд|центр|студия|зал|snooker/i.test(t);
  const city = parts.find(p => !isVenue(p));
  const venue = parts.filter(isVenue).join(', ');
  if (city) return { city, venue };
  // одной строкой и это явно площадка — почти все турниры МСБС проходят в Москве
  return { city: /москв/i.test(s) ? 'Москва' : 'Москва', venue: s };
}

export async function fetchMsbs() {
  const html = await get(CAL, patient);
  const $ = cheerio.load(html);
  const out = [];
  const seen = new Set();

  $('#ts_finstand tr').each((_, tr) => {
    const $tr = $(tr);
    if ($tr.hasClass('separator')) return;
    const cells = $tr.find('td');
    if (cells.length < 5) return;

    const year = +$tr.attr('data-year') || THIS_YEAR;
    if (year !== THIS_YEAR) return;

    const title = clean(cells.eq(1).text());
    const datesRaw = clean(cells.eq(2).text());
    const discipline = clean(cells.eq(3).text());
    const place = clean(cells.eq(4).text());
    if (!title || !datesRaw) return;

    const r = parseRuRange(datesRaw, year);
    if (!r) return;

    const kind = pyramidKind(discipline, title);
    if (!isPyramidOnly(kind, discipline, title)) return;

    const { city, venue } = splitPlace(place);
    const doc = $tr.find('a[href]')
      .map((__, a) => $(a).attr('href'))
      .get()
      .find(h => h && /^\/upload\//.test(h));

    const url = doc ? new URL(doc, 'https://mosbilliard.ru').toString() : CAL;
    const sig = title + '|' + datesRaw;
    if (seen.has(sig)) return;
    seen.add(sig);

    out.push({
      from: r[0], to: r[1],
      time: '—',
      name: title,
      city: city || 'Москва',
      venue,
      kind: kind || 'пирамида',
      cnt: '—',
      src: 'МСБС', srcCls: 'msbs',
      url
    });
  });

  out.sort((a, b) => a.from - b.from);
  return out.map(r => ({ ...r, key: rangeKey(r.from, r.to) }));
}
