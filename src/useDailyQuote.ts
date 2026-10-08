import { useEffect, useState } from 'react';

export interface DailyQuote { day: string; text: string; from: string; uuid: string }
const CACHE_KEY = 'personal-workspace-daily-quote-v1';
export const QUOTE_API = 'https://v1.hitokoto.cn/?c=d&c=i&c=k&min_length=6&max_length=40';
const pending = new Map<string, Promise<DailyQuote>>();
let memory: DailyQuote | null = null;

export function parseQuote(value: unknown, day: string): DailyQuote {
  const raw = value as Record<string, unknown> | null;
  if (!raw || typeof raw.hitokoto !== 'string' || !raw.hitokoto.trim() || raw.hitokoto.length > 200) throw new Error('每日一言格式无效');
  return { day, text: raw.hitokoto.trim(), from: typeof raw.from === 'string' ? raw.from : '一言', uuid: typeof raw.uuid === 'string' && /^[\da-f-]{36}$/i.test(raw.uuid) ? raw.uuid : '' };
}

function readCache(): DailyQuote | null {
  try {
    const raw = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null');
    if (raw && typeof raw.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.day) && typeof raw.text === 'string' && raw.text.trim() && raw.text.length <= 200 && typeof raw.from === 'string' && typeof raw.uuid === 'string') return raw;
  } catch { /* An unavailable cache must not prevent the API request. */ }
  return memory;
}

export function fetchDailyQuote(day: string): Promise<DailyQuote> {
  const cached = readCache();
  if (cached?.day === day) return Promise.resolve(cached);
  const active = pending.get(day);
  if (active) return active;
  const request = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(QUOTE_API, { signal: controller.signal });
      if (!response.ok) throw new Error('每日一言暂时无法连接');
      const quote = parseQuote(await response.json(), day);
      memory = quote;
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(quote)); } catch { /* Use memory when storage is full or disabled. */ }
      return quote;
    } finally { clearTimeout(timeout); pending.delete(day); }
  })();
  pending.set(day, request);
  return request;
}

export function useDailyQuote(day: string) {
  const [quote, setQuote] = useState(readCache);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true); setFailed(false);
    void fetchDailyQuote(day).then(value => { if (active) setQuote(value); }).catch(() => { if (active) setFailed(true); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [day, attempt]);
  useEffect(() => {
    const retry = () => { if (failed) setAttempt(value => value + 1); };
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  }, [failed]);
  return { quote, loading, failed, retry: () => setAttempt(value => value + 1) };
}
