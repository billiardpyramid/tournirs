/**
 * Bill4you — bill4you.ru, раздел «Русский бильярд».
 *
 * Список турниров рисует скрипт, но данные лежат в обычном JSON:
 *   https://bill4you.ru/bff/rus-billiard/tournaments?dateFrom=…&dateTo=…&page=1&per_page=50
 * Ответ: { items: [...], _meta: { totalCount, pageCount, currentPage }, _links: {...} }
 *
 * Эндпоинт /api/v2/tournaments отдаёт всего 20 записей без пагинации — не использовать.
 * Поле gameKind в ответе пустое, поэтому вид дисциплины берём из заголовка.
 */
import { getJson } from './http.mjs';
import { clean, pyramidKind, isPyramidOnly, rangeKey, nowMsk } from './util.mjs';

const BFF = 'https://bill4you.ru/bff/rus-billiard/tournaments';
const HEADERS = { Referer: 'https://bill4you.ru/rus-billiard/tournament' };

/** Горизонт расписания: от сегодняшнего дня до конца следующего месяца. */
export function window3m(now = new Date()) {
  const from = nowMsk(now);
  const to = new Date(Date.UTC(from.y, from.m - 1 + 3, 0));
  return {
    dateFrom: `${from.y}-${String(from.m).padStart(2, '0')}-${String(from.d).padStart(2, '0')}`,
    dateTo: `${to.getUTCFullYear()}-${String(to.getUTCMonth() + 1).padStart(2, '0')}-${String(to.getUTCDate()).padStart(2, '0')}`
  };
}

export async function fetchB4y() {
  const { dateFrom, dateTo } = window3m();
  const per = 50;
  const items = [];
  let pages = 1;

  for (let page = 1; page <= Math.min(pages, 12); page++) {
    const url = `${BFF}?dateFrom=${dateFrom}&dateTo=${dateTo}&rating=false&page=${page}&per_page=${per}`;
    const j = await getJson(url, { headers: HEADERS });
    if (!Array.isArray(j.items)) break;
    items.push(...j.items);
    pages = (j._meta && j._meta.pageCount) || 1;
  }

  const out = [];
  const seen = new Set();
  for (const it of items) {
    const title = clean(it.title);
    if (!title) continue;
    const kind = pyramidKind(title);
    if (!isPyramidOnly(kind, title)) continue;
    if (it.status && /finished|cancel|отмен|заверш/i.test(it.status)) continue;

    // В BFF дата лежит в поле date (ISO со смещением), а не в dateStart, как в /api/v2/.
    let start = it.date ? new Date(it.date) : null;
    if (!start || isNaN(start)) {
      const m = title.match(/(\d{1,2})[.\s](\d{1,2})[.\s](\d{4})/);
      if (m) start = new Date(+m[3], +m[2] - 1, +m[1]);
    }
    if (!start || isNaN(start)) continue;

    const link = it.mainLink || '';
    const url = link ? (link.startsWith('http') ? link : 'https://bill4you.ru' + link) : 'https://bill4you.ru/rus-billiard/tournament';
    if (seen.has(url)) continue;
    seen.add(url);

    // В дате уже смещение +03:00, поэтому часы берём как есть — это московское время.
    const hm = String(it.date || '').match(/T(\d{2}:\d{2})/);

    out.push({
      from: start, to: start,
      time: hm ? hm[1] : '—',
      name: title,
      city: clean(it.city) || '—',
      venue: clean(it.clubName),
      kind: kind || 'пирамида',
      cnt: it.activeParticipantsCount != null ? String(it.activeParticipantsCount) : '—',
      src: 'B4Y', srcCls: 'b4y',
      url
    });
  }

  out.sort((a, b) => a.from - b.from || a.time.localeCompare(b.time));
  return out.map(r => ({ ...r, key: rangeKey(r.from, r.to) }));
}
