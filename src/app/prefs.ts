/**
 * Application preferences: things that belong to this browser and this setup, not to a piece
 * of music. MIDI port choices describe the user's hardware; the palette is a visual choice.
 * None of this is saved in project files.
 */
import type { ClockSource } from '../transport/transport';

export interface AppPrefs {
  version: 1;
  palette: string;
  outputId: string | null;
  /** null = clock goes to the note output */
  clockOutputId: string | null;
  inputId: string | null;
  clockSource: ClockSource;
  clockOut: boolean;
  audioPreview: boolean;
  previewVolume: number;
  tips: boolean;
  sideTab: string;
}

export const defaultPrefs = (): AppPrefs => ({
  version: 1,
  palette: 'classic',
  outputId: null,
  clockOutputId: null,
  inputId: null,
  clockSource: 'internal',
  clockOut: false,
  audioPreview: false,
  previewVolume: 0.5,
  tips: true,
  sideTab: 'midi',
});

export interface PrefStore {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

const KEY = 'anvil.prefs';

export function loadPrefs(store: PrefStore | null): AppPrefs {
  const d = defaultPrefs();
  try {
    const raw = store?.getItem(KEY);
    const o = raw ? JSON.parse(raw) : {};
    if (!o || typeof o !== 'object') return d;
    const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
    return {
      version: 1,
      palette: typeof o.palette === 'string' ? o.palette : d.palette,
      outputId: str(o.outputId),
      clockOutputId: str(o.clockOutputId),
      inputId: str(o.inputId),
      clockSource: o.clockSource === 'external' ? 'external' : 'internal',
      clockOut: o.clockOut === true,
      audioPreview: o.audioPreview === true,
      previewVolume: typeof o.previewVolume === 'number' ? Math.max(0, Math.min(1, o.previewVolume)) : d.previewVolume,
      tips: o.tips !== false,
      sideTab: typeof o.sideTab === 'string' ? o.sideTab : d.sideTab,
    };
  } catch {
    return d;
  }
}

export function savePrefs(store: PrefStore | null, p: AppPrefs): void {
  try {
    store?.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage blocked: preferences last for this session only */
  }
}
