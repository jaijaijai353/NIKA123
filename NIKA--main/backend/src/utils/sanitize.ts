const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE_RE = /(?:\+\d{1,3}[\s-]?)?(?:\d[\s-]?){10,14}/g;
const AADHAAR_RE = /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g;

export type SanitizeResult = { rows: any[]; columns: string[]; piiDetected: boolean };

const mask = (s: string) => s.replace(/[A-Za-z0-9]/g, '*');

export function sanitizeSample(columns: string[], rows: any[]): SanitizeResult {
  let pii = false;
  const safeRows = rows.slice(0, 5).map((r) => {
    const out: any = {};
    for (const k of Object.keys(r || {})) {
      const v = r[k];
      const sv = typeof v === 'string' ? v : JSON.stringify(v);
      const hasEmail = EMAIL_RE.test(sv);
      const hasPhone = PHONE_RE.test(sv);
      const hasAadhaar = AADHAAR_RE.test(sv);
      const isPII = hasEmail || hasPhone || hasAadhaar;
      if (isPII) {
        pii = true;
        out[k] = mask(String(sv)).slice(0, 64);
      } else {
        out[k] = typeof v === 'string' ? v : v;
      }
      EMAIL_RE.lastIndex = 0;
      PHONE_RE.lastIndex = 0;
      AADHAAR_RE.lastIndex = 0;
    }
    return out;
  });
  const safeCols = columns.slice(0, 50);
  return { rows: safeRows, columns: safeCols, piiDetected: pii };
}