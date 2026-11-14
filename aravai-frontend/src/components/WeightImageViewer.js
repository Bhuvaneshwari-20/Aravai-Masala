import React, { useEffect, useState } from 'react';
import { View, Image, Pressable, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import ModalShell from './ModalShell';
import { bwStatus, batchWeightImageUri } from '../batchWeightImage';
import { fmtW } from '../weighing';
import { COLORS } from '../theme';

const when = (v) => (v ? String(v).replace('T', ' ').slice(0, 16) : '-');
const Line = ({ k, v, bold }) => (
  <View style={s.line}><Text style={s.k}>{k}</Text><Text style={[s.v, bold && { fontWeight: '900' }]}>{v || '-'}</Text></View>
);

// Read-only view of the weighing machine photo that was stored with one batching entry (batch + material).
export default function WeightImageViewer({ visible, batchId, ingredient, onDismiss }) {
  const [big, setBig] = useState(false);
  useEffect(() => { setBig(false); }, [visible, ingredient && ingredient.material_id]);
  const w = ingredient && ingredient.weight_image;
  if (!visible || !w) return null;
  const st = bwStatus(w.status);
  const uri = batchWeightImageUri(batchId, w);
  return (
    <ModalShell visible={visible} onDismiss={onDismiss} icon="image-search" maxWidth={560} title={ingredient.material_name}
      subtitle="Weighing machine photo">
      <View>
        <View style={[s.badge, { backgroundColor: st.bg }]}><Text style={[s.badgeText, { color: st.color }]}>{st.label}</Text></View>
        {!!uri && (
          <Pressable onPress={() => setBig(!big)}>
            <Image source={{ uri }} style={[s.img, big && { height: 480 }]} resizeMode="contain" />
            <Text style={s.tap}>Tap the photo to {big ? 'shrink' : 'enlarge'}</Text>
          </Pressable>)}
        <Line k="Entered weight" v={fmtW(w.entered_weight)} bold />
        <Line k="Machine display weight" v={w.detected_weight == null ? 'Not read' : fmtW(w.detected_weight)} bold />
        {w.status === 'MANUAL' && <Line k="Verified" v={`Manually by ${w.verified_by_name || 'supervisor'}: ${w.manual_reason || ''}`} />}
        <Line k="Photo by" v={w.uploaded_by_name} />
        <Line k="Date & time" v={when(w.created_at)} />
      </View>
    </ModalShell>
  );
}

const s = StyleSheet.create({
  badge: { alignSelf: 'flex-start', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 5, marginBottom: 10 },
  badgeText: { fontSize: 12, fontWeight: '900', letterSpacing: 0.5 },
  img: { width: '100%', height: 240, borderRadius: 14, backgroundColor: '#1d1210' },
  tap: { textAlign: 'center', color: COLORS.grey, fontSize: 12, fontWeight: '600', marginTop: 4, marginBottom: 8 },
  line: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  k: { color: COLORS.grey, fontWeight: '700' },
  v: { color: COLORS.text, fontWeight: '700', flexShrink: 1, textAlign: 'right', marginLeft: 12 },
});
