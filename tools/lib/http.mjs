/**
 * Загрузка страниц площадок обычными HTTP-запросами.
 * Браузер не нужен: все три сайта отдают данные в HTML или в JSON.
 */
import https from 'node:https';
import http from 'node:http';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
           '(KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36';

export class HttpError extends Error {
  constructor(url, status) {
    super(String(status) + ' ' + url);
    this.url = url;
    this.status = status;
  }
  /** Человеческое описание причины — без него сбой выглядит как пустая строка. */
  get reason() { return this.detail || this.message; }
}

/** GET с редиректами, таймаутом и повторами. Возвращает тело строкой. */
export function get(url, { timeout = 30000, retries = 3, headers = {} } = {}) {
  return attempt(0);

  function attempt(n) {
    return new Promise((res, rej) => {
      const mod = url.startsWith('http://') ? http : https;
      const req = mod.get(url, {
        headers: { 'User-Agent': UA, 'Accept-Language': 'ru-RU,ru;q=0.9', ...headers },
        timeout
      }, r => {
        if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
          r.resume();
          return get(new URL(r.headers.location, url).toString(), { timeout, retries, headers }).then(res, rej);
        }
        const cs = [];
        r.on('data', c => cs.push(c));
        r.on('end', () => {
          const body = Buffer.concat(cs).toString('utf8');
          if (r.statusCode !== 200) {
            const e = new HttpError(url, r.statusCode);
            e.detail = 'HTTP ' + r.statusCode;
            return rej(e);
          }
          if (!body.trim()) {
            // Пустой ответ — это не повод молча идти дальше: так страница может остаться без данных.
            const e = new HttpError(url, 'пустой ответ');
            e.detail = 'сервер вернул 0 байт';
            return rej(e);
          }
          res(body);
        });
      });
      // Обрыв ответа посередине (обрыв связи, редирект без location) НЕ ловится обработчиком
      // error — раньше это приводило к зависшему promise, и сбой превращался в пустую строку.
      req.on('aborted', () => {
        const e = new HttpError(url, 'ответ прерван');
        e.detail = 'соединение закрыто, не дождались конца ответа';
        req.destroy(e);
      });
      req.on('timeout', () => req.destroy(Object.assign(new Error('таймаут ' + timeout + ' мс'), { url })));
      req.on('error', e => {
        if (n < retries) {
          const wait = 800 * Math.pow(2, n);
          setTimeout(() => attempt(n + 1).then(res, rej), wait);
        } else {
          // node выдаёт часть ошибок без message — подставляем описание, иначе причина сбоя
          // выглядит как пустая строка и непонятно, что чинить.
          if (!e.message) e.message = e.code || 'сетевая ошибка без описания';
          if (!e.url) e.url = url;
          rej(e);
        }
      });
    });
  }
}

/** GET, разбирающий ответ как JSON. */
export async function getJson(url, opts) {
  return JSON.parse(await get(url, { ...opts, headers: { Accept: 'application/json, text/plain, */*', ...(opts && opts.headers) } }));
}
