type Limits = { perMinute: number; perDay: number };

const store = new Map<string, { minute: { window: number; count: number }; day: { window: number; count: number } }>();

function getKey(userId: string) {
  return `u:${userId || 'anon'}`;
}

export function rateLimiter(limits?: Partial<Limits>) {
  const perMinute = limits?.perMinute ?? Number(process.env.RATE_LIMIT_PER_MINUTE || 60);
  const perDay = limits?.perDay ?? Number(process.env.RATE_LIMIT_PER_DAY || 500);
  return (req: any, res: any, next: any) => {
    const uid = (req as any).user?.uid || 'anon';
    const key = getKey(uid);
    const now = Date.now();
    const minuteWindow = Math.floor(now / 60000);
    const dayWindow = Math.floor(now / (24 * 60 * 60000));
    const cur = store.get(key) || { minute: { window: minuteWindow, count: 0 }, day: { window: dayWindow, count: 0 } };
    if (cur.minute.window !== minuteWindow) cur.minute = { window: minuteWindow, count: 0 };
    if (cur.day.window !== dayWindow) cur.day = { window: dayWindow, count: 0 };
    cur.minute.count += 1;
    cur.day.count += 1;
    store.set(key, cur);
    const remainingMinute = Math.max(0, perMinute - cur.minute.count);
    const remainingDay = Math.max(0, perDay - cur.day.count);
    res.setHeader('X-RateLimit-Limit', `${perMinute}/min, ${perDay}/day`);
    res.setHeader('X-RateLimit-Remaining', `${remainingMinute}/min, ${remainingDay}/day`);
    if (cur.minute.count > perMinute || cur.day.count > perDay) {
      const retryAfter = 60 - (now / 1000) % 60;
      res.setHeader('Retry-After', Math.ceil(retryAfter).toString());
      res.status(429).json({ error: 'Rate limit exceeded' });
      return;
    }
    next();
  };
}