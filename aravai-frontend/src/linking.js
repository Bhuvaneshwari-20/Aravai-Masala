import { APP_URL } from './config';

// Pass to <NavigationContainer linking={linking}>.
// Scanning the machine QR  <APP_URL>/m/<qr_token>  with the phone camera opens the app on that machine's details.
// (older links <APP_URL>/machine/<code or token> still open too)
export const linking = {
  prefixes: [APP_URL],
  config: { screens: { MachineQr: { path: 'm/:token', alias: ['machine/:token'] } } },
};
