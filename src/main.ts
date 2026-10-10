import './ui/style.css';
import { Session } from './app/session';
import { mountApp } from './ui/app';
import { PaletteLibrary } from './ui/palette';
import { defaultStore } from './persistence/storage';

const root = document.getElementById('app')!;
const session = new Session();
mountApp(root, session, new PaletteLibrary(defaultStore()));
void session.initMidi();
window.addEventListener('pagehide', () => {
  session.transport.stop();
  session.saveNow();
});
