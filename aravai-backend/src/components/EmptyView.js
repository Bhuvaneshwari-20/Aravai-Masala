import React from 'react';
import { View } from 'react-native';
import { Text, Button } from 'react-native-paper';
import FadeIn from './FadeIn';
import { COLORS } from '../theme';

// Used for both "no data" and "error" states. Pass onRetry to show a Retry button.
export default function EmptyView({ icon = '📭', message, error, onRetry }) {
  return (
    <FadeIn style={{ alignItems: 'center', padding: 32, marginTop: 24 }}>
      <View style={{ width: 96, height: 96, borderRadius: 48, backgroundColor: error ? COLORS.dangerBg : '#FBE9DD', alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontSize: 44 }}>{error ? '⚠️' : icon}</Text>
      </View>
      <Text style={{ marginTop: 16, textAlign: 'center', fontSize: 15, color: error ? COLORS.danger : COLORS.grey }}>
        {error || message}
      </Text>
      {onRetry && <Button mode="contained" style={{ marginTop: 16 }} buttonColor={COLORS.primary} onPress={onRetry}>Retry</Button>}
    </FadeIn>
  );
}
