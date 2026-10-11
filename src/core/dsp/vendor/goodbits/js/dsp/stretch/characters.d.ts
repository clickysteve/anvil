// Type declarations for the vendored Good Bits js/dsp/stretch/characters.js (see ../../../vendor.json).
export interface StretchCharacter {
  label: string;
  group: string;
  engine: string;
  description: string;
  params: Record<string, unknown>;
  macros?: string[];
  macroFamily?: string;
  usesSeed?: boolean;
  preservesPitch?: boolean;
  maxRatio?: number;
  legacy?: boolean;
}
export const GROUPS: { key: string; label: string }[];
export const MACROS: Record<string, { label: string; hint: string; default: number }>;
export const CHARACTERS: Record<string, StretchCharacter>;
export function resolveCharacter(key: string): StretchCharacter;
export function resolveCharacterParams(character: StretchCharacter, macroValues?: Record<string, number>): Record<string, unknown>;
export function characterGroups(): { key: string; label: string; characters: (StretchCharacter & { key: string })[] }[];
