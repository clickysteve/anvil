/**
 * A minimal recording stand-in for the Web Audio API, enough to unit-test scheduling logic
 * (what is created, connected, started, stopped and automated) without a browser. Real audio
 * rendering is tested in Chrome (e2e).
 */
export type ParamEvent = [string, number, number, number?];

export class FakeParam {
  events: ParamEvent[] = [];
  constructor(public value = 0) {}
  setValueAtTime(v: number, t: number) { this.events.push(['set', v, t]); this.value = v; return this; }
  linearRampToValueAtTime(v: number, t: number) { this.events.push(['linear', v, t]); return this; }
  exponentialRampToValueAtTime(v: number, t: number) { this.events.push(['exp', v, t]); return this; }
  setTargetAtTime(v: number, t: number, c: number) { this.events.push(['target', v, t, c]); return this; }
  cancelScheduledValues(t: number) { this.events.push(['cancel', 0, t]); return this; }
  cancelAndHoldAtTime(t: number) { this.events.push(['hold', 0, t]); return this; }
}

export class FakeNode {
  out = new Set<FakeNode>();
  channelCount = 2;
  channelCountMode = 'max';
  channelInterpretation = 'speakers';
  constructor(public kind: string, public ctx: FakeContext) { ctx.nodes.push(this); }
  connect<T>(n: T): T { this.out.add(n as unknown as FakeNode); return n; }
  disconnect() { this.out.clear(); }
}

export class FakeGain extends FakeNode { gain = new FakeParam(1); constructor(c: FakeContext) { super('gain', c); } }
export class FakePanner extends FakeNode { pan = new FakeParam(0); constructor(c: FakeContext) { super('panner', c); } }
export class FakeBiquad extends FakeNode { type = 'lowpass'; frequency = new FakeParam(350); constructor(c: FakeContext) { super('biquad', c); } }

export class FakeSource extends FakeNode {
  constructor(kind: string, c: FakeContext) { super(kind, c); }
  started: { when: number; offset?: number; duration?: number } | null = null;
  stops: number[] = [];
  onended: (() => void) | null = null;
  start(when = 0, offset?: number, duration?: number) { this.started = { when, offset, duration }; }
  stop(when = 0) { this.stops.push(when); }
}
export class FakeBufferSource extends FakeSource {
  buffer: FakeBuffer | null = null;
  playbackRate = new FakeParam(1);
  loop = false;
  loopStart = 0;
  loopEnd = 0;
  constructor(c: FakeContext) { super('buffer', c); }
}
export class FakeOsc extends FakeSource {
  type = 'sine';
  frequency = new FakeParam(440);
  constructor(c: FakeContext) { super('osc', c); }
}

export class FakeBuffer {
  data: Float32Array[];
  constructor(public numberOfChannels: number, public length: number, public sampleRate: number) {
    this.data = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }
  get duration() { return this.length / this.sampleRate; }
  getChannelData(i: number) { return this.data[i]; }
}

export class FakeContext {
  nodes: FakeNode[] = [];
  currentTime = 0;
  destination: FakeNode;
  constructor(public sampleRate = 44100) { this.destination = new FakeNode('destination', this); }
  createGain() { return new FakeGain(this); }
  createStereoPanner() { return new FakePanner(this); }
  createBiquadFilter() { return new FakeBiquad(this); }
  createBufferSource() { return new FakeBufferSource(this); }
  createOscillator() { return new FakeOsc(this); }
  createBuffer(ch: number, len: number, sr: number) { return new FakeBuffer(ch, len, sr); }
  of<T extends FakeNode>(kind: string): T[] { return this.nodes.filter((n) => n.kind === kind) as T[]; }
}

export const asCtx = (c: FakeContext) => c as unknown as BaseAudioContext;
export const asBuffer = (b: FakeBuffer) => b as unknown as AudioBuffer;
