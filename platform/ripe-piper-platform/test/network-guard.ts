import { beforeEach, vi } from 'vitest';
beforeEach(() => {
  vi.stubGlobal('fetch', () => { throw new Error('Unmocked network access blocked: tests must use synthetic providers'); });
});
