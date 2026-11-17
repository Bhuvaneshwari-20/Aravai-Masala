import { APP_URL } from './config';

// Pass to <NavigationContainer linking={linking}>.
// Scanning the machine QR  <APP_URL>/m/<qr_token>  with the phone camera opens the app on that machine's details.
// (older links <APP_URL>/machine/<code or token> still open too)
// prefixes must never contain undefined: React Navigation reads every prefix with .match() and crashes otherwise.
export const linking = {
  prefixes: [APP_URL].filter((p) => typeof p === 'string' && p.length > 0),
  config: { screens: { MachineQr: { path: 'm/:token', alias: ['machine/:token'] } } },
};