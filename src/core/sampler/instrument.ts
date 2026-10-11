/**
 * The sample instrument: plays one AudioBuffer through a zone, polyphonically, in any
 * BaseAudioContext. One AudioBuffer is shared by every note (and by live and offline
 * contexts); each note only creates a buffer source, a gain and a panner.
 */
import { fadeOut, type Instrument, type NoteHandle, type NoteRequest } from '../audio/instrument';
import { EDGE_FADE_SECONDS, playbackRate, region, velocityGain, type SampleZone } from './zone';

export class SampleInstrument implements Instrument {
  constructor(readonly buffer: AudioBuffer, public zone: SampleZone) {}

  start(ctx: BaseAudioContext, out: AudioNode, note: NoteRequest): NoteHandle | null {
    const z = this.zone;
    if (z.mute || this.buffer.length === 0) return null;
    const r = region(z, this.buffer.duration);
    const rate = playbackRate(z, note.pitch);
    const t = note.time;
    // a mono sample is panned with equal power; +3 dB keeps it at unity in each channel when centred
    const mono = this.buffer.numberOfChannels === 1;
    const peak = z.volume * velocityGain(z, note.velocity) * (mono ? Math.SQRT2 : 1);

    const src = ctx.createBufferSource();
    src.buffer = this.buffer;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    const pan = ctx.createStereoPanner();
    pan.pan.value = z.pan;
    src.connect(g).connect(pan).connect(out);

    const fadeIn = r.trimmedStart ? EDGE_FADE_SECONDS : 0;
    if (fadeIn) {
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(peak, t + fadeIn);
    } else g.gain.setValueAtTime(peak, t);

    let end: number;
    if (z.mode === 'loop') {
      src.loop = true;
      src.loopStart = r.loopStart;
      src.loopEnd = r.loopEnd;
      src.start(t, r.start);
      end = Infinity;
    } else {
      const length = r.end - r.start;
      src.start(t, r.start, length);
      end = t + length / rate;
      if (r.trimmedEnd && length / rate > EDGE_FADE_SECONDS * 2) {
        g.gain.setValueAtTime(peak, end - EDGE_FADE_SECONDS);
        g.gain.linearRampToValueAtTime(0, end);
      }
    }
    src.onended = () => {
      src.disconnect();
      g.disconnect();
      pan.disconnect();
    };

    const handle = {
      end,
      release(time: number): void {
        if (z.mode === 'oneshot' || time >= handle.end) return;
        const stopAt = Math.max(time, t) + z.release;
        fadeOut(g.gain, Math.max(time, t), z.release, peak);
        src.stop(stopAt);
        handle.end = Math.min(handle.end, stopAt);
      },
      stop(time: number): void {
        if (time >= handle.end) return;
        const at = Math.max(time, t);
        fadeOut(g.gain, at, 0.005, peak);
        src.stop(at + 0.006);
        handle.end = at + 0.006;
      },
    };
    return handle;
  }
}
