import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Text, Button } from 'react-native-paper';
import { MaterialCommunityIcons as MCI } from '@expo/vector-icons';
import api, { errMsg } from '../api';
import ModalShell from './ModalShell';
import FormField from './FormField';
import SelectField from './SelectField';
import PermissionEditor, { defaultsForRole, cleanFromServer } from './PermissionEditor';
import { useAuth } from '../AuthContext';
import { COLORS } from '../theme';

// Create (no account) or Edit (account) a user, as a popup.
// Super Admin -> name, username, password, role (roles table) AND the sidebar menus + permission switches of this one person
//                (saved per user in user_permissions, enforced by the server on every request).
// Admin       -> creates Users (role is fixed, no pickers).
export default function AccountFormModal({ visible, account, onDismiss, onSaved }) {
  const { user } = useAuth();
  const isSuper = user.role_name === 'Super Admin';
  const noun = 'User';
  const isEdit = !!account;

  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [roleId, setRoleId] = useState(null);
  const [rolesRaw, setRolesRaw] = useState([]);   // roles + role_permissions from the server; the Super Admin's own role is left out
  const [perms, setPerms] = useState({});         // { module: { action: true } } - the ticked menus and their switches
  const [errors, setErrors] = useState({});
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);

  const roles = rolesRaw.map((x) => ({ value: x.id, label: x.role_name }));

  useEffect(() => {
    if (!visible) return;
    setName(account?.full_name || ''); setUsername(account?.username || ''); setPassword('');
    setRoleId(account?.role_id ?? null); setPerms({});
    setErrors({}); setErr(''); setSaving(false);
  }, [visible, account]); // eslint-disable-line

  useEffect(() => {
    if (!visible || !isSuper) return;
    api.get('/accounts/roles/permissions')
      .then((r) => setRolesRaw(r.data.data.filter((x) => x.role_name !== user.role_name)))
      .catch(() => {});
  }, [visible, isSuper]); // eslint-disable-line

  // editing: load what this person has today (his saved permissions, or what his role gives him)
  useEffect(() => {
    if (!visible || !isSuper || !account) return;
    let live = true;
    api.get(`/accounts/${account.id}/permissions`)
      .then((r) => { if (live) setPerms(cleanFromServer(r.data.data.permissions)); })
      .catch(() => {});
    return () => { live = false; };
  }, [visible, isSuper, account]); // eslint-disable-line

  const pickRole = (id) => {
    setRoleId(id);
    setPerms(defaultsForRole(rolesRaw.find((x) => x.id === id)));   // a new role -> its default menus, still editable
    setErrors((e) => ({ ...e, role: undefined }));
  };

  const validate = () => {
    const e = {};
    if (!name.trim()) e.name = 'Name is required';
    if (isSuper && !roleId) e.role = 'Please select a role';
    if (isSuper && roleId && Object.keys(perms).length === 0) e.menus = 'Select at least one sidebar menu';
    if (!isEdit && !username.trim()) e.username = 'Username is required';
    if ((!isEdit || password) && password.length < 8) e.password = 'Password must be at least 8 characters';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const save = async () => {
    if (!validate()) return;
    setSaving(true); setErr('');
    const extra = isSuper ? { role_id: roleId, permissions: perms } : {};
    try {
      if (isEdit) await api.put(`/accounts/${account.id}`, { full_name: name.trim(), password: password || undefined, ...extra });
      else await api.post('/accounts', { full_name: name.trim(), username: username.trim(), password, ...extra });
      setSaving(false);
      onSaved && onSaved(isEdit);
    } catch (e) { setErr(errMsg(e)); setSaving(false); }
  };

  return (
    <ModalShell visible={visible} onDismiss={onDismiss} busy={saving} icon={isEdit ? 'pencil' : 'account-plus'} maxWidth={520}
      title={isEdit ? `Edit ${noun}` : `Add ${noun}`} subtitle={isEdit ? `@${account.username}` : 'Fill in the details and save'}
      footer={(
        <View style={{ flexDirection: 'row' }}>
          <Button mode="outlined" onPress={onDismiss} disabled={saving} textColor={COLORS.text} style={{ borderRadius: 10, borderColor: COLORS.border, marginRight: 10 }}>Cancel</Button>
          <Button mode="contained" onPress={save} loading={saving} disabled={saving} buttonColor={COLORS.green} style={{ borderRadius: 10 }} icon="check">
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
        {isSuper && <SelectField label="Role *" value={roleId} options={roles} onChange={pickRole} error={errors.role} />}

        {isSuper && (
          <PermissionEditor value={perms} onChange={setPerms} error={errors.menus}
            hint={roleId ? undefined : 'Select a role first: its default menus and permissions are ticked here, and you can change them.'} />
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