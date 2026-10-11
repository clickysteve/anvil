// Type declarations for the vendored Good Bits js/outputstage.js (see ../vendor.json).
export interface OutputStageInfo { key: string; label: string; description: string }
export const OUTPUT_STAGES: OutputStageInfo[];
export const DRIVE_TYPES: OutputStageInfo[];
export interface GoodBitsRng { white(): number; uniform(): number }
export type StereoProcessor = (L: number, R: number) => [number, number];
export const MODE_FACTORIES: Record<string, (fs: number, rng: GoodBitsRng) => StereoProcessor>;
export function makeRng(seed: number): GoodBitsRng;
export function driveShapeFor(key: string): (x: number, g: number, d: number) => number;
export function makeOnePoleLP(fs: number, fc: number): (x: number) => number;
export function deriveRegionSeed(baseSeed: number, index: number): number;
export function applyOutputStage(channels: Float32Array[], sampleRate: number, modeKey: string, mixPct?: number, intensityPct?: number, seed?: number): Float32Array[];
export function applyDrive(channels: Float32Array[], driveKey: string, amountPct?: number): Float32Array[];
export function applyCrunch(channels: Float32Array[], opts?: { bits?: number; rateDivide?: number }): Float32Array[];
export interface LofiSettings {
  outputStage?: { enabled: boolean; mode: string; mixPct: number; intensityPct: number };
  drive?: { enabled: boolean; type: string; amountPct: number };
  crunch?: { enabled: boolean; bits: number; rateDivide: number };
}
export function applyLofiChain(channels: Float32Array[], sampleRate: number, settings?: LofiSettings, seed?: number): Float32Array[];
