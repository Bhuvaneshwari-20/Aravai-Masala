import React, { useEffect, useState } from 'react';
import { View, Platform } from 'react-native';
import { Text, Button, ActivityIndicator } from 'react-native-paper';
import api, { errMsg } from '../api';
import ModalShell from './ModalShell';
import { printProcess } from '../printDoc';
import { downloadProcessPdf } from '../pdfDoc';
import { COLORS, fmt } from '../theme';

const dash = (v, unit = '') => (v === null || v === undefined || v === '' ? '—' : `${fmt(v)}${unit}`);
const when = (t) => (t ? String(t).slice(0, 16) : '—');

function Section({ title, children }) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={{ fontSize: 11, fontWeight: '900', letterSpacing: 1.4, color: COLORS.grey, marginBottom: 6 }}>{title}</Text>
      <View style={{ borderWidth: 1, borderColor: COLORS.border, borderRadius: 14, backgroundColor: '#FFFDF9', paddingHorizontal: 12, overflow: 'hidden' }}>{children}</View>
    </View>
  );
}
function Row({ label, value, color, last, bold }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 9,
      borderBottomWidth: last ? 0 : 1, borderBottomColor: COLORS.border }}>
      <Text style={{ color: COLORS.grey, fontWeight: '600', fontSize: 13, flex: 1, paddingRight: 10 }}>{label}</Text>
      <Text style={[{ color: COLORS.text, fontWeight: bold ? '900' : '700', fontSize: 14, textAlign: 'right', flexShrink: 1 }, color && { color }]}>{value}</Text>
    </View>
  );
}

// Read-only details of one saved Filtering / Roasting / Grinding session.
export default function ProcessDetailModal({ visible, id, path, label, icon = 'file-document-outline', onDismiss }) {
  const [d, setD] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!visible || !id) return;
    setD(null); setErr(''); setLoading(true);
    api.get(`/${path}/session/${id}`)
      .then((r) => setD(r.data.data))
      .catch((e) => setErr(errMsg(e)))
      .finally(() => setLoading(false));
  }, [visible, id, path]);

  return (
    <ModalShell visible={visible} onDismiss={onDismiss} icon={icon} maxWidth={640}
      title={`${label} details`} subtitle={d ? `${d.batch_no} · ${d.material_name}` : 'Loading…'}
      footer={(
        <View style={{ flexDirection: 'row' }}>
          {Platform.OS === 'web' && (
            <>
              <Button mode="contained" icon="printer" disabled={!d} onPress={() => printProcess(d, label)} buttonColor={COLORS.green}
                style={{ borderRadius: 10, marginRight: 10 }}>Print</Button>
              <Button mode="contained" icon="download" disabled={!d} onPress={() => downloadProcessPdf(d, label)} buttonColor={COLORS.primary}
                style={{ borderRadius: 10, marginRight: 10 }}>Download</Button>
            </>
          )}
          <Button mode="outlined" onPress={onDismiss} textColor={COLORS.text} style={{ borderRadius: 10, borderColor: COLORS.border }}>Close</Button>
        </View>
      )}>
      {loading ? <View style={{ padding: 60 }}><ActivityIndicator color={COLORS.primary} /></View>
        : err ? <Text style={{ color: COLORS.danger, fontWeight: '600', padding: 12 }}>{err}</Text>
        : !d ? null : (
          <View>
            <Section title={`${label.toUpperCase()} RUN`}>
              <Row label="Batch" value={d.batch_no} />
              <Row label="Product" value={d.product_name} />
              <Row label="Material" value={d.material_name} />
              <Row label="Machine" value={`${d.machine_code} · ${d.machine_name}`} />
              <Row label="Started" value={when(d.start_time)} />
              <Row label="Expected completion" value={when(d.expected_end)} />
              <Row label="Ended" value={when(d.actual_end)} />
              <Row label="Expected duration" value={dash(d.expected_minutes, ' min')} />
              <Row label="Actual duration" value={dash(d.actual_minutes, ' min')} bold />
              <Row label="Status" value={String(d.status).replace('_', ' ')} color={d.status === 'COMPLETED' ? COLORS.ok : undefined} last />
            </Section>

            <Section title="WEIGHT">
              <Row label="I/P weight" value={dash(d.input_weight, ' kg')} />
              <Row label="O/P weight" value={dash(d.output_weight, ' kg')} color={COLORS.ok} bold />
              <Row label="Wastage" value={d.wastage_weight == null ? '—' : `${fmt(d.wastage_weight)} kg (${Number(d.loss_percent).toFixed(2)}%)`}
                color={Number(d.loss_percent) > 12 ? COLORS.danger : undefined} last />
            </Section>

            {d.process_type === 'ROASTING' && (
              <Section title="TEMPERATURE">
                <Row label="Temp before" value={dash(d.temp_before, ' °C')} />
                <Row label="STD temp" value={dash(d.std_temp, ' °C')} />
                <Row label="Temp after" value={dash(d.temp_after, ' °C')} last />
              </Section>
            )}
            {d.process_type === 'GRINDING' && (
              <Section title="GRINDING">
                <Row label="Mesh size" value={dash(d.mesh_size)} />
                <Row label="Sieved" value={d.sieved || '—'} last />
              </Section>
            )}

            <Section title="DONE BY">
              <Row label="Started by" value={d.started_by_name || '—'} />
              <Row label="Completed by" value={d.completed_by_name || '—'} last />
            </Section>

            {!!d.remarks && <Section title="REMARKS"><Row label="Note" value={d.remarks} last /></Section>}
          </View>
        )}
    </ModalShell>
  );
}