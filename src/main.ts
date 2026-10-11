import './ui/style.css';
import { Session } from './app/session';
import { mountApp } from './ui/app';
import { PaletteLibrary } from './ui/palette';
import { defaultStore } from './persistence/storage';
import { OUTPUT_FX_WORKLET_URL } from './audio/workletUrl';
import { WorkerTransformRunner } from './core/dsp/transform/cache';
import TransformWorker from './core/dsp/transform/worker.ts?worker';

const root = document.getElementById('app')!;
const runner = typeof Worker === 'undefined' ? undefined : new WorkerTransformRunner(() => new TransformWorker());
const session = new Session({ workletUrl: OUTPUT_FX_WORKLET_URL, transformRunner: runner });
mountApp(root, session, new PaletteLibrary(defaultStore()));
void session.initMidi();
window.addEventListener('pagehide', () => {
  session.transport.stop();
  session.saveNow();
});
