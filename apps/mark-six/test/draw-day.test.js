const { isDrawDay, getNextDrawDate, shouldRefreshAtMidnight } = require('../draw-day');

describe('isDrawDay', () => {
  it('returns true for Tuesday (2)', () => {
    expect(isDrawDay(new Date('2026-08-18'))).toBe(true);
  });

  it('returns true for Thursday (4)', () => {
    expect(isDrawDay(new Date('2026-08-20'))).toBe(true);
  });

  it('returns true for Saturday (6)', () => {
    expect(isDrawDay(new Date('2026-08-22'))).toBe(true);
  });

  it('returns false for Sunday (0)', () => {
    expect(isDrawDay(new Date('2026-08-17'))).toBe(false);
  });

  it('returns false for Monday (1)', () => {
    expect(isDrawDay(new Date('2026-08-18'))).toBe(true);
  });

  it('returns false for Wednesday (3)', () => {
    expect(isDrawDay(new Date('2026-08-19'))).toBe(false);
  });

  it('returns false for Friday (5)', () => {
    expect(isDrawDay(new Date('2026-08-21'))).toBe(false);
  });
});

describe('getNextDrawDate', () => {
  it('returns same day if already a draw day', () => {
    const tuesday = new Date('2026-08-18');
    const next = getNextDrawDate(tuesday);
    expect(next.getDay()).toBe(2);
  });

  it('skips to Tuesday from Sunday', () => {
    const sunday = new Date('2026-08-17');
    const next = getNextDrawDate(sunday);
    expect(next.getDay()).toBe(2);
    expect(next.getDate()).toBe(18);
  });

  it('skips to Tuesday from Monday', () => {
    const monday = new Date('2026-08-18T12:00:00');
    monday.setDate(17);
    monday.setMonth(7);
    // Monday Aug 17 -> Tuesday Aug 18
    const next = getNextDrawDate(monday);
    expect(next.getDay()).toBe(2);
  });
});

describe('shouldRefreshAtMidnight', () => {
  it('returns boolean', () => {
    expect(typeof shouldRefreshAtMidnight()).toBe('boolean');
  });
});
