/**
 * Slop Factory Core: shared audio, sampling, processing, rendering, export and storage for
 * browser music applications. One package, separate modules; nothing here knows which
 * application uses it. See docs/SLOP-FACTORY-CORE.md.
 */

// events: the common musical event representation
export { constantTempo, eventsForVoices, lastTick, normaliseTempo, NotePairer, sortEvents, TimeMap, validateTimeline } from './events/timeline';
export type { ControlEvent, MusicEvent, NoteEvent, TempoChange, TempoMap, Tick, Timeline, TimelineProblem, VoiceInfo } from './events/timeline';

// audio: instruments, routing, note playback
export { fadeOut } from './audio/instrument';
export type { Instrument, NoteHandle, NoteRequest } from './audio/instrument';
export { defaultStrip, Mixer, stripSeed } from './audio/mixer';
export type { MixerOptions, StripSettings } from './audio/mixer';
export { NotePlayer } from './audio/player';
export type { NoteStart, ResolveInstrument } from './audio/player';

// sampler
export { defaultZone, MIN_LOOP_SECONDS, noteName, parseNoteName, playbackRate, region, repairZone, velocityGain, zoneProblems } from './sampler/zone';
export type { PlayMode, Region, SampleZone } from './sampler/zone';
export { SampleInstrument } from './sampler/instrument';
export { browserDecode, decodeSample, MAX_SAMPLE_BYTES, MAX_SAMPLE_SECONDS, SampleError, toAudioBuffer } from './sampler/decode';
export type { DecodedSample, DecodeOptions, SampleErrorCode } from './sampler/decode';
export { peakOf, snapToZeroCrossing, waveformPeaks } from './sampler/edit';

// dsp: output processing (live and offline) and sample transformations
export { cleanFx, DRIVE_SHAPES, FX_PRESETS, fxLabel, isClean, matchPreset, OUTPUT_STAGE_MODES, repairFx } from './dsp/output/settings';
export type { CrunchSettings, DriveSettings, FxPreset, OutputFxSettings, OutputStageSettings, ToneSettings } from './dsp/output/settings';
export { createChain, OutputFxStream, processBuffers, SETTINGS_FADE } from './dsp/output/stream';
export { createOutputFxNode, loadOutputFx, outputFxAvailable } from './dsp/output/node';
export type { OutputFxNode } from './dsp/output/node';
export { OUTPUT_FX_PROCESSOR } from './dsp/output/constants';
export { identityTransform, isIdentity, MACRO_INFO, repairTransform, stretchCharacters, toRecipe, transformKey } from './dsp/transform/settings';
export type { ReverseMode, SampleTransform } from './dsp/transform/settings';
export { applyTransform } from './dsp/transform/transform';
export type { AudioData } from './dsp/transform/transform';
export { syncRunner, TransformCache, WorkerTransformRunner } from './dsp/transform/cache';
export type { TransformRunner } from './dsp/transform/cache';

// render and export
export { EXPORT_SAMPLE_RATE, MAX_RENDER_SECONDS, planRenders, RenderCancelled, renderLength, renderTimeline } from './render/offline';
export type { RenderOutput, RenderRequest, RenderResult, StemRequest } from './render/offline';
export { encodeWav16, levelStats, wavInfo } from './export/wav';
export type { LevelStats, WavInfo } from './export/wav';
export { crc32, createZip, readZip } from './export/zip';
export type { ZipEntry } from './export/zip';
export { fileName, slug, uniqueNames } from './export/names';

// storage
export { IndexedDbSampleStore, MemorySampleStore, sampleFromBytes, sha256Hex, StorageError } from './storage/samples';
export type { SampleMeta, SampleStore, StorageErrorCode, StoredSample } from './storage/samples';
export { BUNDLE_FORMAT, BUNDLE_VERSION, readBundle, writeBundle } from './storage/bundle';
export type { BundleContents, BundleManifest } from './storage/bundle';

// midi: interfaces only (design for the shared MIDI foundation; see docs/MIDI-FOUNDATION.md)
export type { ClockFollower, ClockSource, LearnMapping, LearnableParameter, MidiInputPort, MidiOutputPort, MidiPortInfo, ParameterRegistry } from './midi/interfaces';
