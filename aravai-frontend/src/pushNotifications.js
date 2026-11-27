import { useEffect } from 'react';
import { Platform } from 'react-native';
import api from './api';
import { storage } from './storage';

// Mobile push (Firebase Cloud Messaging) for the Android app. The website does NOT use this file - it has the bell + live stream.
// Needs a development / release build (not Expo Go) with google-services.json - see the setup notes.
const native = Platform.OS === 'android' || Platform.OS === 'ios';
const Notifications = native ? require('expo-notifications') : null;
const Constants = native ? require('expo-constants').default : null;

const CHANNEL = 'process-alerts';
const listeners = new Set();
export const onPush = (fn) => { listeners.add(fn); return () => listeners.delete(fn); }; // NotificationCenter refreshes its bell when a push arrives

let configured = false;
function configure() {
  if (!native || configured) return;
  configured = true;
   // App open: still show the system notification. Both names are given so it works with older and newer expo-notifications.
   // App open: still show the system notification (banner + notification list)
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
  });
   if (Platform.OS === 'android') {
    Notifications.setNotificationChannelAsync(CHANNEL, {
      name: 'Process alerts', importance: Notifications.AndroidImportance.MAX, vibrationPattern: [0, 250, 250, 250],
    }).catch(() => {});
  }
}

async function deviceId() {
  let id = await storage.get('device_id');
  if (!id) { id = `${Platform.OS}-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`; await storage.set('device_id', id); }
  return id;
}

// Sends this phone's FCM token to the server. The user comes from the login token, not from this request.
async function sendToken(token) {
  const old = await storage.get('push_token');
  await api.post('/notifications/devices', {
    token, old_token: old && old !== token ? old : undefined, device_type: Platform.OS,
    device_id: await deviceId(), app_version: Constants.expoConfig?.version,
  });
  await storage.set('push_token', token);
}

export async function registerForPush() {
  if (!native) return null;
  configure();
  let st = await Notifications.getPermissionsAsync();
  if (st.status !== 'granted') st = await Notifications.requestPermissionsAsync(); // Android 13+ asks the user here
  if (st.status !== 'granted') return null;
  const t = await Notifications.getDevicePushTokenAsync(); // the real FCM token (not an Expo token)
  if (!t || !t.data) return null;
  await sendToken(String(t.data));
  return String(t.data);
}

// Call BEFORE the login token is cleared (AuthContext.logout)
export async function unregisterPush() {
  if (!native) return;
  try {
    const token = await storage.get('push_token');
    if (token) await api.delete('/notifications/devices', { data: { token } });
    await storage.del('push_token');
  } catch (e) { /* offline: the server also switches a token off when FCM reports it as invalid */ }
}

// open the screen of a tapped notification
function openFrom(navRef, response) {
  const data = response && response.notification && response.notification.request.content.data;
  if (!data) return;
  if (data.notification_id) api.post(`/notifications/${data.notification_id}/read`).catch(() => {});
  if (!data.screen) return;
  let params;
  try { params = data.params ? JSON.parse(data.params) : undefined; } catch (e) { params = undefined; }
  let tries = 0;
  const go = () => { // the app may still be starting (terminated -> tapped)
    if (navRef && navRef.isReady()) { try { navRef.navigate(data.screen, params); } catch (e) { /* screen not available for this user */ } return; }
    tries += 1;
    if (tries < 40) setTimeout(go, 250);
  };
  go();
}

// Mount once in Root (App.js):  usePushNotifications(user, navRef)
export function usePushNotifications(user, navRef) {
  const uid = user ? user.id : null;
  useEffect(() => {
    if (!native || !uid) return undefined;
    configure();
    registerForPush().catch(() => {});
    const subs = [
      Notifications.addPushTokenListener((t) => { if (t && t.data) sendToken(String(t.data)).catch(() => {}); }),        // token refresh
      Notifications.addNotificationReceivedListener(() => listeners.forEach((fn) => fn())),                              // app open: refresh the bell now
      Notifications.addNotificationResponseReceivedListener((r) => openFrom(navRef, r)),                                // tapped (background)
    ];
    const last = Notifications.getLastNotificationResponse && Notifications.getLastNotificationResponse(); // tapped while the app was closed
    if (last) openFrom(navRef, last);
    return () => subs.forEach((s) => s.remove());
  }, [uid, navRef]);
}