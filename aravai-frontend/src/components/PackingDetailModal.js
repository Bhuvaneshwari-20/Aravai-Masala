import React, { useEffect, useState } from 'react';
import { View, Platform } from 'react-native';
import { Text, Button, ActivityIndicator } from 'react-native-paper';
import api, { errMsg } from '../api';
import ModalShell from './ModalShell';
import { printPacking } from '../printDoc';
import { COLORS, fmt } from '../theme';
import { MaterialCommunityIcons as MCI } from '@expo/vector-icons';
import { downloadPackingPdf } from '../pdfDoc';
const dash = (v, unit = '') => (v === null || v === undefined || v === '' ? '—' : `${fmt(v)}${unit}`);
const money = (v) => (v === null || v === undefined ? '—' : `₹${fmt(v)}`);
const cap = (s) => { const t = String(s || '').replace('_', ' ').toLowerCase(); return t.charAt(0).toUpperCase() + t.slice(1); };
const HL_KEY = { bg: COLORS.warnBg, bar: COLORS.primary };     // highlight for Product

// Defined OUTSIDE the modal so it is not re-created on every render.
function Section({ title, children }) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={{ fontSize: 11, fontWeight: '900', letterSpacing: 1.4, color: COLORS.grey, marginBottom: 6 }}>{title}</Text>
<View style={{ borderWidth: 1, borderColor: COLORS.border, borderRadius: 14, backgroundColor: '#FFFDF9', paddingHorizontal: 12, overflow: 'hidden' }}>        {children}
      </View>
    </View>
  );
}
function Row({ label, value, color, last, bold, hl, icon }) {
  return (
    <View style={[{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 9,
      borderBottomWidth: last ? 0 : 1, borderBottomColor: COLORS.border },
      hl && { backgroundColor: hl.bg, marginHorizontal: -12, paddingHorizontal: 12, borderLeftWidth: 4, borderLeftColor: hl.bar }]}>
      <Text style={{ color: hl ? COLORS.text : COLORS.grey, fontWeight: hl ? '800' : '600', fontSize: 13, flex: 1, paddingRight: 10 }}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', flexShrink: 1 }}>
        {!!icon && <MCI name={icon.name} size={20} color={icon.color} style={{ marginRight: 6 }} />}
        <Text style={[{ color: COLORS.text, fontWeight: bold || hl ? '900' : '700', fontSize: hl ? 15 : 14, textAlign: 'right', flexShrink: 1 }, color && { color }]}>{value}</Text>
      </View>
    </View>
  );
}
// Read-only details of one packing entry (opened by tapping a card on the Packing list).
export default function PackingDetailModal({ visible, id, onDismiss }) {
  const [d, setD] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!visible || !id) return;
    setD(null); setErr(''); setLoading(true);
    api.get(`/packing/${id}`)
      .then((r) => setD(r.data.data))
      .catch((e) => setErr(errMsg(e)))
      .finally(() => setLoading(false));
  }, [visible, id]);

  const left = d ? Number(d.batch_output_kg) - Number(d.batch_packed_kg) : 0;
  const nothingLeft = !!d && left <= 0.001;            // everything is packed
  const batchDone = !!d && d.batch_status === 'COMPLETED';
  return (
    <ModalShell visible={visible} onDismiss={onDismiss} icon="package-variant-closed" maxWidth={640}
      title="Packing details" subtitle={d ? `${d.batch_no} · ${d.product_name} · ${d.packing_size_label}` : 'Loading…'}
      footer={(
        <View style={{ flexDirection: 'row' }}>
                   {Platform.OS === 'web' && (
            <>
              <Button mode="contained" icon="printer" disabled={!d} onPress={() => printPacking(d)} buttonColor={COLORS.green}
                style={{ borderRadius: 10, marginRight: 10 }}>Print</Button>
              <Button mode="contained" icon="download" disabled={!d} onPress={() => downloadPackingPdf(d)} buttonColor={COLORS.primary}
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
            <Section title="PACKING RUN">
              <Row label="Batch" value={d.batch_no} />
<Row label="Product" value={d.product_name} hl={HL_KEY} color={COLORS.primary} />
              <Row label="Pack size" value={`${d.sku_code} · ${d.packing_size_label}`} />
              <Row label="Date" value={d.packing_date} />
              <Row label="Machine" value={`${d.machine_code} · ${d.machine_name}`} />
              <Row label="Operator" value={d.operator_name} />
              <Row label="Status" value={String(d.status).replace('_', ' ')} color={d.status === 'COMPLETED' ? COLORS.ok : undefined} last />
            </Section>

            <Section title="PACKETS">
              <Row label="Total packets" value={fmt(d.total_bag_count)} />
              <Row label="Accepted packets" value={fmt(d.accepted_bag_count)} color={COLORS.ok} />
              <Row label="Rejected packets" value={fmt(d.rejected_bag_count)} color={d.rejected_bag_count ? COLORS.danger : undefined} last />
            </Section>

            <Section title="WEIGHT">
              <Row label="Pack size (per packet)" value={dash(d.bag_size_grams, ' g')} />
              <Row label="Packed (packets × pack size)" value={dash(d.total_packing_weight, ' kg')} bold />
              <Row label="Overall packet weight (entered)" value={dash(d.overall_weight_kg, ' kg')} />
              <Row label="Average per packet (from overall weight)" value={dash(d.actual_weight, ' g')} />
              <Row label="Accepted weight" value={dash(d.accepted_weight, ' kg')} />
              <Row label="Rejected weight" value={dash(d.rejected_weight, ' kg')} last />
            </Section>

            <Section title="PRICE AND COST (AT THE TIME OF PACKING)">
              <Row label="MRP per packet" value={money(d.mrp_snapshot)} />
              <Row label="Packet rate" value={money(d.bag_rate_snapshot)} />
              <Row label="Pouch material cost per packet" value={money(d.bag_material_cost_snapshot)} />
              <Row label="Production rate per packet" value={money(d.production_rate_snapshot)} />
              <Row label="Total pouch material cost" value={money(d.total_bag_material_cost)} />
<Row label="Production cost" value={money(d.production_cost)} hl={{ bg: COLORS.warnBg, bar: COLORS.warn }} color={COLORS.primary} last />            </Section>

            <Section title="MACHINE COUNTERS">
              <Row label="Auger count" value={dash(d.auger_count)} />
              <Row label="Puller count" value={dash(d.puller_count)} />
              <Row label="Production count" value={dash(d.production_count)} last />
            </Section>

            <Section title="BATCH WEIGHT">
              <Row label="Initial weight (at batching)" value={Number(d.batching_kg) > 0 ? `${fmt(d.batching_kg)} kg` : '—'} />
              <Row label="Output weight" value={dash(d.batch_output_kg, ' kg')} />
              <Row label={`Packed so far (${d.batch_runs} ${Number(d.batch_runs) === 1 ? 'entry' : 'entries'})`} value={dash(d.batch_packed_kg, ' kg')} />
<Row label="Left to pack" value={`${fmt(Math.max(left, 0))} kg`}
  hl={nothingLeft ? { bg: COLORS.okBg, bar: COLORS.ok } : { bg: COLORS.warnBg, bar: COLORS.warn }}
  color={nothingLeft ? COLORS.ok : COLORS.warn} icon={nothingLeft ? { name: 'check-circle', color: COLORS.ok } : null} />
<Row label="Batch stage" value={batchDone ? 'Completed' : `${cap(d.batch_stage)} · ${cap(d.batch_status)}`}
  color={batchDone ? COLORS.ok : COLORS.warn} icon={{ name: batchDone ? 'check-circle' : 'progress-clock', color: batchDone ? COLORS.ok : COLORS.warn }} last />
              </Section>

            {!!d.remarks && (
              <Section title="REMARKS">
                <Row label="Note" value={d.remarks} last />
              </Section>
            )}
            <Text style={{ color: COLORS.grey, fontSize: 11.5, textAlign: 'center' }}>Saved {String(d.created_at || '').slice(0, 16)}</Text>
          </View>
        )}
    </ModalShell>
  );
}