import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import api, { errMsg } from '../api';
import ModalShell from './ModalShell';
import FormField from './FormField';
import { ErrorBox, ModalFooter } from './FormBits';

export default function MeshFormModal({ visible, onDismiss, onSaved }) {
  const [mesh, setMesh] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => { if (visible) { setMesh(''); setError(''); setErr(''); setSaving(false); } }, [visible]);

  const save = async () => {
    if (!mesh || Number(mesh) <= 0) return setError('Enter the mesh size (for example 20, 40, 60)');
    setError(''); setSaving(true); setErr('');
    try {
      await api.post('/mesh', { mesh_size: mesh });
      setSaving(false);
      onSaved && onSaved();
    } catch (x) { setErr(errMsg(x)); setSaving(false); }
  };

  return (
    <ModalShell visible={visible} onDismiss={onDismiss} busy={saving} icon="grid" maxWidth={420} title="Add Mesh Size" subtitle="Used in the Grinding entry"
      footer={<ModalFooter onCancel={onDismiss} onSave={save} saving={saving} label="Save Mesh" />}>
      <View>
        <FormField label="Mesh size *" numeric value={mesh} onChangeText={setMesh} error={error} maxLength={10} />
        <ErrorBox text={err} />
      </View>
    </ModalShell>
  );
}