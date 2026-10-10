/** MIDI byte constants and human-readable descriptions for the monitor. */

export const CLOCK = 0xf8;
export const START = 0xfa;
export const CONTINUE = 0xfb;
export const STOP = 0xfc;
export const ACTIVE_SENSING = 0xfe;
export const RESET = 0xff;
export const SPP = 0xf2;

export const noteOn = (ch: number, note: number, vel: number): number[] => [0x90 | ((ch - 1) & 15), note & 127, Math.max(1, vel & 127)];
export const noteOff = (ch: number, note: number): number[] => [0x80 | ((ch - 1) & 15), note & 127, 0];
export const cc = (ch: number, n: number, v: number): number[] => [0xb0 | ((ch - 1) & 15), n & 127, v & 127];

export function isRealtime(status: number): boolean {
  return status >= 0xf8;
}

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const noteName = (n: number) => NAMES[n % 12] + (Math.floor(n / 12) - 1);

/** One-line description of a MIDI message. */
export function describe(bytes: ArrayLike<number>): string {
  const s = bytes[0] ?? 0;
  switch (s) {
    case CLOCK: return 'Clock (F8)';
    case START: return 'Start (FA)';
    case CONTINUE: return 'Continue (FB)';
    case STOP: return 'Stop (FC)';
    case ACTIVE_SENSING: return 'Active sensing';
    case RESET: return 'System reset';
    case SPP: return `Song position ${(bytes[1] ?? 0) + ((bytes[2] ?? 0) << 7)}`;
  }
  const ch = (s & 15) + 1;
  switch (s & 0xf0) {
    case 0x80: return `ch${ch} Note off ${noteName(bytes[1] ?? 0)}`;
    case 0x90:
      return (bytes[2] ?? 0) === 0 ? `ch${ch} Note off ${noteName(bytes[1] ?? 0)}` : `ch${ch} Note on ${noteName(bytes[1] ?? 0)} vel ${bytes[2]}`;
    case 0xa0: return `ch${ch} Poly pressure`;
    case 0xb0: return `ch${ch} CC${bytes[1]} = ${bytes[2]}`;
    case 0xc0: return `ch${ch} Program ${(bytes[1] ?? 0) + 1}`;
    case 0xd0: return `ch${ch} Channel pressure`;
    case 0xe0: return `ch${ch} Pitch bend`;
  }
  return Array.from(bytes).map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
}

export function hex(bytes: ArrayLike<number>): string {
  return Array.from(bytes).map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
}
