/** Общие мелочи: даты, московское время, фильтр пирамиды. */

const pad = n => String(n).padStart(2, '0');

/** Сейчас в Москве. На раннерах GitHub часовой пояс UTC, поэтому считаем сами. */
export function nowMsk(date = new Date()) {
  const msk = new Date(date.getTime() + 3 * 3600 * 1000);
  return {
    date: `${pad(msk.getUTCDate())}.${pad(msk.getUTCMonth() + 1)}.${msk.getUTCFullYear()}`,
    time: `${pad(msk.getUTCHours())}:${pad(msk.getUTCMinutes())}`,
    stamp: `${pad(msk.getUTCDate())}.${pad(msk.getUTCMonth() + 1)}.${msk.getUTCFullYear()}, ${pad(msk.getUTCHours())}:${pad(msk.getUTCMinutes())}`,
    y: msk.getUTCFullYear(),
    m: msk.getUTCMonth() + 1,
    d: msk.getUTCDate()
  };
}

export const dash = (d, m, y) => `${pad(d)}.${pad(m)}.${y}`;

/* ---------- Даты в формате строк таблицы ---------- */

/** "30.09.2026" + "19:00" -> "30.09" */
export function dayKey(date, time) {
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}`;
}

/**
 * Диапазон в формате сайта:
 *   29.09 | 09–12.10 | 31.10–01.11
 * Возвращает строку с тире «–», как принято в таблице.
 */
export function rangeKey(a, b) {
  // Сравниваем только по дню: во «from» может быть время начала (19:00), а в «to» — нет,
  // и простое сравнение дат выдавало бы «30–30.09» вместо «30.09».
  const sameDay = !b || (a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate());
  if (sameDay) return dayKey(a);
  const am = a.getMonth() + 1, bm = b.getMonth() + 1;
  if (am === bm) return `${pad(a.getDate())}–${pad(b.getDate())}.${pad(am)}`;
  return `${dayKey(a)}–${dayKey(b)}`;
}

/** Разбор "ДД.ММ.ГГГГ - ДД.ММ.ГГГГ" -> [Date, Date] */
export function parseRuRange(s, year) {
  const nums = String(s).match(/\d{1,2}\.\d{1,2}\.\d{4}/g) || [];
  if (!nums.length) return null;
  const toDate = t => {
    const [d, m, y] = t.split('.').map(Number);
    return new Date(y, m - 1, d);
  };
  const a = toDate(nums[0]);
  const b = nums.length > 1 ? toDate(nums[1]) : new Date(a);
  if (year && a.getFullYear() !== year && !nums[0].includes('.' + year)) return null;
  return [a, b];
}

/** Год по умолчанию для дат без года («09.10.26»). */
export function yy(s) { const m = String(s).match(/(\d{2})\.(\d{2})\.(\d{2,4})/); return m ? +m[3] : null; }

/* ---------- Фильтр «только пирамида» ---------- */

const PYRAMID = /пирамид/i;
/** Виды, которые на площадках идут рядом, но в сайт не входят. */
const NOT_PYRAMID = /пул|снукер|карамболь|дартс|фишк|аркада|billiard pool|динамичн/i;

/**
 * Определяет вид пирамиды по текстам названия и дисциплины.
 * Возвращает null, если это не пирамида.
 */
export function pyramidKind(...texts) {
  const t = texts.filter(Boolean).join(' ');
  if (!t) return null;
  if (!PYRAMID.test(t)) {
    // «омка» — тоже пирамида, но слово «пирамида» в названии может отсутствовать
    if (/омк/i.test(t)) return 'омка';
    return null;
  }
  if (/комбинированн/i.test(t)) return 'комбинированная';
  if (/динамичн/i.test(t)) return 'динамичная';
  if (/свободн/i.test(t)) return /продолж/i.test(t) ? 'свободная с продолж.' : 'свободная';
  if (/омк/i.test(t)) return 'омка';
  return 'пирамида';
}

/** Отсеивает не-пирамиду (пул/снукер/…). */
export function isPyramidOnly(kind, ...texts) {
  if (kind) return true;
  const t = texts.filter(Boolean).join(' ');
  return /пирамид|омк/i.test(t) && !NOT_PYRAMID.test(t);
}

/* ---------- Города ---------- */

/**
 * Площадки пишут город по-разному: «ЛЛБ. Калининград. Пирамида № 21»,
 * «ЛЛБ 2026. Санкт-Петербург. Пирамида № 34», «Ташкент 2026. LIDER…».
 * Надёжнее опознать город по списку, чем гадать по позиции в строке.
 */
const CITY_LIST = `
Москва Санкт-Петербург Ленинград Калининград Казань Набережные Челны Новосибирск Омск Екатеринбург
Новокузнецк Красноярск Пермь Уфа Челябинск Самара Оренбург Ростов-на-Дону Воронеж Волгоград Саратов
Тихорецк Краснодар Ижевск Пенза Ульяновск Ярославль Тверь Тула Рязань Липецк Владмир Курск Белгород
Воронеж Кемерово Барнаул Томск Омск Иркутск Чита Хабаровск Владивосток Благовещенск Сургут Тюмень
Магнитогорск Нижний Новгород Дзержинск Арзамас Ковров Муром Архангельск Вологда Петрозаводск Мурманск
Набережный Челны Нефтеюганск Сургут Нижневартовск Норильск Тольятти Самарка Сызрань Орск Новотроицк
Курган Омск Абакан Кызыл Горно-Алтайск Барнаул Бийск Рубцовск Симферополь Севастополь Керчь
Брянск Смоленск Гомель Минск Брест Витебск Гродно Могилев
Ташкент Душанбе Самарканд Алматы Астана Бишкек Ереван Тбилиси Баку
Чехов Серпухов Подольск Мытищи Балашиха Люберцы Химки Одинцово Тверь Клин Дмитров
Зеленоград Троицк Щербинка Лыткарино Красногорск Химки Домодедово Раменское Люберецы
Обнинск Заречный Лянтор Байкалово Северск Кольпино Гатчина Пушкин Колпино Выборг Кингисепп
Апатиты Мончегорск Онега Котлас Сыктывкар Печора Воркута Ухта Норильск
`.trim().split(/\s+/).filter(Boolean);

/** Нормализованная форма для сравнения: без ё, нижний регистр. */
const fold = s => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9\- ]/gi, ' ').replace(/\s+/g, ' ').trim();

/**
 * Падежные формы названия: «Санкт-Петербург» встречается как «Санкт-Петербурга»,
 * «Новосибирск» как «Новосибирска», «Казань» как «Казани».
 */
function forms(city) {
  const out = new Set([city]);
  const add = s => { if (s && s.length > 2) out.add(s); };
  if (/а$/.test(city)) {
    const st = city.slice(0, -1);
    [city + 'а', city + 'у', city + 'е', city + 'ой', st + 'ы', st + 'е', st + 'у', st + 'ою', st + 'их', st + 'им'].forEach(add);
  } else if (/ь$/.test(city)) {
    const st = city.slice(0, -1);
    [city + 'и', city + 'ю', st + 'и', st + 'ю', st + 'ей'].forEach(add);
  } else if (/й$/.test(city)) {
    const st = city.slice(0, -1);
    [city + 'а', city + 'у', city + 'е', city + 'ом', st + 'ого', st + 'ой'].forEach(add);
  } else {
    [city + 'а', city + 'у', city + 'е', city + 'ом', city + 'ы', city + 'ов'].forEach(add);
  }
  return [...out];
}

/**
 * Ищет город в строке. Возвращает название в исходном написании или ''.
 * Сначала ищем самое длинное совпадение, чтобы «Санкт-Петербург» не превратилось в «Петербург».
 */
export function findCity(...texts) {
  const t = fold(texts.filter(Boolean).join(' '));
  if (!t) return '';
  let best = '';
  for (const c of CITY_LIST) {
    if (c.length <= best.length) continue;
    const hit = forms(fold(c)).some(f =>
      new RegExp('(^|[^a-zа-я0-9])' + f.replace(/[-]/g, '[- ]?') + '([^a-zа-я0-9]|$)', 'i').test(t));
    if (hit) best = c;
  }
  return best;
}

/* ---------- Отбор по времени ---------- */

/**
 * Турнир уже начался? Пользователю нужны только те, что ещё не стартовали.
 * Если время известно — сравниваем с текущим моментом; если нет (МСБС отдаёт
 * только даты) — сравниваем по дню, чтобы турнир сегодняшнего дня не пропал.
 */
export function hasStarted(r, now = new Date()) {
  const from = r.from instanceof Date ? r.from : new Date(r.from);
  if (isNaN(from)) return true;
  if (/^\d{1,2}:\d{2}$/.test(String(r.time || ''))) return from.getTime() < now.getTime();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return from.getTime() < today.getTime();
}

/* ---------- Текст ---------- */
export const clean = s => String(s == null ? '' : s)
  .replace(/\s+/g, ' ')
  .replace(/ /g, ' ')
  .trim();

/** Экранирование для вставки в HTML и в JS-литерал. */
export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Безопасный JS-литерал строки (для вставки массива в <script>). */
export function jsStr(s) {
  return '"' + String(s == null ? '' : s)
    .replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    .replace(/\n/g, '\\n').replace(/\r/g, '\\r')
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029') + '"';
}
