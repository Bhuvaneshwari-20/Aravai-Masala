
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Pressable, ScrollView, StyleSheet, AppState, Platform } from 'react-native';
import { Text, Portal, Button, Switch } from 'react-native-paper';
import { MaterialCommunityIcons as MCI } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import api, { errMsg, getToken } from '../api';
import { API_URL } from '../config';
import { onPush } from '../pushNotifications';
import useLayout from '../hooks/useLayout';
import { COLORS } from '../theme';

const POLL_MS = 20000;
const BANNER_MS = 12000;

const SEV = {
  info: { color: COLORS.primary, bg: `${COLORS.primary}14`, icon: 'information-outline' },
  success: { color: COLORS.ok, bg: COLORS.okBg, icon: 'check-circle-outline' },
  warning: { color: COLORS.warn, bg: COLORS.warnBg, icon: 'bell-ring-outline' },
  danger: { color: COLORS.danger, bg: COLORS.dangerBg, icon: 'alert-circle-outline' },
};

const TYPE_ICON = {
  PROCESS_5MIN: 'timer-alert-outline',
  PROCESS_REMINDER: 'timer-alert-outline',
  PROCESS_DUE: 'alarm-light-outline',
  PROCESS_DONE: 'check-circle-outline',
};

const ago = (sec) => {
  const s = Math.max(Math.round(sec), 0);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
};

const store = {
  state: { open: false, unread: 0, enabled: true, inline: 0 },
  subs: new Set(),
  reload: null,
};

const setStore = (patch) => {
  store.state = { ...store.state, ...patch };
  store.subs.forEach((f) => f());
};

function useStore() {
  const [, force] = useState(0);

  useEffect(() => {
    const f = () => force((n) => n + 1);
    store.subs.add(f);
    return () => store.subs.delete(f);
  }, []);

  return store.state;
}

function BellButton({ unread, enabled, tone, onPress }) {
  const dark = tone === 'dark';

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Notifications${unread ? `, ${unread} unread` : ''}`}
      style={({ hovered }) => [
        s.bell,
        dark && s.bellDark,
        hovered && {
          backgroundColor: dark
            ? 'rgba(255,255,255,0.3)'
            : COLORS.primarySoft,
        },
      ]}
    >
      <MCI
        name={unread ? 'bell-ring' : 'bell-outline'}
        size={22}
        color={dark ? '#fff' : unread ? COLORS.primary : COLORS.textSoft}
      />
      {unread > 0 && enabled && (
        <View style={s.badge}>
          <Text style={s.badgeText}>{unread > 99 ? '99+' : unread}</Text>
        </View>
      )}
    </Pressable>
  );
}

export function NotificationBell({ tone = 'light' }) {
  const focused = useIsFocused();
  const st = useStore();

  useEffect(() => {
    if (!focused) return undefined;

    setStore({ inline: store.state.inline + 1 });

    return () =>
      setStore({ inline: Math.max(store.state.inline - 1, 0) });
  }, [focused]);

  return (
    <BellButton
      unread={st.unread}
      enabled={st.enabled}
      tone={tone}
      onPress={() => {
        setStore({ open: !store.state.open });
        if (store.reload) store.reload();
      }}
    />
  );
}

function Banner({ n, onOpen, onClose }) {
  const sev = SEV[n.severity] || SEV.info;

  useEffect(() => {
    const t = setTimeout(onClose, BANNER_MS);
    return () => clearTimeout(t);
  }, []);

  return (
    <Pressable
      onPress={onOpen}
      style={[s.banner, { borderLeftColor: sev.color }]}
      accessibilityRole="alert"
    >
      <View style={[s.dot, { backgroundColor: sev.bg }]}>
        <MCI name={TYPE_ICON[n.type] || sev.icon} size={20} color={sev.color} />
      </View>

      <View style={{ flex: 1, marginHorizontal: 10 }}>
        <Text style={s.title} numberOfLines={1}>{n.title}</Text>
        <Text style={s.msg} numberOfLines={3}>{n.message}</Text>
      </View>

      <Pressable hitSlop={10} onPress={onClose}>
        <MCI name="close" size={18} color={COLORS.grey} />
      </Pressable>
    </Pressable>
  );
}

export default function NotificationCenter({ navRef, route }) {
  const insets = useSafeAreaInsets();
  const { isWide, height } = useLayout();

  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const { open, inline } = useStore();

  const setOpen = useCallback(
    (v) =>
      setStore({
        open: typeof v === 'function' ? v(store.state.open) : v,
      }),
    []
  );

  const [popups, setPopups] = useState([]);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushMsg, setPushMsg] = useState('');

  const [settings, setSettings] = useState({
    web_enabled: true,
    push_enabled: true,
    push_available: false,
    devices: 0,
  });

  const [, setTick] = useState(0);
  const baseline = useRef(null);
  const fetchedAt = useRef(Date.now());
  const baseTitle = useRef('');

  const load = useCallback(async () => {
    try {
      const r = await api.get('/notifications', {
        params: { limit: 30 },
      });

      const d = r.data.data;

      fetchedAt.current = Date.now();

      setItems(d.items);
      setUnread(d.unread);

      if (d.settings) {
        setSettings((p) => ({ ...p, ...d.settings }));
      }

      if (baseline.current === null) {
        baseline.current = d.max_id;
      } else {
        const fresh = d.items.filter(
          (n) => n.id > baseline.current && !n.is_read
        );

        if (d.max_id > baseline.current) {
          baseline.current = d.max_id;
        }

        if (
          fresh.length &&
          !(d.settings && d.settings.web_enabled === false)
        ) {
          setPopups((p) => [...fresh, ...p].slice(0, 3));
        }
      }
    } catch (e) {
      console.log('Notification load error:', errMsg(e));
    }
  }, []);

  useEffect(() => {
    store.reload = load;
    return () => {
      store.reload = null;
    };
  }, [load]);

  useEffect(() => {
    setStore({
      unread,
      enabled: settings.web_enabled !== false,
    });
  }, [unread, settings.web_enabled]);

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') load();
    });

    return () => sub.remove();
  }, [load]);

  useEffect(() => {
    if (open) setTick((n) => n + 1);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;

    const t = setInterval(() => setTick((n) => n + 1), 30000);
    return () => clearInterval(t);
  }, [open]);

  const loadSettings = useCallback(async () => {
    try {
      const response = await api.get('/notifications/settings');
      const data = response.data.data;

      console.log('PUSH SETTINGS:', {
        devices: data.devices,
        push_available: data.push_available,
        push_enabled: data.push_enabled,
      });

      setSettings(data);
    } catch (e) {
      console.log('Push settings error:', errMsg(e));
    }
  }, []);

  const saveSetting = async (patch) => {
    setSettings((p) => ({ ...p, ...patch }));

    try {
      const response = await api.put('/notifications/settings', patch);
      setSettings(response.data.data);
    } catch (e) {
      loadSettings();
    }
  };

  const testPush = async () => {
    if (pushBusy) return;

    setPushBusy(true);
    setPushMsg('');

    try {
      const response = await api.post('/notifications/push/test');

      console.log('TEST PUSH RESPONSE:', response.data);

      setPushMsg('Test notification sent successfully!');
    } catch (e) {
      console.log('TEST PUSH ERROR:', e.response?.data || e.message);
      setPushMsg(errMsg(e));
    } finally {
      setPushBusy(false);
    }
  };

  useEffect(() => {
    if (open) loadSettings();
  }, [open, loadSettings]);

  useEffect(() => onPush(() => load()), [load]);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof fetch === 'undefined') {
      return undefined;
    }

    let stop = false;
    let ctrl = null;
    let timer = null;

    const connect = async () => {
      const tk = getToken();

      if (!tk || stop) return;

      ctrl = new AbortController();

      try {
        const res = await fetch(`${API_URL}/notifications/stream`, {
          headers: {
            Authorization: `Bearer ${tk}`,
            Accept: 'text/event-stream',
          },
          signal: ctrl.signal,
        });

        if (!res.ok || !res.body) throw new Error('no stream');

        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = '';

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;

          buf += dec.decode(value, { stream: true });

          if (buf.includes('event: notification')) {
            buf = '';
            load();
          } else if (buf.length > 4000) {
            buf = '';
          }
        }
      } catch (e) {
        // Stream reconnects automatically.
      }

      if (!stop) timer = setTimeout(connect, 5000);
    };

    connect();

    return () => {
      stop = true;
      clearTimeout(timer);
      if (ctrl) ctrl.abort();
    };
  }, [load]);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') {
      return;
    }

    if (!baseTitle.current) {
      baseTitle.current =
        document.title.replace(/^\(\d+\)\s*/, '') || 'Aravai Masala';
    }

    document.title = unread
      ? `(${unread}) ${baseTitle.current}`
      : baseTitle.current;
  }, [unread]);

  const markRead = (n) => {
    if (n.is_read) return;

    setItems((a) =>
      a.map((x) => (x.id === n.id ? { ...x, is_read: true } : x))
    );

    setUnread((u) => Math.max(u - 1, 0));

    api.post(`/notifications/${n.id}/read`).catch(() => {});
  };

  const markAll = () => {
    setItems((a) => a.map((x) => ({ ...x, is_read: true })));
    setUnread(0);
    api.post('/notifications/read-all').catch(() => {});
  };

  const removeItem = (n) => {
    setItems((a) => a.filter((x) => x.id !== n.id));

    if (!n.is_read) {
      setUnread((u) => Math.max(u - 1, 0));
    }

    api.delete(`/notifications/${n.id}`).catch(() => {});
  };

  const clearAll = () => {
    setItems([]);
    setUnread(0);
    api.delete('/notifications').catch(() => {});
  };

  useEffect(() => {
    if (!open || unread === 0) return undefined;

    const t = setTimeout(markAll, 3000);
    return () => clearTimeout(t);
  }, [open, unread]);

  const go = (n) => {
    setOpen(false);
    setPopups((p) => p.filter((x) => x.id !== n.id));
    markRead(n);

    if (n.screen && navRef && navRef.isReady()) {
      try {
        navRef.navigate(n.screen, n.params || undefined);
      } catch (e) {
        // Screen unavailable.
      }
    }
  };

  const bellRight = route === 'Home' && !isWide ? 62 : 16;
  const panelTop = insets.top + 56;
  const delta = Math.floor((Date.now() - fetchedAt.current) / 1000);

  return (
    <>
      {inline === 0 && (
        <View
          style={[
            s.bellWrap,
            { top: insets.top + 8, right: bellRight },
          ]}
          pointerEvents="box-none"
        >
          <BellButton
            unread={unread}
            enabled={settings.web_enabled !== false}
            onPress={() => {
              setOpen((o) => !o);
              load();
            }}
          />
        </View>
      )}

      {!open && popups.length > 0 && (
        <View
          style={[
            s.stack,
            { top: panelTop },
            isWide
              ? { right: 16, width: 400 }
              : { left: 8, right: 8 },
          ]}
          pointerEvents="box-none"
        >
          {popups.map((n) => (
            <Banner
              key={n.id}
              n={n}
              onOpen={() => go(n)}
              onClose={() =>
                setPopups((p) => p.filter((x) => x.id !== n.id))
              }
            />
          ))}
        </View>
      )}

      {open && (
        <Portal>
          <Pressable
            style={s.backdrop}
            onPress={() => setOpen(false)}
            accessibilityLabel="Close notifications"
          />

          <View
            style={[
              s.panel,
              {
                top: panelTop,
                maxHeight: Math.max(height - panelTop - 16, 240),
              },
              isWide
                ? { right: 16, width: 420 }
                : { left: 8, right: 8 },
            ]}
          >
            <View style={s.panelHead}>
              <Text style={s.panelTitle}>Notifications</Text>

              {unread > 0 && (
                <View style={s.countChip}>
                  <Text style={s.countText}>{unread} new</Text>
                </View>
              )}

              <View style={{ flex: 1 }} />

              {items.length > 0 && (
                <Pressable onPress={clearAll} hitSlop={8}>
                  <Text style={s.link}>Clear all</Text>
                </Pressable>
              )}

              <Pressable
                onPress={() => setOpen(false)}
                hitSlop={10}
                style={{ marginLeft: 14 }}
              >
                <MCI name="close" size={20} color={COLORS.grey} />
              </Pressable>
            </View>

            <ScrollView style={{ flexGrow: 0 }}>
              {items.length === 0 && (
                <View style={s.empty}>
                  <MCI
                    name="bell-check-outline"
                    size={34}
                    color="#C9BEB5"
                  />
                  <Text style={s.emptyText}>You are all caught up</Text>
                </View>
              )}

              {items.map((n) => {
                const sev = SEV[n.severity] || SEV.info;

                return (
                  <Pressable
                    key={n.id}
                    onPress={() => go(n)}
                    style={({ hovered }) => [
                      s.row,
                      !n.is_read && s.rowUnread,
                      hovered && {
                        backgroundColor: COLORS.primarySoft,
                      },
                    ]}
                  >
                    <View style={[s.dot, { backgroundColor: sev.bg }]}>
                      <MCI
                        name={TYPE_ICON[n.type] || sev.icon}
                        size={20}
                        color={sev.color}
                      />
                    </View>

                    <View style={{ flex: 1, marginLeft: 10 }}>
                      <View
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                        }}
                      >
                        <Text
                          style={[s.title, { flex: 1 }]}
                          numberOfLines={1}
                        >
                          {n.title}
                        </Text>

                        <Text style={s.time}>
                          {ago(n.age_sec + delta)}
                        </Text>
                      </View>

                      <Text style={s.msg} numberOfLines={3}>
                        {n.message}
                      </Text>
                    </View>

                    {!n.is_read && <View style={s.unreadDot} />}

                    <Pressable
                      onPress={() => removeItem(n)}
                      hitSlop={10}
                      accessibilityLabel="Remove notification"
                      style={{ marginLeft: 10, marginTop: 2 }}
                    >
                      <MCI
                        name="close"
                        size={16}
                        color={COLORS.grey}
                      />
                    </Pressable>
                  </Pressable>
                );
              })}
            </ScrollView>

            <View style={s.prefs}>
              <View style={s.prefRow}>
                <View style={{ flex: 1 }}>
                  <Text style={s.phoneText}>Website alerts</Text>
                  <Text style={s.phoneSub}>
                    Bell count and pop-up on this website
                  </Text>
                </View>

                <Switch
                  value={settings.web_enabled !== false}
                  onValueChange={(v) =>
                    saveSetting({ web_enabled: v })
                  }
                  color={COLORS.primary}
                />
              </View>

              <View style={s.prefRow}>
                <View style={{ flex: 1 }}>
                  <Text style={s.phoneText}>Mobile push</Text>

                  <Text style={s.phoneSub}>
                    {!settings.push_available
                      ? 'Not set up on the server yet'
                      : `${settings.devices || 0} phone(s) registered`}
                  </Text>

                  {!!pushMsg && (
                    <Text
                      style={[
                        s.phoneSub,
                        {
                          color: pushMsg.includes('successfully')
                            ? COLORS.ok
                            : COLORS.danger,
                          marginTop: 2,
                        },
                      ]}
                    >
                      {pushMsg}
                    </Text>
                  )}
                </View>

                {settings.push_available && (
                  <Button
                    compact
                    mode="text"
                    onPress={testPush}
                    loading={pushBusy}
                    disabled={pushBusy}
                    textColor={COLORS.primary}
                  >
                    Test
                  </Button>
                )}

                <Switch
                  value={settings.push_enabled !== false}
                  onValueChange={(v) =>
                    saveSetting({ push_enabled: v })
                  }
                  color={COLORS.primary}
                />
              </View>
            </View>
          </View>
        </Portal>
      )}
    </>
  );
}

const s = StyleSheet.create({
  bellWrap: {
    position: 'absolute',
    zIndex: 60,
  },
  bell: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  bellDark: {
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderColor: 'rgba(255,255,255,0.35)',
    shadowOpacity: 0,
    elevation: 0,
  },
  badge: {
    position: 'absolute',
    top: -5,
    right: -5,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: COLORS.danger,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
    borderWidth: 2,
    borderColor: '#fff',
  },
  badgeText: {
    color: '#fff',
    fontSize: 10.5,
    fontWeight: '900',
  },
  stack: {
    position: 'absolute',
    zIndex: 59,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 14,
    borderLeftWidth: 5,
    padding: 12,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOpacity: 0.14,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.12)',
  },
  panel: {
    position: 'absolute',
    backgroundColor: '#fff',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  panelHead: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.line,
  },
  panelTitle: {
    fontSize: 17,
    fontWeight: '900',
    color: COLORS.text,
  },
  countChip: {
    backgroundColor: `${COLORS.primary}14`,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginLeft: 8,
  },
  countText: {
    color: COLORS.primary,
    fontSize: 11,
    fontWeight: '900',
  },
  link: {
    color: COLORS.primary,
    fontWeight: '800',
    fontSize: 12.5,
  },
  empty: {
    alignItems: 'center',
    padding: 30,
  },
  emptyText: {
    color: COLORS.grey,
    fontWeight: '700',
    marginTop: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.line,
  },
  rowUnread: {
    backgroundColor: '#FFFAF0',
  },
  dot: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 14,
    fontWeight: '900',
    color: COLORS.text,
  },
  msg: {
    fontSize: 12.5,
    fontWeight: '600',
    color: COLORS.textSoft,
    marginTop: 2,
    lineHeight: 18,
  },
  time: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.grey,
    marginLeft: 8,
  },
  unreadDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: COLORS.primary,
    marginLeft: 8,
    marginTop: 6,
  },
  prefs: {
    padding: 14,
    borderTopWidth: 1,
    borderTopColor: COLORS.line,
  },
  prefRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  phoneText: {
    fontSize: 12.5,
    fontWeight: '700',
    color: COLORS.text,
    lineHeight: 18,
  },
  phoneSub: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.grey,
    marginTop: 4,
    lineHeight: 17,
  },
});
