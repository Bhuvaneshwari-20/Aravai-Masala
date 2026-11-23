import React from 'react';
import { View } from 'react-native';
import ModalShell from './ModalShell';
import { MaterialTrace } from '../screens/overview/OverviewMaterialScreen';
import { COLORS } from '../theme';

export default function MaterialTraceModal({ visible, id, onDismiss }) {
  return (
    <ModalShell visible={visible} onDismiss={onDismiss} title="Material Trace" subtitle="Stock movement of this material"
      icon="clipboard-list" maxWidth={1200} centerInContent>
      <View style={{ minHeight: 320, backgroundColor: COLORS.bg, paddingBottom: 16 }}>
        {id ? <MaterialTrace id={id} embedded /> : null}
      </View>
    </ModalShell>
  );
}