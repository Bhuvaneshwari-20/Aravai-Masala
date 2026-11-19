import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, RefreshControl, StyleSheet, Pressable } from 'react-native';
import { Text, Button, ActivityIndicator } from 'react-native-paper';
import { MaterialCommunityIcons as MCI } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import api, { errMsg } from '../api';
import { useAuth } from '../AuthContext';
import { useUi } from '../ui';
import usePagedList from '../hooks/usePagedList';
import useDebounce from '../hooks/useDebounce';
import Container from './Container';
import PageToolbar from './PageToolbar';
import FilterChips from './FilterChips';
import { CardList, useCardCols } from './InfoCard';
import LoadingView from './LoadingView';
import EmptyView from './EmptyView';
import ConfirmDialog from './ConfirmDialog';
import ModalShell from './ModalShell';
import FormField from './FormField';
import FormRow from './FormRow';
import SelectField from './SelectField';
import MeshSelectField from './MeshSelectField';
import TimeField from './TimeField';
import { ErrorBox, ModalFooter } from './FormBits';
import { COLORS, fmt } from '../theme';

// Material-wise cards for Filtering / Roasting / Grinding.
//   <ProcessBoard type="FILTERING" path="filtering" module="filtering" title="Filtering" icon="filter-variant" />
// All times and the running timer come from the database (elapsed_sec / remaining_sec), so a page refresh never loses the timer.

const ALERT_SECONDS = 300;
const STATUS = {
  PENDING: { label: 'PENDING', color: COLORS.grey, bg: COLORS.greyBg, icon: 'timer-sand-empty' },
  WAITING: { label: 'WAITING', color: COLORS.warn, bg: COLORS.warnBg, icon: 'clock-outline' },
  RUNNING: { label: 'RUNNING', color: COLORS.primary, bg: `${COLORS.primary}14`, icon: 'play-circle-outline' },
  COMPLETED: { label: 'COMPLETED', color: COLORS.ok, bg: COLORS.okBg, icon: 'check-circle-outline' },
  DELAYED: { label: 'DELAYED', color: COLORS.danger, bg: COLORS.dangerBg, icon: 'alert-circle-outline' },
};
const YESNO = [{ value: 'YES', label: 'Yes' }, { value: 'NO', label: 'No' }];
const p2 = (n) => String(n).padStart(2, '0');
const nowHHMM = () => { const d = new Date(); return `${p2(d.getHours())}:${p2(d.getMinutes())}`; };
const to12 = (h, m) => `${p2(((h + 11) % 12) + 1)}:${p2(m)} ${h >= 12 ? 'PM' : 'AM'}`;
// '2026-11-19 16:04:00' -> '04:04 PM'
const t12 = (dt) => { const m = /(\d{1,2}):(\d{2})/.exec(String(dt || '').slice(11)); return m ? to12(Number(m[1]), Number(m[2])) : '–'; };
const dmy = (dt) => { const m = /(\d{4})-(\d{2})-(\d{2})/.exec(String(dt || '')); return m ? `${m[3]}/${m[2]}/${m[1]}` : ''; };
const clock = (sec) => { const s = Math.abs(Math.round(sec)); return `${p2(Math.floor(s / 3600))}:${p2(Math.floor((s % 3600) / 60))}:${p2(s % 60)}`; };
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
// start HH:MM + minutes -> '04:34 PM' (with "+1 day" when it passes midnight)
const previewEnd = (start, mins) => {
  if (!TIME_RE.test(start || '') || !(Number(mins) > 0)) return '–';
  const [h, m] = start.split(':').map(Number);
  const tot = h * 60 + m + Number(mins);
  const day = Math.floor(tot / 1440);
  return `${to12(Math.floor((tot % 1440) / 60), tot % 60)}${day ? ` (+${day} day)` : ''}`;
};

function Chip({ st, text }) {
  return (
    <View style={[s.chip, { backgroundColor: st.bg }]}>
      <MCI name={st.icon} size={13} color={st.color} />
      <Text style={[s.chipText, { color: st.color }]}>{text || st.label}</Text>
    </View>
  );
}
const Row = ({ icon, label, value, strong, color }) => (
  <View style={s.row}>
    <MCI name={icon} size={15} color={COLORS.grey} />
    <Text style={s.rowLabel}>{label}</Text>
    <Text style={[s.rowValue, strong && { fontWeight: '900' }, color && { color }]} numberOfLines={1}>{value}</Text>
  </View>
);

// Loss between I/P and O/P of a finished card: { kg, pct }. null when the numbers are missing / not valid.
const lossOf = (ip, op) => {
  if (ip === null || ip === undefined || ip === '' || op === null || op === undefined || op === '') return null; // no O/P yet -> no loss
  const a = Number(ip); const b = Number(op);
  if (!(a > 0) || !(b >= 0) || b > a) return null;
  return { kg: Math.round((a - b) * 1000) / 1000, pct: Math.round(((a - b) / a) * 10000) / 100 };
};
const LOSS_ALERT_PCT = 12; // same limit the Stop form uses to turn the loss red
// "Loss  1 kg · 12.5 %" - shown on every completed Filtering / Roasting / Grinding card and history row
const LossRow = ({ ip, op }) => {
  const l = lossOf(ip, op);
  if (!l) return null;
  return <Row icon="trending-down" label="Loss" value={`${fmt(l.kg)} kg · ${l.pct} %`} strong color={l.pct > LOSS_ALERT_PCT ? COLORS.danger : undefined} />;
};

/* ------------------------------ one material card ------------------------------ */
function MaterialCard({ card, label, machines, canAct, tick, fetchedAt, draft, setDraft, busy, onStart, onStop, onProceed, err }) {
  const ses = card.session;
  const running = card.status === 'RUNNING';
  const delta = running ? Math.floor((Date.now() - fetchedAt) / 1000) : 0;
  const elapsed = running ? ses.elapsed_sec + delta : 0;
  const remaining = running ? ses.remaining_sec - delta : 0;
  const delayed = running && remaining < 0;
  const st = delayed ? STATUS.DELAYED : STATUS[card.status];
  const soon = running && !delayed && remaining <= ALERT_SECONDS;
  const d = draft || {};
  const pending = card.status === 'PENDING';

  return (
    <View style={[s.card, delayed && { borderColor: COLORS.danger }, soon && { borderColor: COLORS.warn }]}>
      <View style={s.head}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.mat} numberOfLines={1}>{card.material_name}</Text>
          <Text style={s.sub} numberOfLines={1}>{card.batch_no}  •  {card.product_name}</Text>
        </View>
        <Chip st={st} />
      </View>

      <View style={s.tags}>
        <View style={s.tag}><MCI name={card.process_mode === 'SIMULTANEOUS' ? 'call-split' : 'arrow-right-bold-outline'} size={12} color={COLORS.grey} />
          <Text style={s.tagText}>{card.process_mode === 'SIMULTANEOUS' ? 'Simultaneous' : 'Sequential'}</Text></View>
        {card.batch_status === 'ON_HOLD' && <View style={[s.tag, { backgroundColor: COLORS.warnBg }]}><Text style={[s.tagText, { color: COLORS.warn }]}>Batch on hold</Text></View>}
      </View>

      <Row icon="weight-kilogram" label="Quantity" value={card.quantity == null ? '–' : `${fmt(card.quantity)} kg`} strong />

      {card.status === 'WAITING' && (
        <View style={s.waitBox}><MCI name="clock-outline" size={16} color={COLORS.warn} /><Text style={s.waitText}>{card.reason}</Text></View>
      )}

      {/* ----- not started: machine, start time, duration ----- */}
      {pending && (
        <View style={{ marginTop: 6 }}>
          <SelectField label={`${label} machine *`} value={d.machine_id || null} options={machines} onChange={(v) => setDraft({ machine_id: v })} error={err && err.machine} />
          {!machines.length && <Text style={s.noMachine}>No {label.toLowerCase()} machine is available right now.</Text>}
          <FormRow>
            <TimeField label="Start time *" value={d.start_time || ''} onChangeText={(t) => setDraft({ start_time: t })} error={err && err.start} />
            <FormField label="Duration (min) *" digits value={d.minutes || ''} onChangeText={(t) => setDraft({ minutes: t.replace(/[^0-9]/g, '') })} error={err && err.minutes} />
          </FormRow>
          <Row icon="flag-checkered" label="Expected completion" value={previewEnd(d.start_time, d.minutes)} strong />
          {!!(err && err.server) && <Text style={s.err}>{err.server}</Text>}
          {canAct && (
            <Button mode="contained" icon="play" buttonColor={COLORS.green} style={s.btn} loading={busy} disabled={busy || !machines.length} onPress={onStart}>Start</Button>
          )}
        </View>
      )}

      {/* ----- running: live timer ----- */}
      {running && (
        <View style={{ marginTop: 6 }}>
          <View style={[s.timer, { backgroundColor: st.bg }]}>
            <Text style={[s.timerLabel, { color: st.color }]}>{delayed ? 'OVER EXPECTED TIME' : soon ? 'COMPLETING SOON' : 'RUNNING FOR'}</Text>
            <Text style={[s.timerVal, { color: st.color }]}>{delayed ? `+${clock(remaining)}` : clock(elapsed)}</Text>
            <Text style={s.timerSub}>{delayed ? `Elapsed ${clock(elapsed)} - the machine keeps running until you press Stop` : `Time left ${clock(remaining)}`}</Text>
          </View>
          <Row icon="cog-outline" label="Machine" value={`${ses.machine_code} · ${ses.machine_name}`} />
          <Row icon="clock-start" label="Start time" value={`${t12(ses.start_time)}  ${dmy(ses.start_time)}`} />
          <Row icon="timer-outline" label="Expected duration" value={`${ses.expected_minutes} min`} />
          <Row icon="flag-checkered" label="Expected completion" value={t12(ses.expected_end)} strong />
          <Row icon="account-outline" label="Started by" value={ses.started_by_name} />
          {canAct && <Button mode="contained" icon="stop-circle-outline" buttonColor={COLORS.danger} style={s.btn} loading={busy} disabled={busy} onPress={onStop}>Stop / Complete</Button>}
        </View>
      )}

      {/* ----- completed ----- */}
      {card.status === 'COMPLETED' && ses && (
        <View style={{ marginTop: 6 }}>
          <Row icon="cog-outline" label="Machine" value={`${ses.machine_code} · ${ses.machine_name}`} />
          <Row icon="clock-start" label="Start time" value={t12(ses.start_time)} />
          <Row icon="timer-outline" label="Expected" value={`${ses.expected_minutes} min  (${t12(ses.expected_end)})`} />
          <Row icon="clock-end" label="Actual end time" value={`${t12(ses.actual_end)}  ${dmy(ses.actual_end)}`} strong />
          <Row icon="timer-sand" label="Actual duration" value={`${ses.actual_minutes} min`} strong />
          <Row icon="arrow-right-bold" label="I/P → O/P" value={`${fmt(card.quantity)} → ${fmt(ses.output_weight)} kg`} />
          <LossRow ip={card.quantity} op={ses.output_weight} />
        </View>
      )}
      {card.status === 'COMPLETED' && !ses && <Text style={s.legacy}>Completed earlier (saved with the old form).</Text>}
      {card.awaiting_proceed && canAct && (
        <View style={s.proceedBox}>
          <Text style={s.proceedText}>Filtering is complete. Proceed to Roasting?</Text>
          <Button mode="contained" icon="fire" buttonColor={COLORS.primary} style={s.btn} loading={busy} disabled={busy} onPress={onProceed}>Proceed to Roasting</Button>
        </View>
      )}
    </View>
  );
}

/* ------------------------------ stop / complete dialog ------------------------------ */
function StopModal({ type, card, label, canAddMesh, toast, onDismiss, onDone }) {
  const [f, setF] = useState({});
  const [errors, setErrors] = useState({});
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));
  useEffect(() => { if (card) { setF({ output_weight: '', remarks: '', sieved: 'NO', mesh_id: null }); setErrors({}); setErr(''); setSaving(false); } }, [card]);
  if (!card) return null;
  const ip = Number(card.session.input_weight || card.quantity);
  const op = Number(f.output_weight);
  const loss = ip > 0 && op > 0 && op <= ip ? Math.round(((ip - op) / ip) * 10000) / 100 : null;

  const save = async () => {
    const e = {};
    if (!(op > 0)) e.output_weight = 'Enter O/P weight';
    else if (op > ip) e.output_weight = `Cannot be more than I/P (${fmt(ip)} kg)`;
    if (type === 'GRINDING' && !f.mesh_id) e.mesh = 'Select the mesh size';
    setErrors(e);
    if (Object.keys(e).length) return;
    setSaving(true); setErr('');
    try {
      const r = await api.post(`/${type.toLowerCase()}/stop`, {
        session_id: card.session.id, output_weight: f.output_weight, remarks: f.remarks || undefined,
        ...(type === 'ROASTING' ? { temp_before: f.temp_before, std_temp: f.std_temp, temp_after: f.temp_after } : {}),
        ...(type === 'GRINDING' ? { mesh_id: f.mesh_id, sieved: f.sieved } : {}),
      });
      setSaving(false);
      onDone(r.data.data);
    } catch (x) { setErr(errMsg(x)); setSaving(false); }
  };

  return (
    <ModalShell visible={!!card} onDismiss={onDismiss} busy={saving} icon="stop-circle-outline" maxWidth={560}
      title={`Stop ${label}`} subtitle={`${card.material_name}  •  ${card.batch_no}`}
      footer={<ModalFooter onCancel={onDismiss} onSave={save} saving={saving} label="Stop & Save" />}>
      <View>
        <View style={s.stopInfo}>
          <Text style={s.stopInfoText}>The end time is taken automatically when you press Stop & Save. The machine becomes available after the record is saved.</Text>
        </View>
        <FormRow>
          <FormField label="I/P weight (kg)" value={String(fmt(ip))} editable={false} />
          <FormField label="O/P weight (kg) *" numeric value={f.output_weight || ''} onChangeText={set('output_weight')} error={errors.output_weight} />
        </FormRow>
        <Text style={{ color: loss !== null && loss > 12 ? COLORS.danger : COLORS.grey, fontWeight: '700', marginBottom: 8 }}>Loss: {loss === null ? '–' : `${loss} %`}</Text>
        {type === 'ROASTING' && (
          <FormRow>
            <FormField label="Temp before (°C)" numeric value={f.temp_before || ''} onChangeText={set('temp_before')} />
            <FormField label="STD temp (°C)" numeric value={f.std_temp || ''} onChangeText={set('std_temp')} />
            <FormField label="Temp after (°C)" numeric value={f.temp_after || ''} onChangeText={set('temp_after')} />
          </FormRow>
        )}
        {type === 'GRINDING' && (
          <FormRow>
            {/* sizes come from the Mesh Size master; a new size can be added right here and is selected at once */}
                        <MeshSelectField value={f.mesh_id} onChange={(id) => set('mesh_id')(id)} error={errors.mesh}
              canAdd={canAddMesh} onAdded={(m) => toast(`Mesh ${m.mesh_size} mm added`)} />
            <SelectField label="Sieved" value={f.sieved} options={YESNO} onChange={set('sieved')} />
          </FormRow>
        )}
        <FormField label="Remarks" multiline value={f.remarks || ''} onChangeText={set('remarks')} maxLength={255} />
        <ErrorBox text={err} />
      </View>
    </ModalShell>
  );
}

/* ------------------------------ history tab ------------------------------ */
function HistoryList({ type, path, search, label }) {
  const grid = useCardCols({ min: 300, phoneMin: 280 });
  const list = usePagedList(`/${path}/history`, { search: search || undefined });
  if (list.loading) return <LoadingView />;
  if (list.error && !list.items.length) return <EmptyView error={list.error} onRetry={list.reload} />;
  return (
    <CardList {...grid} data={list.items} keyExtractor={(i) => String(i.id)}
      refreshControl={<RefreshControl refreshing={list.refreshing} onRefresh={list.refresh} colors={[COLORS.primary]} />}
      onEndReached={list.loadMore} onEndReachedThreshold={0.4}
      ListEmptyComponent={<EmptyView icon="🗂️" message={`No completed ${label.toLowerCase()} records yet`} />}
      ListFooterComponent={list.loadingMore ? <ActivityIndicator style={{ margin: 16 }} color={COLORS.primary} /> : null}
      renderItem={(i) => {
        const late = i.actual_end && i.expected_end && i.actual_end > i.expected_end;
        return (
          <View style={s.card}>
            <View style={s.head}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.mat} numberOfLines={1}>{i.material_name}</Text>
                <Text style={s.sub} numberOfLines={1}>{i.batch_no}  •  {i.product_name}</Text>
              </View>
              <Chip st={STATUS.COMPLETED} />
            </View>
            <Row icon="cog-outline" label="Machine" value={`${i.machine_code} · ${i.machine_name}`} />
            <Row icon="clock-start" label="Start" value={`${t12(i.start_time)}  ${dmy(i.start_time)}`} />
            <Row icon="flag-checkered" label="Expected end" value={`${t12(i.expected_end)}  (${i.expected_minutes} min)`} />
            <Row icon="clock-end" label="Actual end" value={`${t12(i.actual_end)}  ${dmy(i.actual_end)}`} strong color={late ? COLORS.danger : undefined} />
            <Row icon="timer-sand" label="Actual duration" value={`${i.actual_minutes} min`} strong />
            <Row icon="arrow-right-bold" label="I/P → O/P" value={`${fmt(i.input_weight)} → ${fmt(i.output_weight)} kg`} />
            <LossRow ip={i.input_weight} op={i.output_weight} />
            <Row icon="account-outline" label="Started / Completed by" value={`${i.started_by_name} / ${i.completed_by_name || '–'}`} />
          </View>
        );
      }} />
  );
}

/* ------------------------------ the board ------------------------------ */
export default function ProcessBoard({ type, path, module: mod, title, icon }) {
  const { can } = useAuth();
  const { toast } = useUi();
  const label = title;
  const canAct = can(mod, 'create');
  const grid = useCardCols({ min: 320, phoneMin: 280 });
  const [tab, setTab] = useState('queue');
  const [status, setStatus] = useState('ALL');
  const [search, setSearch] = useState('');
  const dSearch = useDebounce(search, 400);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [drafts, setDrafts] = useState({});
  const [errs, setErrs] = useState({});
  const [busyKey, setBusyKey] = useState('');
  const [stopCard, setStopCard] = useState(null);
  const [proceedCard, setProceedCard] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [, setTick] = useState(0);
  const fetchedAt = useRef(Date.now());
  const acked = useRef(new Set());

  const load = useCallback(async (quiet) => {
    try {
      const r = await api.get(`/${path}/queue`, { params: { search: dSearch || undefined } });
      fetchedAt.current = Date.now();
      setData(r.data.data); setError('');
    } catch (e) { if (!quiet) setError(errMsg(e)); }
  }, [path, dSearch]);

  useEffect(() => { setData(null); load(false); }, [load]);
  useFocusEffect(useCallback(() => { load(true); }, [load]));
  useEffect(() => { const t = setInterval(() => load(true), 20000); return () => clearInterval(t); }, [load]);   // other users' changes + machine availability
  useEffect(() => { const t = setInterval(() => setTick((n) => n + 1), 1000); return () => clearInterval(t); }, []); // live timers

  // 5-minute advance notification: the server marks it as sent, so it appears only once per processing session
  useEffect(() => {
    if (!data) return;
    data.items.forEach((c) => {
      if (c.status !== 'RUNNING' || !c.session || c.session.alert_sent || acked.current.has(c.session.id)) return;
      const remaining = c.session.remaining_sec - Math.floor((Date.now() - fetchedAt.current) / 1000);
      if (remaining > ALERT_SECONDS) return;
      acked.current.add(c.session.id);
      api.post(`/${path}/alert`, { session_id: c.session.id }).then((r) => {
        const d = r.data.data;
        if (d && d.fired) { setAlerts((a) => [{ id: c.session.id, text: d.message }, ...a]); toast(d.message); }
      }).catch(() => { acked.current.delete(c.session.id); });
    });
  });

  const draftOf = (c) => {
    const d = drafts[c.key] || {};
    return { machine_id: d.machine_id, start_time: d.start_time !== undefined ? d.start_time : nowHHMM(), minutes: d.minutes !== undefined ? d.minutes : '' };
  };
  const setDraft = (c) => (patch) => { setDrafts((p) => ({ ...p, [c.key]: { ...draftOf(c), ...patch } })); setErrs((p) => ({ ...p, [c.key]: undefined })); };

  const machineOpts = useMemo(() => (data ? data.machines.map((m) => ({ value: m.id, label: `${m.machine_code} - ${m.machine_name}` })) : []), [data]);

  const start = async (c) => {
    const d = draftOf(c);
    const e = {};
    if (!d.machine_id) e.machine = 'Select a machine';
    if (!TIME_RE.test(d.start_time || '')) e.start = 'Select the start time';
    if (!(Number(d.minutes) >= 1)) e.minutes = 'Enter duration in minutes';
    if (Object.keys(e).length) { setErrs((p) => ({ ...p, [c.key]: e })); return; }
    setBusyKey(c.key);
    try {
      await api.post(`/${path}/start`, { batch_id: c.batch_id, material_id: c.material_id, machine_id: d.machine_id, start_time: d.start_time, expected_minutes: Number(d.minutes) });
      setDrafts((p) => ({ ...p, [c.key]: undefined }));
      toast(`${c.material_name} started`);
      await load(true);
    } catch (x) { setErrs((p) => ({ ...p, [c.key]: { server: errMsg(x) } })); await load(true); }
    setBusyKey('');
  };

  const proceed = async (c) => {
    setBusyKey(c.key);
    try {
      await api.post('/filtering/proceed', { batch_id: c.batch_id, material_id: c.material_id });
      toast(`${c.material_name} moved to the Roasting queue`);
      setProceedCard(null);
      await load(true);
    } catch (x) { toast(errMsg(x)); }
    setBusyKey('');
  };

  const onStopped = (r) => {
    const c = stopCard; setStopCard(null);
    toast(`${c.material_name} ${label.toLowerCase()} completed${r.batch_moved ? ` - batch moved to ${r.batch_moved.to.charAt(0) + r.batch_moved.to.slice(1).toLowerCase()}` : ''}`);
    load(true).then(() => { if (type === 'FILTERING' && c.process_mode === 'SEQUENTIAL') setProceedCard(c); });
  };

  const items = useMemo(() => {
    if (!data) return [];
    return data.items.filter((c) => {
      if (status === 'ALL') return true;
      if (status === 'DELAYED') return c.status === 'RUNNING' && (c.session.remaining_sec - Math.floor((Date.now() - fetchedAt.current) / 1000)) < 0;
      return c.status === status;
    });
  }, [data, status]);

  const chips = [{ value: 'ALL', label: `All${data ? ` (${data.counts.ALL})` : ''}` }].concat(
    ['RUNNING', 'PENDING', 'WAITING', 'COMPLETED', 'DELAYED'].map((k) => ({ value: k, label: `${STATUS[k].label.charAt(0)}${STATUS[k].label.slice(1).toLowerCase()}${data ? ` (${data.counts[k]})` : ''}` })));

  return (
    <View style={s.wrap}>
      <PageToolbar icon={icon} title={title} count={tab === 'queue' ? items.length : undefined} noun="card" search={search} onSearch={setSearch} placeholder="Search batch / product / material" />
      <Container>
        <FilterChips options={[{ value: 'queue', label: 'Material cards' }, { value: 'history', label: 'History' }]} value={tab} onChange={setTab} />
        {tab === 'queue' && <FilterChips options={chips} value={status} onChange={setStatus} />}
      </Container>

      {alerts.length > 0 && (
        <Container>
          {alerts.map((a) => (
            <View key={a.id} style={s.alert}>
              <MCI name="bell-ring-outline" size={20} color={COLORS.warn} />
              <Text style={s.alertText}>{a.text}</Text>
              <Pressable hitSlop={8} onPress={() => setAlerts((x) => x.filter((y) => y.id !== a.id))}><MCI name="close" size={18} color={COLORS.warn} /></Pressable>
            </View>
          ))}
        </Container>
      )}

      <Container fill>
        {tab === 'history' ? <HistoryList type={type} path={path} search={dSearch} label={label} />
          : !data && !error ? <LoadingView />
            : error && !data ? <EmptyView error={error} onRetry={() => load(false)} />
              : (
                <CardList {...grid} key={`${status}-${grid.cols}`} data={items} keyExtractor={(i) => i.key}
                  refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(true); setRefreshing(false); }} colors={[COLORS.primary]} />}
                  ListEmptyComponent={<EmptyView icon="🧺" message={`No ${label.toLowerCase()} cards ${status === 'ALL' ? 'yet' : 'with this status'}. Materials appear here after Batching.`} />}
                  ListHeaderComponent={data && data.busy_machines.length ? (
                    <Text style={s.busyNote}>Busy machines: {data.busy_machines.map((m) => `${m.machine_code} (${m.material_name})`).join(', ')}</Text>
                  ) : null}
                  renderItem={(c) => (
                    <MaterialCard card={c} label={label} machines={machineOpts} canAct={canAct} fetchedAt={fetchedAt.current}
                      draft={draftOf(c)} setDraft={setDraft(c)} err={errs[c.key]} busy={busyKey === c.key}
                      onStart={() => start(c)} onStop={() => setStopCard(c)} onProceed={() => setProceedCard(c)} />
                  )} />
              )}
      </Container>

            <StopModal type={type} card={stopCard} label={label} canAddMesh={can('grinding', 'create') || can('mesh', 'create')} toast={toast}
        onDismiss={() => setStopCard(null)} onDone={onStopped} />

      <ConfirmDialog visible={!!proceedCard} busy={!!busyKey} title="Proceed to Roasting?"
        message={proceedCard ? `${proceedCard.material_name} (${proceedCard.batch_no}) has finished Filtering. Move it to the Roasting queue now? If you choose "Not now" it stays waiting.` : ''}
        confirmText="Yes, proceed" onCancel={() => setProceedCard(null)} onConfirm={() => proceedCard && proceed(proceedCard)} />
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: COLORS.bg },
  card: { backgroundColor: '#fff', borderRadius: 18, borderWidth: 1.5, borderColor: COLORS.border, padding: 16, marginBottom: 4 },
  head: { flexDirection: 'row', alignItems: 'flex-start' },
  mat: { fontSize: 18, fontWeight: '900', color: COLORS.text },
  sub: { fontSize: 12.5, fontWeight: '700', color: COLORS.grey, marginTop: 2 },
  chip: { flexDirection: 'row', alignItems: 'center', borderRadius: 10, paddingHorizontal: 9, paddingVertical: 4, marginLeft: 8 },
  chipText: { fontSize: 10.5, fontWeight: '900', letterSpacing: 0.4, marginLeft: 4 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 8, marginBottom: 4 },
  tag: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.greyBg, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, marginRight: 6 },
  tagText: { fontSize: 11, fontWeight: '800', color: COLORS.grey, marginLeft: 4 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  rowLabel: { marginLeft: 7, fontSize: 12.5, fontWeight: '700', color: COLORS.grey, width: 132 },
  rowValue: { flex: 1, fontSize: 13.5, fontWeight: '700', color: COLORS.text, textAlign: 'right' },
  waitBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.warnBg, borderRadius: 10, padding: 10, marginTop: 8 },
  waitText: { flex: 1, marginLeft: 8, color: COLORS.warn, fontWeight: '700', fontSize: 12.5 },
  noMachine: { color: COLORS.danger, fontSize: 12, fontWeight: '700', marginBottom: 8 },
  err: { color: COLORS.danger, fontWeight: '700', fontSize: 12.5, marginTop: 6 },
  btn: { borderRadius: 12, marginTop: 10 },
  timer: { borderRadius: 14, padding: 12, alignItems: 'center', marginBottom: 6 },
  timerLabel: { fontSize: 10.5, fontWeight: '900', letterSpacing: 0.8 },
  timerVal: { fontSize: 34, fontWeight: '900', letterSpacing: 1, marginVertical: 2 },
  timerSub: { fontSize: 12, fontWeight: '700', color: COLORS.grey, textAlign: 'center' },
  legacy: { color: COLORS.grey, fontSize: 12.5, fontWeight: '600', marginTop: 8 },
  proceedBox: { backgroundColor: `${COLORS.primary}0D`, borderRadius: 12, padding: 12, marginTop: 10 },
  proceedText: { fontWeight: '800', color: COLORS.text },
  stopInfo: { backgroundColor: COLORS.greyBg, borderRadius: 10, padding: 10, marginBottom: 12 },
  stopInfoText: { color: COLORS.textSoft, fontSize: 12.5, fontWeight: '600', lineHeight: 18 },
  alert: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.warnBg, borderRadius: 12, padding: 12, marginBottom: 6 },
  alertText: { flex: 1, marginHorizontal: 10, color: COLORS.warn, fontWeight: '800', fontSize: 13 },
  busyNote: { color: COLORS.grey, fontSize: 12, fontWeight: '700', marginBottom: 8 },
});