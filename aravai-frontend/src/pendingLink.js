import { Platform } from 'react-native';
import { storage } from './storage';

// A person scans the QR with the phone camera while NOT logged in: the app shows the login screen, and the machine link
// would be forgotten. Call rememberMachineLink() once at start-up (web build), then, after login, call takePendingMachineLink()
// and navigate to MachineQr with the returned token. See DEPLOYMENT notes.
const KEY = 'pending_machine_token';
const RE = /^\/(?:m|machine)\/([A-Za-z0-9_.~-]{3,128})\/?$/;

export async function rememberMachineLink() {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  const m = RE.exec(window.location.pathname || '');
  if (m) { try { await storage.set(KEY, m[1]); } catch (e) { /* storage unavailable: nothing to remember */ } }
}

export async function takePendingMachineLink() {
  try {
    const t = await storage.get(KEY);
    if (t) await storage.del(KEY);
    return t || null;
  } catch (e) { return null; }
}
