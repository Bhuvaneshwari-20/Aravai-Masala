import React from 'react';
import { View } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons as MCI } from '@expo/vector-icons';
import { COLORS } from '../theme';

// Read-only box: the weighing machine chosen in Batching for this batch (batch_master.weighing_machine_id).
// Every stage (Roasting, Grinding, Blending, Packing) uses this machine instead of its own machine list.
// `batch` needs weighing_machine_code / weighing_machine_name (the stage lookups return them).
export default function WeighingMachineInfo({ batch, label = 'WEIGHING MACHINE (FROM BATCHING)', style }) {
  if (!batch) return null;
  const name = [batch.weighing_machine_code, batch.weighing_machine_name].filter(Boolean).join(' - ');
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.greyBg, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10, minHeight: 56, marginBottom: 12 }, style]}>
      <MCI name="scale-balance" size={20} color={COLORS.grey} />
      <View style={{ marginLeft: 10, flex: 1 }}>
        <Text style={{ fontSize: 11, fontWeight: '800', color: COLORS.grey }}>{label}</Text>
        <Text style={{ fontSize: 15, fontWeight: '800', color: COLORS.text }}>{name || '—'}</Text>
      </View>
    </View>
  );
}