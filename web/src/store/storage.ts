import type { StateStorage } from 'zustand/middleware';

// Persistence is optional: blocked storage or exhausted quota must not stop a job
// or prevent navigation. Zustand continues to hold the current state in memory.
export const browserStorage = {
  getItem(name) {
    try { return localStorage.getItem(name); } catch { return null; }
  },
  setItem(name, value) {
    try { localStorage.setItem(name, value); } catch { /* Keep this session usable. */ }
  },
  removeItem(name) {
    try { localStorage.removeItem(name); } catch { /* Storage may be disabled. */ }
  },
} satisfies StateStorage;
