/**
 * Загрузка страниц площадок обычными HTTP-запросами.
 * Браузер не нужен: все три сайта отдают данные в HTML или в JSON.
 */
import https from 'node:https';
import http from 'node:http';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
           '(KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36';

export class HttpError extends Error {
  constructor(url, status) { super(`${status} ${url}`); this.url = url; this.status = status; }
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
          if (r.statusCode !== 200) return rej(new HttpError(url, r.statusCode));
          res(body);
        });
      });
      req.on('timeout', () => req.destroy(new Error('таймаут ' + timeout + ' мс')));
      req.on('error', e => {
        if (n < retries) {
          const wait = 800 * Math.pow(2, n);
          setTimeout(() => attempt(n + 1).then(res, rej), wait);
        } else rej(e);
      });
    });
  }
}

/** GET, разбирающий ответ как JSON. */
export async function getJson(url, opts) {
  return JSON.parse(await get(url, { ...opts, headers: { Accept: 'application/json, text/plain, */*', ...(opts && opts.headers) } }));
}
