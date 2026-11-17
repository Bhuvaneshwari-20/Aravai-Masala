import React from 'react';
import { View } from 'react-native';
import { Text, Button } from 'react-native-paper';
import FadeIn from './FadeIn';
import { COLORS } from '../theme';

// Used for both "no data" and "error" states. Pass onRetry to show a Retry button.
export default function EmptyView({ icon = '📭', title, message, error, onRetry }) {
  const tone = error ? COLORS.danger : COLORS.primary;
  return (
    <FadeIn style={{ alignItems: 'center', paddingHorizontal: 28, paddingVertical: 36, marginTop: 12 }}>
      <View style={{ width: 118, height: 118, borderRadius: 59, backgroundColor: `${tone}0F`, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ width: 86, height: 86, borderRadius: 43, backgroundColor: `${tone}1A`, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 40 }}>{error ? '⚠️' : icon}</Text>
        </View>
      </View>
      <Text style={{ marginTop: 18, textAlign: 'center', fontSize: 17, fontWeight: '800', color: error ? COLORS.danger : COLORS.text }}>
        {error ? 'Something went wrong' : (title || 'Nothing here yet')}
      </Text>
      <Text style={{ marginTop: 6, textAlign: 'center', fontSize: 14, lineHeight: 20, color: COLORS.grey, maxWidth: 340 }}>
        {error || message}
      </Text>
      {onRetry && <Button mode="contained" style={{ marginTop: 18, borderRadius: 12 }} buttonColor={COLORS.primary} icon="refresh" onPress={onRetry}>Retry</Button>}
    </FadeIn>
  );
}
