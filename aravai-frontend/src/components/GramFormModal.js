import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import api, { errMsg } from '../api';
import ModalShell from './ModalShell';
import FormField from './FormField';
import { ErrorBox, ModalFooter } from './FormBits';

// Add one gram size (50, 100, 200, 500 ...). It then shows up in the Product form's gram list.
export default function GramFormModal({ visible, onDismiss, onSaved }) {
  const [grams, setGrams] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => { if (visible) { setGrams(''); setError(''); setErr(''); setSaving(false); } }, [visible]);

  const save = async () => {
    if (!grams || Number(grams) <= 0) return setError('Enter the gram (for example 50, 100, 500)');
    setError(''); setSaving(true); setErr('');
    try {
      await api.post('/grams', { weight_grams: grams });
      setSaving(false);
      onSaved && onSaved();
    } catch (x) { setErr(errMsg(x)); setSaving(false); }
  };

  return (
    <ModalShell visible={visible} onDismiss={onDismiss} busy={saving} icon="scale" maxWidth={420} title="Add Gram" subtitle="Pack size used in products"
      footer={<ModalFooter onCancel={onDismiss} onSave={save} saving={saving} label="Save Gram" />}>
      <View>
        <FormField label="Gram *" numeric value={grams} onChangeText={setGrams} error={error} maxLength={10} />
        <ErrorBox text={err} />
      </View>
    </ModalShell>
  );
}
