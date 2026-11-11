import React from 'react';
import { Text, Button } from 'react-native-paper';
import { View } from 'react-native';
import ModalShell from './ModalShell';
import { COLORS } from '../theme';

export default function ConfirmDialog({ visible, title, message, confirmText = 'Yes', onConfirm, onCancel, busy }) {
  return (
    <ModalShell visible={visible} onDismiss={onCancel} title={title} icon="help-circle-outline" maxWidth={420} busy={busy}
      footer={(
        <View style={{ flexDirection: 'row' }}>
          <Button mode="outlined" onPress={onCancel} disabled={busy} textColor={COLORS.text} style={{ borderRadius: 10, borderColor: COLORS.border, marginRight: 10 }}>Cancel</Button>
          <Button mode="contained" onPress={onConfirm} loading={busy} disabled={busy} buttonColor={COLORS.green} style={{ borderRadius: 10 }}>{confirmText}</Button>
        </View>
      )}>
      <Text style={{ fontSize: 15, color: COLORS.text, lineHeight: 22, paddingBottom: 10 }}>{message}</Text>
    </ModalShell>
  );
}
