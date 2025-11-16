import { describe, it, expect } from 'vitest';
import { sanitizeSample } from '../src/utils/sanitize';

describe('sanitizeSample', () => {
  it('masks email, phone and Aadhaar', () => {
    const cols = ['email', 'phone', 'aadhaar', 'name'];
    const rows = [{ email: 'a@b.com', phone: '+91 9876543210', aadhaar: '1234 5678 9012', name: 'X' }];
    const res = sanitizeSample(cols, rows);
    expect(res.piiDetected).toBe(true);
    expect(String(res.rows[0].email)).toMatch(/\*+/);
    expect(String(res.rows[0].phone)).toMatch(/\*+/);
    expect(String(res.rows[0].aadhaar)).toMatch(/\*+/);
    expect(res.rows[0].name).toBe('X');
  });
});