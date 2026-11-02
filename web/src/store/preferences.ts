import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

interface LocalLearning {
  samples: number;
  inputBytes: number;
  outputBytes: number;
  durationMs: number;
}

interface Preferences {
  privacyChoice: 'essential' | 'learning' | null;
  rememberHistory: boolean;
  learning: LocalLearning;
  setPrivacyChoice: (choice: 'essential' | 'learning') => void;
  setRememberHistory: (enabled: boolean) => void;
  recordOutcome: (input: number, output: number, duration: number) => void;
  clearLearning: () => void;
}

const emptyLearning = (): LocalLearning => ({
  samples: 0,
  inputBytes: 0,
  outputBytes: 0,
  durationMs: 0,
});

/** On-device aggregates only. This store never sends network requests or stores file names. */
export const usePreferences = create<Preferences>()(
  persist(
    (set, get) => ({
      privacyChoice: null,
      rememberHistory: true,
      learning: emptyLearning(),
      setPrivacyChoice: (privacyChoice) =>
        set({
          privacyChoice,
          ...(privacyChoice === 'essential'
            ? { learning: emptyLearning() }
            : {}),
        }),
      setRememberHistory: (rememberHistory) => set({ rememberHistory }),
      recordOutcome: (input, output, duration) => {
        if (
          get().privacyChoice !== 'learning' ||
          ![input, output, duration].every(Number.isFinite) ||
          input <= 0 ||
          output < 0 ||
          duration <= 0
        )
          return;
        set((state) => {
          // Bound aggregate growth without retaining individual observations.
          const scale = state.learning.samples >= 100 ? 0.99 : 1;
          return {
            learning: {
              samples: Math.min(100, state.learning.samples + 1),
              inputBytes: state.learning.inputBytes * scale + input,
              outputBytes: state.learning.outputBytes * scale + output,
              durationMs: state.learning.durationMs * scale + duration,
            },
          };
        });
      },
      clearLearning: () => set({ learning: emptyLearning() }),
    }),
    {
      name: 'hamma-preferences',
      storage: createJSONStorage(() => localStorage),
    },
  ),
);

/** Only application-owned Cache Storage entries; never clears unrelated origin caches. */
export async function clearApplicationCache(): Promise<number> {
  if (typeof globalThis.caches === 'undefined') return 0;
  const names = (await caches.keys()).filter((name) =>
    /^(hamma|spk)[-:]/i.test(name),
  );
  const deleted = await Promise.all(names.map((name) => caches.delete(name)));
  return deleted.filter(Boolean).length;
}
