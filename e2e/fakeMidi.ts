/**
 * A simulated Web MIDI implementation injected into the page before ANVIL loads. It exercises
 * ANVIL's real Web MIDI code path: one output that records every message (with its requested
 * timestamp and the time it was sent) and one input that tests can push bytes into.
 */
export const FAKE_MIDI = `
(() => {
  const sent = [];
  window.__midiSent = sent;
  const listeners = { access: null };
  function makePort(id, name, type) {
    return { id, name, manufacturer: 'Test', type, state: 'connected', connection: 'open', onmidimessage: null, onstatechange: null,
      send(data, ts) { sent.push({ port: id, data: Array.from(data), ts: ts ?? performance.now(), at: performance.now() }); },
      clear() { window.__midiCleared = (window.__midiCleared || 0) + 1; },
      open() { return Promise.resolve(this); }, close() { return Promise.resolve(this); } };
  }
  const out = makePort('out-1', 'Fake Hermod+', 'output');
  const out2 = makePort('out-2', 'Fake Synth', 'output');
  const inp = makePort('in-1', 'Fake Clock In', 'input');
  const outputs = new Map([[out.id, out], [out2.id, out2]]);
  const inputs = new Map([[inp.id, inp]]);
  const access = { inputs, outputs, sysexEnabled: false, onstatechange: null };
  window.__midiIn = (bytes) => { if (inp.state === 'connected' && inp.onmidimessage) inp.onmidimessage({ data: new Uint8Array(bytes), timeStamp: performance.now() }); };
  window.__midiSetState = (id, state) => {
    const p = outputs.get(id) || inputs.get(id);
    p.state = state;
    if (access.onstatechange) access.onstatechange({ port: p });
  };
  navigator.requestMIDIAccess = () => Promise.resolve(access);
})();
`;

export const NO_MIDI = `delete Navigator.prototype.requestMIDIAccess; try { Object.defineProperty(navigator, 'requestMIDIAccess', { value: undefined }); } catch (e) {}`;
