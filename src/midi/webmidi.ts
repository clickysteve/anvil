/**
 * Web MIDI access. Wraps navigator.requestMIDIAccess so the rest of ANVIL sees simple port
 * lists and callbacks, and so a missing or refused MIDI permission is a normal state rather
 * than an error. ANVIL never requests SysEx.
 */
import type { OutPort } from './router';

export type MidiStatus = 'unsupported' | 'pending' | 'ready' | 'denied';

export interface PortInfo {
  id: string;
  name: string;
  manufacturer: string;
  connected: boolean;
}

type InputHandler = (data: Uint8Array, time: number) => void;

export class MidiAccess {
  status: MidiStatus = 'pending';
  error = '';
  private access: MIDIAccess | null = null;
  private listeners = new Set<() => void>();
  private inputHandler: { id: string; fn: InputHandler; port: MIDIInput } | null = null;

  get supported(): boolean {
    return typeof navigator !== 'undefined' && typeof navigator.requestMIDIAccess === 'function';
  }

  async init(): Promise<MidiStatus> {
    if (!this.supported) {
      this.status = 'unsupported';
      this.notify();
      return this.status;
    }
    try {
      this.access = await navigator.requestMIDIAccess({ sysex: false });
      this.access.onstatechange = () => {
        this.reattachInput();
        this.notify();
      };
      this.status = 'ready';
    } catch (e) {
      this.status = 'denied';
      this.error = e instanceof Error ? e.message : String(e);
    }
    this.notify();
    return this.status;
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify(): void {
    for (const l of this.listeners) l();
  }

  private list(map: MIDIOutputMap | MIDIInputMap | undefined): PortInfo[] {
    const out: PortInfo[] = [];
    map?.forEach((p) => out.push({ id: p.id, name: p.name ?? p.id, manufacturer: p.manufacturer ?? '', connected: p.state === 'connected' }));
    return out;
  }

  outputs(): PortInfo[] {
    return this.list(this.access?.outputs);
  }

  inputs(): PortInfo[] {
    return this.list(this.access?.inputs);
  }

  /** An output wrapped as an OutPort, or null when it is not (or no longer) available. */
  output(id: string | null): OutPort | null {
    if (!id || !this.access) return null;
    const o = this.access.outputs.get(id);
    if (!o || o.state === 'disconnected') return null;
    return {
      id: o.id,
      name: o.name ?? o.id,
      send: (data, ts) => o.send(data, ts),
      clear: typeof (o as MIDIOutput & { clear?: () => void }).clear === 'function' ? () => (o as MIDIOutput & { clear: () => void }).clear() : undefined,
    };
  }

  isConnected(kind: 'input' | 'output', id: string | null): boolean {
    if (!id || !this.access) return false;
    const p = kind === 'input' ? this.access.inputs.get(id) : this.access.outputs.get(id);
    return !!p && p.state === 'connected';
  }

  /** Listen to one input (replacing any previous listener). */
  listen(id: string | null, fn: InputHandler): void {
    this.unlisten();
    if (!id || !this.access) return;
    const port = this.access.inputs.get(id);
    if (!port) {
      this.inputHandler = null;
      return;
    }
    this.inputHandler = { id, fn, port };
    port.onmidimessage = (ev: MIDIMessageEvent) => {
      if (ev.data) fn(ev.data, ev.timeStamp);
    };
  }

  unlisten(): void {
    if (this.inputHandler) this.inputHandler.port.onmidimessage = null;
    this.inputHandler = null;
  }

  /** After a reconnect the browser may hand back a new port object: re-attach the handler. */
  private reattachInput(): void {
    const h = this.inputHandler;
    if (!h || !this.access) return;
    const port = this.access.inputs.get(h.id);
    if (port && port !== h.port) this.listen(h.id, h.fn);
  }
}
