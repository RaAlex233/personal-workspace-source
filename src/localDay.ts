import { useEffect, useState } from 'react';

export const dateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

// A shared local day keeps quotes, check-ins and statistics aligned across midnight.
export function useLocalDay() {
  const [day, setDay] = useState(() => dateKey(new Date()));
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;
    const sync = () => {
      clearTimeout(timeout);
      setDay(dateKey(new Date()));
      const midnight = new Date(); midnight.setHours(24, 0, 0, 0);
      timeout = setTimeout(sync, Math.max(100, midnight.getTime() - Date.now() + 50));
    };
    sync();
    window.addEventListener('focus', sync);
    document.addEventListener('visibilitychange', sync);
    return () => { clearTimeout(timeout); window.removeEventListener('focus', sync); document.removeEventListener('visibilitychange', sync); };
  }, []);
  return day;
}
