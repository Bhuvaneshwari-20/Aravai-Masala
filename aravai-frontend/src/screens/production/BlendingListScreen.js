import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, RefreshControl, StyleSheet, Pressable } from 'react-native';
import { Text, Button, ActivityIndicator } from 'react-native-paper';
import { MaterialCommunityIcons as MCI } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import api, { errMsg } from '../../api';
import { useAuth } from '../../AuthContext';
import { useUi } from '../../ui';
import BlendingDetailModal from '../../components/BlendingDetailModal';
import PageToolbar from '../../components/PageToolbar';
import FilterChips from '../../components/FilterChips';
import usePagedList from '../../hooks/usePagedList';
import useDebounce from '../../hooks/useDebounce';
import Container from '../../components/Container';
import { CardList, useCardCols } from '../../components/InfoCard';
import LoadingView from '../../components/LoadingView';
import EmptyView from '../../components/EmptyView';
import ModalShell from '../../components/ModalShell';
import FormField from '../../components/FormField';
import FormRow from '../../components/FormRow';
import SelectField from '../../components/SelectField';
import TimeField from '../../components/TimeField';
import ConfirmDialog from '../../components/ConfirmDialog';
import { fmtDuration } from '../../components/DurationField';
import DurationFields, { checkDuration, overrideMessage, durText } from '../../components/DurationFields';
import { ErrorBox, ModalFooter } from '../../components/FormBits';
import { COLORS, fmt } from '../../theme';

// Blending: batch cards -> open a batch -> START BLENDING (machine, start time, configured / manual duration) -> timer -> Stop / Complete.
// All times and the running timer come from the database (elapsed_sec / remaining_sec), so a refresh never loses the timer.
const ALERT_SECONDS = 300;
const STATUS = {
  PENDING: { label: 'PENDING', color: COLORS.grey, bg: COLORS.greyBg, icon: 'timer-sand-empty' },
  WAITING: { label: 'WAITING', color: COLORS.warn, bg: COLORS.warnBg, icon: 'clock-outline' },
  RUNNING: { label: 'RUNNING', color: COLORS.primary, bg: `${COLORS.primary}14`, icon: 'play-circle-outline' },
  COMPLETED: { label: 'COMPLETED', color: COLORS.ok, bg: COLORS.okBg, icon: 'check-circle-outline' },
  DELAYED: { label: 'DELAYED', color: COLORS.danger, bg: COLORS.dangerBg, icon: 'alert-circle-outline' },
};
const p2 = (n) => String(n).padStart(2, '0');
const nowHHMM = () => { const d = new Date(); return `${p2(d.getHours())}:${p2(d.getMinutes())}`; };
const to12 = (h, m) => `${p2(((h + 11) % 12) + 1)}:${p2(m)} ${h >= 12 ? 'PM' : 'AM'}`;
const t12 = (dt) => { const m = /(\d{1,2}):(\d{2})/.exec(String(dt || '').slice(11)); return m ? to12(Number(m[1]), Number(m[2])) : '–'; };
const dmy = (dt) => { const m = /(\d{4})-(\d{2})-(\d{2})/.exec(String(dt || '')); return m ? `${m[3]}/${m[2]}/${m[1]}` : ''; };
const clock = (sec) => { const s = Math.abs(Math.round(sec)); return `${p2(Math.floor(s / 3600))}:${p2(Math.floor((s % 3600) / 60))}:${p2(s % 60)}`; };
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
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
const ProgressBar = ({ pct, color }) => <View style={s.pbTrack}><View style={[s.pbFill, { width: `${Math.max(Math.min(pct, 100), 0)}%`, backgroundColor: color }]} /></View>;

// the status a card shows right now (RUNNING turns DELAYED once the expected time has passed)
const remainingOf = (g, fetchedAt) => (g.status === 'RUNNING' ? g.session.remaining_sec - Math.floor((Date.now() - fetchedAt) / 1000) : null);
const statusOf = (g, fetchedAt) => (g.status === 'RUNNING' && remainingOf(g, fetchedAt) < 0 ? 'DELAYED' : g.status);
const accentOf = (k) => (k === 'DELAYED' ? COLORS.danger : k === 'RUNNING' ? COLORS.primary : k === 'COMPLETED' ? COLORS.ok : k === 'WAITING' ? COLORS.warn : COLORS.border);

/* ------------------------------ batch card (list) ------------------------------ */
function BatchCard({ g, k, onPress }) {
  const accent = accentOf(k);
  const tint = accent === COLORS.border ? COLORS.primary : accent;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`Open batch ${g.batch_no}`}
      style={({ hovered }) => [s.bcard, { borderColor: accent }, hovered && s.bcardHover]}>
      <View style={s.head}>
        <View style={[s.bIcon, { backgroundColor: `${tint}14` }]}><MCI name="blender" size={24} color={tint} /></View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.bNo} numberOfLines={1}>{g.batch_no}</Text>
          <Text style={s.sub} numberOfLines={1}>{g.product_name}</Text>
        </View>
        <MCI name="chevron-right" size={24} color={COLORS.grey} />
      </View>
      <View style={s.tags}>
        <View style={s.tag}><MCI name="flask-outline" size={12} color={COLORS.grey} />
          <Text style={s.tagText}>{g.ingredient_count} ingredient{g.ingredient_count === 1 ? '' : 's'}</Text></View>
        {g.batch_status === 'ON_HOLD' && <View style={[s.tag, { backgroundColor: COLORS.warnBg }]}><Text style={[s.tagText, { color: COLORS.warn }]}>Batch on hold</Text></View>}
      </View>
      <View style={s.statRow}><Chip st={STATUS[k]} /></View>
      <View style={{ marginTop: 10 }}>
        <ProgressBar pct={k === 'COMPLETED' ? 100 : 0} color={tint} />
        <Text style={s.pbText}>{k === 'COMPLETED' ? 'Blending completed' : k === 'RUNNING' || k === 'DELAYED' ? 'Blending in progress' : 'Blending not done yet'}</Text>
      </View>
      <Row icon="weight-kilogram" label="Total quantity" value={`${fmt(g.quantity)} kg`} strong />
      {g.status === 'RUNNING' && <Row icon="flag-checkered" label="Expected finish" value={t12(g.session.expected_end)} strong />}
    </Pressable>
  );
}

// Top of the "blend of this batch" page.
function BatchHeader({ g, k, onBack }) {
  const accent = accentOf(k);
  return (
    <View style={[s.bh, { borderLeftColor: accent === COLORS.border ? COLORS.primary : accent }]}>
      <Pressable onPress={onBack} hitSlop={8} accessibilityRole="button" accessibilityLabel="Back to all batches"
        style={({ hovered }) => [s.bhBack, hovered && { backgroundColor: COLORS.primarySoft }]}>
        <MCI name="arrow-left" size={20} color={COLORS.primary} />
      </Pressable>
      <View style={{ flex: 1, minWidth: 0, marginLeft: 12 }}>
        <Text style={s.bhNo} numberOfLines={1}>{g.batch_no}</Text>
        <Text style={s.sub} numberOfLines={1}>{g.product_name}  •  {fmt(g.quantity)} kg  •  {g.ingredient_count} ingredient{g.ingredient_count === 1 ? '' : 's'}</Text>
        <View style={{ marginTop: 8 }}>
          <ProgressBar pct={k === 'COMPLETED' ? 100 : 0} color={accent === COLORS.border ? COLORS.primary : accent} />
          <Text style={s.pbText}>{k === 'COMPLETED' ? 'Blending completed' : '0 of 1 completed'}</Text>
        </View>
      </View>
    </View>
  );
}

// ingredients of the batch, weights come from the batch itself
function IngredientList({ items, total }) {
  if (!items.length) return null;
  return (
    <View style={s.ingBox}>
      <SectionLabel>INGREDIENTS (FROM GRINDING)</SectionLabel>
      {items.map((m, i) => (
        <View key={`${m.material_name}-${i}`} style={s.ingRow}>
          <Text style={s.ingName} numberOfLines={1}>{m.material_name}</Text>
          <Text style={s.ingQty}>{fmt(m.qty)} kg</Text>
          <Text style={s.ingPct}>{Number(m.percent).toFixed(1)}%</Text>
        </View>
      ))}
      <View style={[s.ingRow, { borderBottomWidth: 0, backgroundColor: '#FFF3E0', borderRadius: 8 }]}>
        <Text style={[s.ingName, { fontWeight: '900' }]}>Total</Text>
        <Text style={[s.ingQty, { fontWeight: '900' }]}>{fmt(total)} kg</Text>
        <Text style={[s.ingPct, { fontWeight: '900' }]}>100%</Text>
      </View>
    </View>
  );
}

/* ------------------------------ the blending card of a batch ------------------------------ */
function BlendCard({ g, machines, canAct, fetchedAt, draft, setDraft, busy, err, onStart, onStop, onView }) {
  const running = g.status === 'RUNNING';
  const ses = g.session;
  const delta = running ? Math.floor((Date.now() - fetchedAt) / 1000) : 0;
  const elapsed = running ? ses.elapsed_sec + delta : 0;
  const remaining = running ? ses.remaining_sec - delta : 0;
  const delayed = running && remaining < 0;
  const st = delayed ? STATUS.DELAYED : STATUS[g.status];
  const soon = running && !delayed && remaining <= ALERT_SECONDS;
  const pending = g.status === 'PENDING';
  const d = draft || {};
  // effective duration = what the timer counts down from
  const total = running ? Math.max(Number(ses.effective_seconds) || ses.expected_minutes * 60, 1) : 1;
  const pct = running ? Math.min((elapsed / total) * 100, 100) : 0;
  const loss = g.status === 'COMPLETED' && g.quantity > 0 ? Math.round((Number(g.wastage_weight) / g.quantity) * 10000) / 100 : null;

  return (
    <View style={[s.card, { borderLeftWidth: 5, borderLeftColor: st.color }, delayed && { borderColor: COLORS.danger }, soon && { borderColor: COLORS.warn }]}>
      <View style={s.head}>
        <View style={[s.mIcon, { backgroundColor: st.bg }]}><MCI name={st.icon} size={22} color={st.color} /></View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.mat} numberOfLines={1}>{g.product_name}</Text>
          <Text style={s.sub} numberOfLines={1}>{g.batch_no}  •  Blending</Text>
        </View>
        <Chip st={st} />
      </View>

      {g.status === 'WAITING' && (
        <View style={s.waitBox}><MCI name="clock-outline" size={17} color={COLORS.warn} /><Text style={s.waitText}>{g.reason}</Text></View>
      )}

      {/* ----- not started: machine, start time, configured (read-only) + manual override + reason ----- */}
      {pending && (
        <View>
          <StatGrid><Stat label="QUANTITY" value={`${fmt(g.quantity)} kg`} strong wide /></StatGrid>
          <IngredientList items={g.ingredients} total={g.quantity} />
          <View style={s.formBox}>
            <SectionLabel>START BLENDING</SectionLabel>
            <SelectField label="Blending machine *" value={d.machine_id || null} options={machines} onChange={(v) => setDraft({ machine_id: v })} error={err && err.machine} />
            {!machines.length && <Text style={s.noMachine}>No blending machine is available right now.</Text>}
            <TimeField label="Start time *" value={d.start_time || ''} onChangeText={(t) => setDraft({ start_time: t })} error={err && err.start} />
            <DurationFields configuredSec={g.planned_seconds} manual={d.manual} reason={d.reason} onChange={setDraft} err={err} />
            <View style={s.endPill}>
              <MCI name="flag-checkered" size={17} color={COLORS.green} />
              <Text style={s.endLabel}>Expected completion</Text>
              <Text style={s.endValue}>{previewEnd(d.start_time, checkDuration(g.planned_seconds, d.manual, d.reason).effMin)}</Text>
            </View>
          </View>
          {!!(err && err.server) && <Text style={s.err}>{err.server}</Text>}
          {canAct && (
            <Button mode="contained" icon="play" buttonColor={COLORS.green} style={s.btn} contentStyle={s.btnContent} labelStyle={s.btnLabel}
              loading={busy} disabled={busy || !machines.length} onPress={onStart}>Start</Button>
          )}
        </View>
      )}

      {g.status === 'WAITING' && <StatGrid><Stat label="QUANTITY" value={`${fmt(g.quantity)} kg`} strong wide /></StatGrid>}

      {/* ----- running: live timer ----- */}
      {running && (
        <View>
          <View style={[s.timer, { backgroundColor: st.bg }]}>
            <Text style={[s.timerLabel, { color: st.color }]}>{delayed ? 'OVER EXPECTED TIME' : soon ? 'COMPLETING SOON' : 'RUNNING FOR'}</Text>
            <Text style={[s.timerVal, { color: st.color }]}>{delayed ? `+${clock(remaining)}` : clock(elapsed)}</Text>
            <View style={s.timerTrack}><View style={[s.timerFill, { width: `${pct}%`, backgroundColor: st.color }]} /></View>
            <Text style={s.timerSub}>{delayed ? `Elapsed ${clock(elapsed)} · the machine keeps running until you press Stop` : `Time left ${clock(remaining)}  ·  Effective ${fmtDuration(total)}`}</Text>
          </View>
          <StatGrid>
            <Stat label="QUANTITY" value={`${fmt(g.quantity)} kg`} strong />
            <Stat label="MACHINE" value={`${ses.machine_code} · ${ses.machine_name}`} />
            <Stat label="START TIME" value={t12(ses.start_time)} />
            <Stat label="EXPECTED COMPLETION" value={t12(ses.expected_end)} strong color={delayed ? COLORS.danger : undefined} />
            <Stat label="CONFIGURED" value={durText(ses.configured_seconds)} />
            <Stat label="MANUAL" value={durText(ses.manual_seconds)} color={ses.manual_seconds ? COLORS.warn : undefined} />
          </StatGrid>
          <IngredientList items={g.ingredients} total={g.quantity} />
          {!!ses.duration_change_reason && <Text style={s.byLine}>Duration changed: {ses.duration_change_reason}</Text>}
          <Text style={s.byLine}>Started by {ses.started_by_name}</Text>
          {canAct && <Button mode="contained" icon="stop-circle-outline" buttonColor={COLORS.danger} style={s.btn} contentStyle={s.btnContent} labelStyle={s.btnLabel}
            loading={busy} disabled={busy} onPress={onStop}>Stop / Complete</Button>}
        </View>
      )}

      {/* ----- completed ----- */}
      {g.status === 'COMPLETED' && (
        <View>
          <StatGrid>
            <Stat label="MACHINE" value={g.machine_name ? `${g.machine_code} · ${g.machine_name}` : '–'} wide />
            <Stat label="START TIME" value={`${t12(g.start_time)}  ${dmy(g.start_time)}`} />
            <Stat label="END TIME" value={g.end_time ? `${t12(g.end_time)}  ${dmy(g.end_time)}` : '–'} strong />
            <Stat label="MIXING DURATION" value={g.mixing_duration_min ? `${g.mixing_duration_min} min` : '–'} />
            <Stat label="I/P → O/P" value={`${fmt(g.quantity)} → ${fmt(g.output_weight)} kg`} />
            {loss !== null && <Stat label="LOSS" value={`${fmt(g.wastage_weight)} kg · ${loss} %`} strong color={loss > 12 ? COLORS.danger : COLORS.ok} />}
          </StatGrid>
          <Pressable onPress={onView} style={s.viewLink}><Text style={s.viewText}>View full details</Text><MCI name="chevron-right" size={18} color={COLORS.primary} /></Pressable>
        </View>
      )}
    </View>
  );
}

/* ------------------------------ stop / complete dialog ------------------------------ */
function StopModal({ g, onDismiss, onDone }) {
  const [out, setOut] = useState('');
  const [remarks, setRemarks] = useState('');
  const [eOut, setEOut] = useState('');
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const gid = g ? g.batch_id : null;
  useEffect(() => { if (gid) { setOut(''); setRemarks(''); setEOut(''); setErr(''); setSaving(false); } }, [gid]);
  if (!g) return null;
  const ip = Number(g.session.input_weight || g.quantity);
  const op = Number(out);
  const wastage = ip > 0 && op > 0 ? Math.round((ip - op) * 1000) / 1000 : null;
  const loss = ip > 0 && op > 0 && op <= ip + 0.01 ? Math.round(((ip - op) / ip) * 10000) / 100 : null;

  const save = async () => {
    if (!(op > 0)) { setEOut('Enter the total blended weight'); return; }
    if (op > ip + 0.01) { setEOut(`Cannot be more than total ingredients (${fmt(ip)} kg)`); return; }
    setEOut(''); setSaving(true); setErr('');
    try {
      const r = await api.post('/blending/stop', { session_id: g.session.id, output_weight: out, remarks: remarks.trim() || undefined });
      setSaving(false);
      onDone(r.data.data);
    } catch (x) { setErr(errMsg(x)); setSaving(false); }
  };

  return (
    <ModalShell visible={!!g} onDismiss={onDismiss} busy={saving} icon="stop-circle-outline" maxWidth={560}
      title="Stop Blending" subtitle={`${g.product_name}  •  ${g.batch_no}`}
      footer={<ModalFooter onCancel={onDismiss} onSave={save} saving={saving} label="Stop & Save" />}>
      <View>
        <View style={s.stopInfo}>
          <Text style={s.stopInfoText}>The end time is taken automatically when you press Stop & Save. The batch then moves to Packing and this entry cannot be edited.</Text>
        </View>
        <FormRow>
          <FormField label="Total ingredients (kg)" value={String(fmt(ip))} editable={false} />
          <FormField label="Total blended weight (kg) *" numeric value={out} onChangeText={setOut} error={eOut} />
        </FormRow>
        <Text style={{ color: loss !== null && loss > 12 ? COLORS.danger : COLORS.grey, fontWeight: '700', marginBottom: 8 }}>
          Wastage: {wastage === null ? '–' : `${fmt(wastage)} kg`}   |   Loss: {loss === null ? '–' : `${loss} %`}
        </Text>
        <FormField label="Remarks" multiline value={remarks} onChangeText={setRemarks} maxLength={255} />
        <ErrorBox text={err} />
      </View>
    </ModalShell>
  );
}

/* ------------------------------ history tab ------------------------------ */
function HistoryList({ search }) {
  const grid = useCardCols({ min: 300, phoneMin: 280 });
  const list = usePagedList('/blending', { search: search || undefined });
  const [detailId, setDetailId] = useState(null);
  if (list.loading) return <LoadingView />;
  if (list.error && !list.items.length) return <EmptyView error={list.error} onRetry={list.reload} />;
  return (
    <>
      <CardList {...grid} data={list.items} keyExtractor={(i) => String(i.id)}
        refreshControl={<RefreshControl refreshing={list.refreshing} onRefresh={list.refresh} colors={[COLORS.primary]} />}
        onEndReached={list.loadMore} onEndReachedThreshold={0.4}
        ListEmptyComponent={<EmptyView icon="🗂️" message="No completed blending records yet" />}
        ListFooterComponent={list.loadingMore ? <ActivityIndicator style={{ margin: 16 }} color={COLORS.primary} /> : null}
        renderItem={(i) => (
          <Pressable onPress={() => setDetailId(i.id)} style={[s.card, { borderLeftWidth: 5, borderLeftColor: COLORS.ok }]}>
            <View style={[s.head, { marginBottom: 6 }]}>
              <View style={[s.mIcon, { backgroundColor: COLORS.okBg }]}><MCI name="check-circle-outline" size={22} color={COLORS.ok} /></View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.mat} numberOfLines={1}>{i.product_name}</Text>
                <Text style={s.sub} numberOfLines={1}>{i.batch_no}</Text>
              </View>
              <Chip st={STATUS.COMPLETED} />
            </View>
            <StatGrid>
              <Stat label="MACHINE" value={i.machine_name || '–'} wide />
              <Stat label="START" value={`${t12(i.start_time)}  ${dmy(i.start_time)}`} />
              <Stat label="MIXING DURATION" value={i.mixing_duration_min ? `${i.mixing_duration_min} min` : '–'} />
              <Stat label="CONFIGURED" value={durText(i.configured_seconds)} />
              <Stat label="MANUAL" value={durText(i.manual_seconds)} />
              <Stat label="EFFECTIVE" value={durText(i.effective_seconds)} />
              <Stat label="ACTUAL" value={durText(i.actual_seconds)} strong />
              <Stat label="DURATION SOURCE" value={i.manual_seconds ? 'Manually changed' : 'Default (configured)'} color={i.manual_seconds ? COLORS.warn : COLORS.ok} wide />
              <Stat label="I/P → O/P" value={`${fmt(i.total_input_weight)} → ${fmt(i.output_weight)} kg`} />
              <Stat label="WASTAGE" value={`${fmt(i.wastage_weight)} kg`} />
            </StatGrid>
            {!!i.duration_change_reason && <Text style={s.byLine}>Reason: {i.duration_change_reason}</Text>}
          </Pressable>
        )} />
      <BlendingDetailModal visible={detailId !== null} id={detailId} onDismiss={() => setDetailId(null)} />
    </>
  );
}

/* ------------------------------ the board ------------------------------ */
export default function BlendingListScreen() {
  const { can } = useAuth();
  const { toast } = useUi();
  const canAct = can('blending', 'create');
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
  const [busyKey, setBusyKey] = useState(null);
  const [stopFor, setStopFor] = useState(null);
  const [overrideFor, setOverrideFor] = useState(null);
  const [selBatch, setSelBatch] = useState(null);     // batch opened (null = list of batches)
  const [detailId, setDetailId] = useState(null);
  const [, setTick] = useState(0);
  const fetchedAt = useRef(Date.now());

  const load = useCallback(async (quiet) => {
    try {
      const r = await api.get('/blending/queue', { params: { search: dSearch || undefined } });
      fetchedAt.current = Date.now();
      setData(r.data.data); setError('');
    } catch (e) { if (!quiet) setError(errMsg(e)); }
  }, [dSearch]);
  useEffect(() => { setData(null); load(false); }, [load]);
  useFocusEffect(useCallback(() => { load(true); }, [load]));
  useEffect(() => { const t = setInterval(() => load(true), 20000); return () => clearInterval(t); }, [load]);
  useEffect(() => { const t = setInterval(() => setTick((n) => n + 1), 1000); return () => clearInterval(t); }, []);

  const machineOpts = useMemo(() => (data ? data.machines.map((m) => ({ value: m.id, label: `${m.machine_code} - ${m.machine_name}` })) : []), [data]);
  const kOf = (g) => statusOf(g, fetchedAt.current);
  const detail = selBatch && data ? data.items.find((g) => g.batch_id === selBatch) || null : null;
  useEffect(() => { if (selBatch && data && !data.items.some((g) => g.batch_id === selBatch)) setSelBatch(null); });
  const batchList = data ? data.items.filter((g) => status === 'ALL' || kOf(g) === status) : [];
  const countOf = (k) => (data ? data.items.filter((g) => kOf(g) === k).length : 0);
  const chips = [{ value: 'ALL', label: `All${data ? ` (${data.items.length})` : ''}` }].concat(
    ['RUNNING', 'PENDING', 'WAITING', 'COMPLETED', 'DELAYED'].map((k) => ({ value: k, label: `${STATUS[k].label.charAt(0)}${STATUS[k].label.slice(1).toLowerCase()}${data ? ` (${countOf(k)})` : ''}` })));

  const draftOf = (g) => {
    const d = drafts[g.batch_id] || {};
    return { machine_id: d.machine_id, start_time: d.start_time !== undefined ? d.start_time : nowHHMM(), manual: d.manual !== undefined ? d.manual : '', reason: d.reason || '' };
  };
  const setDraft = (g) => (patch) => { setDrafts((p) => ({ ...p, [g.batch_id]: { ...draftOf(g), ...patch } })); setErrs((p) => ({ ...p, [g.batch_id]: undefined })); };

  const start = async (g, confirmed) => {
    const d = draftOf(g);
    const { e, changed } = checkDuration(g.planned_seconds, d.manual, d.reason);
    if (!d.machine_id) e.machine = 'Select a machine';
    if (!TIME_RE.test(d.start_time || '')) e.start = 'Select the start time';
    if (Object.keys(e).length) { setErrs((p) => ({ ...p, [g.batch_id]: e })); return; }
    if (changed && !confirmed) { setOverrideFor(g); return; }
    setOverrideFor(null);
    setBusyKey(g.batch_id);
    try {
      await api.post('/blending/start', { batch_id: g.batch_id, machine_id: d.machine_id, start_time: d.start_time,
        manual_minutes: d.manual !== '' ? Number(d.manual) : undefined, duration_reason: changed ? d.reason.trim() : undefined });
      setDrafts((p) => ({ ...p, [g.batch_id]: undefined }));
      toast(`${g.batch_no} blending started`);
      await load(true);
    } catch (x) { setErrs((p) => ({ ...p, [g.batch_id]: { server: errMsg(x) } })); await load(true); }
    setBusyKey(null);
  };
  const onStopped = () => {
    const g = stopFor; setStopFor(null);
    toast(`${g.batch_no} blending completed - batch moved to Packing`);
    load(true);
  };

  const backToBatches = () => { setSelBatch(null); setStatus('ALL'); };

  return (
    <View style={s.wrap}>
      <PageToolbar icon="blender" title="Blending" count={tab === 'queue' ? (detail ? 1 : batchList.length) : undefined} noun="batch"
        search={search} onSearch={setSearch} placeholder="Search batch / product" />
      <Container>
        <FilterChips options={[{ value: 'queue', label: 'Batches' }, { value: 'history', label: 'History' }]} value={tab} onChange={setTab} />
        {tab === 'queue' && detail && <BatchHeader g={detail} k={kOf(detail)} onBack={backToBatches} />}
        {tab === 'queue' && !detail && <FilterChips options={chips} value={status} onChange={setStatus} />}
      </Container>

      <Container fill>
        {tab === 'history' ? <HistoryList search={dSearch} />
          : !data && !error ? <LoadingView />
            : error && !data ? <EmptyView error={error} onRetry={() => load(false)} />
              : detail ? (
                <CardList {...grid} key={`d${detail.batch_id}-${grid.cols}`} data={[detail]} keyExtractor={(g) => `d${g.batch_id}`}
                  refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(true); setRefreshing(false); }} colors={[COLORS.primary]} />}
                  ListHeaderComponent={data.busy_machines.length ? (
                    <Text style={s.busyNote}>Busy machines: {data.busy_machines.map((m) => `${m.machine_code} (${m.batch_no})`).join(', ')}</Text>
                  ) : null}
                  renderItem={(g) => (
                    <BlendCard g={g} machines={machineOpts} canAct={canAct} fetchedAt={fetchedAt.current}
                      draft={draftOf(g)} setDraft={setDraft(g)} err={errs[g.batch_id]} busy={busyKey === g.batch_id}
                      onStart={() => start(g)} onStop={() => setStopFor(g)} onView={() => setDetailId(g.blending_id)} />
                  )} />
              ) : (
                <CardList {...grid} key={`batches-${status}-${grid.cols}`} data={batchList} keyExtractor={(g) => `b${g.batch_id}`}
                  refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(true); setRefreshing(false); }} colors={[COLORS.primary]} />}
                  ListEmptyComponent={<EmptyView icon="🥣" message={`No batches ${status === 'ALL' ? 'yet' : 'with this status'}. Batches appear here after Grinding.`} />}
                  ListHeaderComponent={data && data.busy_machines.length ? (
                    <Text style={s.busyNote}>Busy machines: {data.busy_machines.map((m) => `${m.machine_code} (${m.batch_no})`).join(', ')}</Text>
                  ) : null}
                  renderItem={(g) => <BatchCard g={g} k={kOf(g)} onPress={() => { setSelBatch(g.batch_id); setStatus('ALL'); }} />} />
              )}
      </Container>

      <StopModal g={stopFor} onDismiss={() => setStopFor(null)} onDone={onStopped} />
      <ConfirmDialog visible={!!overrideFor} busy={busyKey !== null} title="Change duration?"
        message={overrideFor ? overrideMessage(overrideFor.planned_seconds, draftOf(overrideFor).manual, draftOf(overrideFor).reason) : ''}
        confirmText="Yes, start" onCancel={() => setOverrideFor(null)} onConfirm={() => overrideFor && start(overrideFor, true)} />
      <BlendingDetailModal visible={detailId !== null} id={detailId} onDismiss={() => setDetailId(null)} />
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: COLORS.bg, paddingLeft: 10 },
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
  ingBox: { backgroundColor: '#FDFBF8', borderRadius: 14, borderWidth: 1, borderColor: COLORS.border, padding: 12, marginTop: 8 },
  ingRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 7, paddingHorizontal: 6, borderBottomWidth: 1, borderBottomColor: COLORS.line },
  ingName: { flex: 1, fontSize: 13, fontWeight: '700', color: COLORS.text },
  ingQty: { width: 84, textAlign: 'right', fontSize: 13, fontWeight: '700', color: COLORS.text },
  ingPct: { width: 58, textAlign: 'right', fontSize: 13, fontWeight: '800', color: COLORS.primary },
  timerTrack: { alignSelf: 'stretch', height: 6, borderRadius: 3, backgroundColor: 'rgba(0,0,0,0.08)', overflow: 'hidden', marginTop: 8, marginBottom: 6 },
  timerFill: { height: 6, borderRadius: 3 },
  timer: { borderRadius: 14, padding: 14, alignItems: 'center', marginTop: 4 },
  timerLabel: { fontSize: 10.5, fontWeight: '900', letterSpacing: 0.8 },
  timerVal: { fontSize: 38, fontWeight: '900', letterSpacing: 1, marginVertical: 2 },
  timerSub: { fontSize: 12, fontWeight: '700', color: COLORS.grey, textAlign: 'center' },
  viewLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', marginTop: 8 },
  viewText: { color: COLORS.primary, fontWeight: '800', fontSize: 13 },
  stopInfo: { backgroundColor: COLORS.greyBg, borderRadius: 10, padding: 10, marginBottom: 12 },
  stopInfoText: { color: COLORS.textSoft, fontSize: 12.5, fontWeight: '600', lineHeight: 18 },
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