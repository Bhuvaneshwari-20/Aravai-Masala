import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Text, Button } from 'react-native-paper';
import { MaterialCommunityIcons as MCI } from '@expo/vector-icons';
import api, { errMsg } from '../api';
import ModalShell from './ModalShell';
import FormField from './FormField';
import SelectField from './SelectField';
import { useAuth } from '../AuthContext';
import { COLORS } from '../theme';

// Create (no account) or Edit (account) an Admin / staff user, as a popup.
// Super Admin -> creates Admins (role is fixed).   Admin -> creates staff users and chooses their Role.
export default function AccountFormModal({ visible, account, onDismiss, onSaved }) {
  const { user } = useAuth();
  const isSuper = user.role_name === 'Super Admin';
  const noun = isSuper ? 'Admin' : 'User';
  const isEdit = !!account;
  const needsRole = !isSuper && !isEdit;            // Admin adding a new user

  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [roleId, setRoleId] = useState(null);
  const [roles, setRoles] = useState([]);
  const [rolesLoading, setRolesLoading] = useState(false);
  const [errors, setErrors] = useState({});
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setName(account?.full_name || ''); setUsername(account?.username || ''); setPassword('');
    setRoleId(null); setErrors({}); setErr(''); setSaving(false);
    if (needsRole) {
      setRolesLoading(true);
      api.get('/accounts/roles')
        .then((r) => setRoles(r.data.data.map((x) => ({ value: x.id, label: x.role_name }))))
        .catch((e) => setErr(`Could not load roles: ${errMsg(e)}`))
        .finally(() => setRolesLoading(false));
    }
  }, [visible, account]); // eslint-disable-line

  const validate = () => {
    const e = {};
    if (!name.trim()) e.name = 'Name is required';
    if (!isEdit && !username.trim()) e.username = 'Username is required';
    if ((!isEdit || password) && password.length < 8) e.password = 'Password must be at least 8 characters';
    if (needsRole && !roleId) e.role = 'Select a role';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const save = async () => {
    if (!validate()) return;
    setSaving(true); setErr('');
    try {
      if (isEdit) await api.put(`/accounts/${account.id}`, { full_name: name.trim(), password: password || undefined });
      else await api.post('/accounts', { full_name: name.trim(), username: username.trim(), password, role_id: roleId || undefined });
      setSaving(false);
      onSaved && onSaved(isEdit);
    } catch (e) { setErr(errMsg(e)); setSaving(false); }
  };

  return (
    <ModalShell visible={visible} onDismiss={onDismiss} busy={saving} icon={isEdit ? 'pencil' : 'account-plus'} maxWidth={480}
      title={isEdit ? `Edit ${noun}` : `Add ${noun}`} subtitle={isEdit ? `@${account.username}` : 'Fill in the details and save'}
      footer={(
        <View style={{ flexDirection: 'row' }}>
          <Button mode="outlined" onPress={onDismiss} disabled={saving} textColor={COLORS.text} style={{ borderRadius: 10, borderColor: COLORS.border, marginRight: 10 }}>Cancel</Button>
          <Button mode="contained" onPress={save} loading={saving} disabled={saving || (needsRole && rolesLoading)} buttonColor={COLORS.green} style={{ borderRadius: 10 }} icon="check">
            {isEdit ? 'Update' : `Save ${noun}`}
          </Button>
        </View>
      )}>
      <View>
        <FormField label="Full name *" value={name} onChangeText={setName} error={errors.name} />
        <FormField label="Username *" value={username} onChangeText={setUsername} error={errors.username}
          autoCapitalize="none" autoCorrect={false} disabled={isEdit} />
        <FormField label={isEdit ? 'New password (leave blank to keep)' : 'Password * (min 8 characters)'}
          value={password} onChangeText={setPassword} error={errors.password} secureTextEntry autoCapitalize="none" />

        {/* Role */}
        {needsRole ? (
          <SelectField label="Role *" value={roleId} options={roles} onChange={setRoleId}
            error={errors.role} disabled={rolesLoading} />
        ) : (
          <FormField label="Role" value={isEdit ? account.role_name : 'Admin'} onChangeText={() => {}} disabled />
        )}

        {!!err && (
          <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.dangerBg, borderRadius: 10, padding: 10, marginTop: 8 }}>
            <MCI name="alert-circle" size={16} color={COLORS.danger} />
            <Text style={{ color: COLORS.danger, marginLeft: 8, flex: 1, fontWeight: '600' }}>{err}</Text>
          </View>
        )}
      </View>
    </ModalShell>
  );
}