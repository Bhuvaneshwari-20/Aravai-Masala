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

// Small label-over-value tile. Tiles sit two per row, so every card lines up the same way on phone and desktop.
const Stat = ({ label, value, strong, color, wide }) => (
  <View style={[s.statWrap, wide && { width: '100%' }]}>
    <View style={s.stat}>
      <Text style={s.statLabel} numberOfLines={1}>{label}</Text>
      <Text style={[s.statValue, strong && { fontWeight: '900' }, color && { color }]} numberOfLines={1}>{value}</Text>
    </View>
  </View>
);
const StatGrid = ({ children }) => <View style={s.statGrid}>{children}</View>;
const SectionLabel = ({ children }) => <Text style={s.secLabel}>{children}</Text>;

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
  return <Stat label="LOSS" value={`${fmt(l.kg)} kg · ${l.pct} %`} strong color={l.pct > LOSS_ALERT_PCT ? COLORS.danger : COLORS.ok} />;
};

/* ------------------------------ batch-wise: batch card + batch header ------------------------------ */
const STATUS_ORDER = ['RUNNING', 'DELAYED', 'PENDING', 'WAITING', 'COMPLETED'];
const ModeTag = ({ mode }) => (
  <View style={s.tag}><MCI name={mode === 'SIMULTANEOUS' ? 'call-split' : 'arrow-right-bold-outline'} size={12} color={COLORS.grey} />
    <Text style={s.tagText}>{mode === 'SIMULTANEOUS' ? 'Simultaneous' : 'Sequential'}</Text></View>
);
function ProgressBar({ pct, color }) {
  return <View style={s.pbTrack}><View style={[s.pbFill, { width: `${Math.max(Math.min(pct, 100), 0)}%`, backgroundColor: color }]} /></View>;
}
const accentOf = (g) => (g.counts.DELAYED > 0 ? COLORS.danger : g.counts.RUNNING > 0 ? COLORS.primary
  : g.cards.length > 0 && g.counts.COMPLETED === g.cards.length ? COLORS.ok : COLORS.border);

// One card per batch: tap it to open the materials of that batch.
function BatchCard({ g, onPress }) {
  const total = g.cards.length;
  const pct = total ? Math.round((g.counts.COMPLETED / total) * 100) : 0;
  const accent = accentOf(g);
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`Open batch ${g.batch_no}`}
      style={({ hovered }) => [s.bcard, { borderColor: accent }, hovered && s.bcardHover]}>
      <View style={s.head}>
        <View style={[s.bIcon, { backgroundColor: `${accent === COLORS.border ? COLORS.primary : accent}14` }]}>
          <MCI name="layers-triple-outline" size={24} color={accent === COLORS.border ? COLORS.primary : accent} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.bNo} numberOfLines={1}>{g.batch_no}</Text>
          <Text style={s.sub} numberOfLines={1}>{g.product_name}</Text>
        </View>
        <MCI name="chevron-right" size={24} color={COLORS.grey} />
      </View>
      <View style={s.tags}>
        <ModeTag mode={g.process_mode} />
        {g.batch_status === 'ON_HOLD' && <View style={[s.tag, { backgroundColor: COLORS.warnBg }]}><Text style={[s.tagText, { color: COLORS.warn }]}>Batch on hold</Text></View>}
      </View>
      <View style={s.statRow}>
        {STATUS_ORDER.filter((k) => g.counts[k] > 0).map((k) => <Chip key={k} st={STATUS[k]} text={`${g.counts[k]} ${STATUS[k].label.toLowerCase()}`} />)}
      </View>
      <View style={{ marginTop: 10 }}>
        <ProgressBar pct={pct} color={accent === COLORS.border ? COLORS.primary : accent} />
        <Text style={s.pbText}>{g.counts.COMPLETED} of {total} material{total === 1 ? '' : 's'} completed</Text>
      </View>
      <Row icon="weight-kilogram" label="Total quantity" value={`${fmt(g.qty)} kg`} strong />
      {!!g.nextEnd && <Row icon="flag-checkered" label="Next finish" value={t12(g.nextEnd)} strong />}
    </Pressable>
  );
}

// Top of the "materials of this batch" page.
function BatchHeader({ g, onBack }) {
  const total = g.cards.length;
  const pct = total ? Math.round((g.counts.COMPLETED / total) * 100) : 0;
  const accent = accentOf(g);
  return (
    <View style={[s.bh, { borderLeftColor: accent === COLORS.border ? COLORS.primary : accent }]}>
      <Pressable onPress={onBack} hitSlop={8} accessibilityRole="button" accessibilityLabel="Back to all batches"
        style={({ hovered }) => [s.bhBack, hovered && { backgroundColor: COLORS.primarySoft }]}>
        <MCI name="arrow-left" size={20} color={COLORS.primary} />
      </Pressable>
      <View style={{ flex: 1, minWidth: 0, marginLeft: 12 }}>
        <Text style={s.bhNo} numberOfLines={1}>{g.batch_no}</Text>
        <Text style={s.sub} numberOfLines={1}>{g.product_name}  •  {fmt(g.qty)} kg  •  {total} material{total === 1 ? '' : 's'}</Text>
        <View style={s.tags}>
          <ModeTag mode={g.process_mode} />
          {g.batch_status === 'ON_HOLD' && <View style={[s.tag, { backgroundColor: COLORS.warnBg }]}><Text style={[s.tagText, { color: COLORS.warn }]}>Batch on hold</Text></View>}
        </View>
        <ProgressBar pct={pct} color={accent === COLORS.border ? COLORS.primary : accent} />
        <Text style={s.pbText}>{g.counts.COMPLETED} of {total} completed</Text>
      </View>
    </View>
  );
}

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
  const total = running ? Math.max(ses.expected_minutes * 60, 1) : 1;
  const pct = running ? Math.min((elapsed / total) * 100, 100) : 0;

  return (
    <View style={[s.card, { borderLeftWidth: 5, borderLeftColor: st.color }, delayed && { borderColor: COLORS.danger }, soon && { borderColor: COLORS.warn }]}>
      <View style={s.head}>
        <View style={[s.mIcon, { backgroundColor: st.bg }]}><MCI name={st.icon} size={22} color={st.color} /></View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.mat} numberOfLines={1}>{card.material_name}</Text>
          <Text style={s.sub} numberOfLines={1}>{card.batch_no}  •  {card.product_name}</Text>
        </View>
        <Chip st={st} />
      </View>

      <View style={s.tags}>
        <ModeTag mode={card.process_mode} />
        {card.batch_status === 'ON_HOLD' && <View style={[s.tag, { backgroundColor: COLORS.warnBg }]}><Text style={[s.tagText, { color: COLORS.warn }]}>Batch on hold</Text></View>}
      </View>

      {card.status === 'WAITING' && (
        <View style={s.waitBox}><MCI name="clock-outline" size={17} color={COLORS.warn} /><Text style={s.waitText}>{card.reason}</Text></View>
      )}

      {/* ----- not started: machine, start time, duration ----- */}
      {pending && (
        <View>
          <StatGrid><Stat label="QUANTITY" value={card.quantity == null ? '–' : `${fmt(card.quantity)} kg`} strong wide /></StatGrid>
          <View style={s.formBox}>
            <SectionLabel>START {label.toUpperCase()}</SectionLabel>
            <SelectField label={`${label} machine *`} value={d.machine_id || null} options={machines} onChange={(v) => setDraft({ machine_id: v })} error={err && err.machine} />
            {!machines.length && <Text style={s.noMachine}>No {label.toLowerCase()} machine is available right now.</Text>}
            <FormRow>
              <TimeField label="Start time *" value={d.start_time || ''} onChangeText={(t) => setDraft({ start_time: t })} error={err && err.start} />
              <FormField label="Duration (min) *" digits value={d.minutes || ''} onChangeText={(t) => setDraft({ minutes: t.replace(/[^0-9]/g, '') })} error={err && err.minutes} />
            </FormRow>
            <View style={s.endPill}>
              <MCI name="flag-checkered" size={17} color={COLORS.green} />
              <Text style={s.endLabel}>Expected completion</Text>
              <Text style={s.endValue}>{previewEnd(d.start_time, d.minutes)}</Text>
            </View>
          </View>
          {!!(err && err.server) && <Text style={s.err}>{err.server}</Text>}
          {canAct && (
            <Button mode="contained" icon="play" buttonColor={COLORS.green} style={s.btn} contentStyle={s.btnContent} labelStyle={s.btnLabel}
              loading={busy} disabled={busy || !machines.length} onPress={onStart}>Start</Button>
          )}
        </View>
      )}

      {/* ----- waiting: only the quantity ----- */}
      {card.status === 'WAITING' && <StatGrid><Stat label="QUANTITY" value={card.quantity == null ? '–' : `${fmt(card.quantity)} kg`} strong wide /></StatGrid>}

      {/* ----- running: live timer ----- */}
      {running && (
        <View>
          <View style={[s.timer, { backgroundColor: st.bg }]}>
            <Text style={[s.timerLabel, { color: st.color }]}>{delayed ? 'OVER EXPECTED TIME' : soon ? 'COMPLETING SOON' : 'RUNNING FOR'}</Text>
            <Text style={[s.timerVal, { color: st.color }]}>{delayed ? `+${clock(remaining)}` : clock(elapsed)}</Text>
            <View style={s.timerTrack}><View style={[s.timerFill, { width: `${pct}%`, backgroundColor: st.color }]} /></View>
            <Text style={s.timerSub}>{delayed ? `Elapsed ${clock(elapsed)} · the machine keeps running until you press Stop` : `Time left ${clock(remaining)}  ·  ${ses.expected_minutes} min planned`}</Text>
          </View>
          <StatGrid>
            <Stat label="QUANTITY" value={`${fmt(card.quantity)} kg`} strong />
            <Stat label="MACHINE" value={`${ses.machine_code} · ${ses.machine_name}`} />
            <Stat label="START TIME" value={t12(ses.start_time)} />
            <Stat label="EXPECTED COMPLETION" value={t12(ses.expected_end)} strong color={delayed ? COLORS.danger : undefined} />
          </StatGrid>
          <Text style={s.byLine}>Started by {ses.started_by_name}</Text>
          {canAct && <Button mode="contained" icon="stop-circle-outline" buttonColor={COLORS.danger} style={s.btn} contentStyle={s.btnContent} labelStyle={s.btnLabel}
            loading={busy} disabled={busy} onPress={onStop}>Stop / Complete</Button>}
        </View>
      )}

      {/* ----- completed ----- */}
      {card.status === 'COMPLETED' && ses && (
        <StatGrid>
          <Stat label="MACHINE" value={`${ses.machine_code} · ${ses.machine_name}`} wide />
          <Stat label="START TIME" value={t12(ses.start_time)} />
          <Stat label="ACTUAL END" value={t12(ses.actual_end)} strong />
          <Stat label="EXPECTED" value={`${ses.expected_minutes} min · ${t12(ses.expected_end)}`} />
          <Stat label="ACTUAL DURATION" value={`${ses.actual_minutes} min`} strong />
          <Stat label="I/P → O/P" value={`${fmt(card.quantity)} → ${fmt(ses.output_weight)} kg`} />
          <LossRow ip={card.quantity} op={ses.output_weight} />
        </StatGrid>
      )}
      {card.status === 'COMPLETED' && !ses && <Text style={s.legacy}>Completed earlier (saved with the old form).</Text>}
      {card.awaiting_proceed && canAct && (
        <View style={s.proceedBox}>
          <Text style={s.proceedText}>Filtering is complete. Proceed to Roasting?</Text>
          <Button mode="contained" icon="fire" buttonColor={COLORS.primary} style={s.btn} contentStyle={s.btnContent} labelStyle={s.btnLabel}
            loading={busy} disabled={busy} onPress={onProceed}>Proceed to Roasting</Button>
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
          <View style={[s.card, { borderLeftWidth: 5, borderLeftColor: COLORS.ok }]}>
            <View style={[s.head, { marginBottom: 6 }]}>
              <View style={[s.mIcon, { backgroundColor: COLORS.okBg }]}><MCI name="check-circle-outline" size={22} color={COLORS.ok} /></View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.mat} numberOfLines={1}>{i.material_name}</Text>
                <Text style={s.sub} numberOfLines={1}>{i.batch_no}  •  {i.product_name}</Text>
              </View>
              <Chip st={STATUS.COMPLETED} />
            </View>
            <StatGrid>
              <Stat label="MACHINE" value={`${i.machine_code} · ${i.machine_name}`} wide />
              <Stat label="START" value={`${t12(i.start_time)}  ${dmy(i.start_time)}`} />
              <Stat label="ACTUAL END" value={`${t12(i.actual_end)}  ${dmy(i.actual_end)}`} strong color={late ? COLORS.danger : undefined} />
              <Stat label="EXPECTED END" value={`${t12(i.expected_end)} · ${i.expected_minutes} min`} />
              <Stat label="ACTUAL DURATION" value={`${i.actual_minutes} min`} strong />
              <Stat label="I/P → O/P" value={`${fmt(i.input_weight)} → ${fmt(i.output_weight)} kg`} />
              <LossRow ip={i.input_weight} op={i.output_weight} />
            </StatGrid>
            <Text style={s.byLine}>Started by {i.started_by_name}  ·  Completed by {i.completed_by_name || '–'}</Text>
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
  const [selBatch, setSelBatch] = useState(null);   // batch whose materials are open (null = list of batches)
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

  // ----- batch-wise view: one group per batch, with its material cards -----
  const cardStatus = (c) => (c.status === 'RUNNING' && (c.session.remaining_sec - Math.floor((Date.now() - fetchedAt.current) / 1000)) < 0 ? 'DELAYED' : c.status);
  const groups = useMemo(() => {
    if (!data) return [];
    const m = new Map();
    data.items.forEach((c) => {
      if (!m.has(c.batch_id)) m.set(c.batch_id, { id: c.batch_id, batch_no: c.batch_no, product_name: c.product_name, process_mode: c.process_mode, batch_status: c.batch_status, cards: [] });
      m.get(c.batch_id).cards.push(c);
    });
    return [...m.values()];
  }, [data]);
  // counts / quantity / next finish are worked out on every render: DELAYED depends on the clock
  const full = groups.map((g) => {
    const counts = { RUNNING: 0, PENDING: 0, WAITING: 0, COMPLETED: 0, DELAYED: 0 };
    let qty = 0; let nextEnd = null;
    g.cards.forEach((c) => {
      const k = cardStatus(c);
      counts[k] = (counts[k] || 0) + 1;
      qty += Number(c.quantity || 0);
      if (c.status === 'RUNNING' && c.session && c.session.expected_end && (!nextEnd || c.session.expected_end < nextEnd)) nextEnd = c.session.expected_end;
    });
    return { ...g, counts, qty: Math.round(qty * 1000) / 1000, nextEnd };
  });
  const detail = selBatch ? full.find((g) => g.id === selBatch) || null : null;
  useEffect(() => { if (selBatch && data && !groups.some((g) => g.id === selBatch)) setSelBatch(null); }); // the batch moved on: back to the list
  const items = detail ? detail.cards.filter((c) => status === 'ALL' || cardStatus(c) === status) : [];
  const batchList = detail ? [] : full.filter((g) => status === 'ALL' || g.counts[status] > 0);
  const openBatch = (id) => { setSelBatch(id); setStatus('ALL'); };
  const backToBatches = () => { setSelBatch(null); setStatus('ALL'); };

  // chip numbers: in the list = number of batches that have a card in that status; inside a batch = number of its cards
  const countOf = (k) => (detail ? detail.counts[k] : full.filter((g) => g.counts[k] > 0).length);
  const chips = [{ value: 'ALL', label: `All${data ? ` (${detail ? detail.cards.length : full.length})` : ''}` }].concat(
    ['RUNNING', 'PENDING', 'WAITING', 'COMPLETED', 'DELAYED'].map((k) => ({ value: k, label: `${STATUS[k].label.charAt(0)}${STATUS[k].label.slice(1).toLowerCase()}${data ? ` (${countOf(k)})` : ''}` })));

  return (
    <View style={s.wrap}>
      <PageToolbar icon={icon} title={title} count={tab === 'queue' ? (detail ? items.length : batchList.length) : undefined} noun={detail ? 'material' : 'batch'}
        search={search} onSearch={setSearch} placeholder="Search batch / product / material" />
      <Container>
        <FilterChips options={[{ value: 'queue', label: 'Batches' }, { value: 'history', label: 'History' }]} value={tab} onChange={setTab} />
        {tab === 'queue' && detail && <BatchHeader g={detail} onBack={backToBatches} />}
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
              : detail ? (
                // ----- materials of the opened batch -----
                <CardList {...grid} key={`${detail.id}-${status}-${grid.cols}`} data={items} keyExtractor={(i) => i.key}
                  refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(true); setRefreshing(false); }} colors={[COLORS.primary]} />}
                  ListEmptyComponent={<EmptyView icon="🧺" message={`No ${label.toLowerCase()} cards ${status === 'ALL' ? 'in this batch' : 'with this status'}.`} />}
                  ListHeaderComponent={data && data.busy_machines.length ? (
                    <Text style={s.busyNote}>Busy machines: {data.busy_machines.map((m) => `${m.machine_code} (${m.material_name})`).join(', ')}</Text>
                  ) : null}
                  renderItem={(c) => (
                    <MaterialCard card={c} label={label} machines={machineOpts} canAct={canAct} fetchedAt={fetchedAt.current}
                      draft={draftOf(c)} setDraft={setDraft(c)} err={errs[c.key]} busy={busyKey === c.key}
                      onStart={() => start(c)} onStop={() => setStopCard(c)} onProceed={() => setProceedCard(c)} />
                  )} />
              ) : (
                // ----- batch-wise: one card per batch -----
                <CardList {...grid} key={`batches-${status}-${grid.cols}`} data={batchList} keyExtractor={(g) => `b${g.id}`}
                  refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(true); setRefreshing(false); }} colors={[COLORS.primary]} />}
                  ListEmptyComponent={<EmptyView icon="🧺" message={`No batches ${status === 'ALL' ? 'yet' : 'with this status'}. Batches appear here after Batching.`} />}
                  ListHeaderComponent={data && data.busy_machines.length ? (
                    <Text style={s.busyNote}>Busy machines: {data.busy_machines.map((m) => `${m.machine_code} (${m.material_name})`).join(', ')}</Text>
                  ) : null}
                  renderItem={(g) => <BatchCard g={g} onPress={() => openBatch(g.id)} />} />
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
  card: { backgroundColor: '#fff', borderRadius: 18, borderWidth: 1, borderColor: COLORS.border, padding: 16, marginBottom: 4,
    shadowColor: '#2B1B14', shadowOpacity: 0.06, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  head: { flexDirection: 'row', alignItems: 'center' },
  mIcon: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  mat: { fontSize: 17, fontWeight: '900', color: COLORS.text, letterSpacing: -0.1 },
  sub: { fontSize: 12.5, fontWeight: '600', color: COLORS.grey, marginTop: 2 },
  chip: { flexDirection: 'row', alignItems: 'center', borderRadius: 10, paddingHorizontal: 9, paddingVertical: 4, marginLeft: 8 },
  chipText: { fontSize: 10.5, fontWeight: '900', letterSpacing: 0.4, marginLeft: 4 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 10, marginBottom: 2 },
  tag: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.greyBg, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, marginRight: 6 },
  tagText: { fontSize: 11, fontWeight: '800', color: COLORS.grey, marginLeft: 4 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  rowLabel: { marginLeft: 7, fontSize: 12.5, fontWeight: '700', color: COLORS.grey, width: 132 },
  rowValue: { flex: 1, fontSize: 13.5, fontWeight: '700', color: COLORS.text, textAlign: 'right' },
  waitBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.warnBg, borderRadius: 12, padding: 11, marginTop: 6 },
  waitText: { flex: 1, marginLeft: 8, color: COLORS.warn, fontWeight: '700', fontSize: 12.5 },
  noMachine: { color: COLORS.danger, fontSize: 12, fontWeight: '700', marginBottom: 8 },
  err: { color: COLORS.danger, fontWeight: '700', fontSize: 12.5, marginTop: 6 },
  btn: { borderRadius: 12, marginTop: 12 },
  btnContent: { height: 48 },
  btnLabel: { fontSize: 15, fontWeight: '800', letterSpacing: 0.2 },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4, marginTop: 6 },
  statWrap: { width: '50%', padding: 4 },
  stat: { backgroundColor: '#FAF7F3', borderRadius: 12, borderWidth: 1, borderColor: COLORS.line, paddingVertical: 9, paddingHorizontal: 11, minHeight: 56, justifyContent: 'center' },
  statLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 0.7, color: COLORS.grey },
  statValue: { fontSize: 14, fontWeight: '700', color: COLORS.text, marginTop: 3 },
  secLabel: { fontSize: 11, fontWeight: '900', letterSpacing: 1.2, color: COLORS.grey, marginBottom: 10 },
  formBox: { backgroundColor: '#FDFBF8', borderRadius: 14, borderWidth: 1, borderColor: COLORS.border, padding: 12, marginTop: 8 },
  endPill: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.greenBg, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12 },
  endLabel: { flex: 1, marginLeft: 8, fontSize: 12.5, fontWeight: '700', color: COLORS.green },
  endValue: { fontSize: 15, fontWeight: '900', color: COLORS.green },
  byLine: { fontSize: 11.5, fontWeight: '600', color: COLORS.grey, marginTop: 8, marginLeft: 2 },
  timerTrack: { alignSelf: 'stretch', height: 6, borderRadius: 3, backgroundColor: 'rgba(0,0,0,0.08)', overflow: 'hidden', marginTop: 8, marginBottom: 6 },
  timerFill: { height: 6, borderRadius: 3 },
  timer: { borderRadius: 14, padding: 14, alignItems: 'center', marginTop: 4 },
  timerLabel: { fontSize: 10.5, fontWeight: '900', letterSpacing: 0.8 },
  timerVal: { fontSize: 38, fontWeight: '900', letterSpacing: 1, marginVertical: 2 },
  timerSub: { fontSize: 12, fontWeight: '700', color: COLORS.grey, textAlign: 'center' },
  legacy: { color: COLORS.grey, fontSize: 12.5, fontWeight: '600', marginTop: 8 },
  proceedBox: { backgroundColor: `${COLORS.primary}0D`, borderRadius: 12, padding: 12, marginTop: 10 },
  proceedText: { fontWeight: '800', color: COLORS.text },
  stopInfo: { backgroundColor: COLORS.greyBg, borderRadius: 10, padding: 10, marginBottom: 12 },
  stopInfoText: { color: COLORS.textSoft, fontSize: 12.5, fontWeight: '600', lineHeight: 18 },
  alert: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.warnBg, borderRadius: 12, padding: 12, marginBottom: 6 },
  alertText: { flex: 1, marginHorizontal: 10, color: COLORS.warn, fontWeight: '800', fontSize: 13 },
  busyNote: { color: COLORS.grey, fontSize: 12, fontWeight: '700', marginBottom: 8 },
  bcard: { backgroundColor: '#fff', borderRadius: 20, borderWidth: 1.5, borderColor: COLORS.border, padding: 16, marginBottom: 4,
    shadowColor: '#0F172A', shadowOpacity: 0.05, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  bcardHover: { backgroundColor: COLORS.bg },
  bIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  bNo: { fontSize: 19, fontWeight: '900', color: COLORS.text },
  statRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 6, marginLeft: -8, marginBottom: 2 },
  pbTrack: { height: 8, borderRadius: 4, backgroundColor: COLORS.greyBg, overflow: 'hidden' },
  pbFill: { height: 8, borderRadius: 4 },
  pbText: { fontSize: 12, fontWeight: '700', color: COLORS.grey, marginTop: 5 },
  bh: { flexDirection: 'row', alignItems: 'flex-start', backgroundColor: '#fff', borderRadius: 18, borderWidth: 1.5, borderColor: COLORS.border, borderLeftWidth: 6,
    padding: 14, marginHorizontal: 12, marginTop: 4, marginBottom: 6 },
  bhBack: { width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.bg, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COLORS.border },
  bhNo: { fontSize: 22, fontWeight: '900', color: COLORS.text },
});