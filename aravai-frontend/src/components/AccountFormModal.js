import React, { useEffect, useRef, useState } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { Text, Button } from 'react-native-paper';
import { MaterialCommunityIcons as MCI } from '@expo/vector-icons';
import api, { errMsg } from '../api';
import ModalShell from './ModalShell';
import FormField from './FormField';
import SelectField from './SelectField';
import { useAuth } from '../AuthContext';
import { MENU, GROUPS } from '../menu';
import { COLORS } from '../theme';

// Create (no account) or Edit (account) an Admin / User, as a popup.
// Super Admin -> picks the role (roles table) AND the sidebar menus this person may open (saved in user_menu_access).
// Admin       -> creates Users (role is fixed, no pickers).
// The menu list is built from menu.js (the same groups the sidebar uses): Masters, Factory Administration, Production, Stock & Tracking ...
// 'users' (account management) is never offered: the accounts API is for Super Admin / Admin only, so it cannot be given to staff.
const NOT_FOR_STAFF = ['users'];
const GROUP_ITEMS = GROUPS.map((g) => ({
  title: g.title,
  items: g.modules.filter((m) => !NOT_FOR_STAFF.includes(m)).map((m) => MENU.find((x) => x.module === m)).filter(Boolean),
})).filter((g) => g.items.length);
const UNIVERSE = GROUP_ITEMS.flatMap((g) => g.items.map((i) => i.module));
const LABEL = Object.fromEntries(MENU.map((m) => [m.module, m.label]));

export default function AccountFormModal({ visible, account, onDismiss, onSaved }) {
  const { user } = useAuth();
  const isSuper = user.role_name === 'Super Admin';
  const noun = isSuper ? 'Admin' : 'User';
  const isEdit = !!account;

  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [roleId, setRoleId] = useState(null);
  const [rolesRaw, setRolesRaw] = useState([]);   // from the server (roles + role_permissions); the Super Admin's own role is left out
  const [sel, setSel] = useState([]);             // sidebar modules ticked for this person
  const touched = useRef(false);
  const [openG, setOpenG] = useState({});         // which menu groups are expanded (dropdown)
  const [errors, setErrors] = useState({});
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);

  const roles = rolesRaw.map((x) => ({ value: x.id, label: x.role_name }));
  const role = rolesRaw.find((x) => x.id === roleId);
  const showMenus = isSuper && !(role && role.full_access);       // Admin / Super Admin roles always have their fixed access

  // the menus a role has by default (role_permissions can_view = 1)
  const defaultsFor = (r) => (r && Array.isArray(r.permissions) ? r.permissions.filter((p) => p.can_view && UNIVERSE.includes(p.module)).map((p) => p.module) : []);

  useEffect(() => {
    if (!visible) return;
    touched.current = false; setOpenG({});
    setName(account?.full_name || ''); setUsername(account?.username || ''); setPassword('');
    setRoleId(account?.role_id ?? null);
    setSel(account && account.has_menu_override ? (account.menu_modules || []).filter((m) => UNIVERSE.includes(m)) : []);
    setErrors({}); setErr(''); setSaving(false);
  }, [visible, account]); // eslint-disable-line

  useEffect(() => {
    if (!visible || !isSuper) return;
    api.get('/accounts/roles/permissions')
      .then((r) => {
        const list = r.data.data.filter((x) => x.role_name !== user.role_name);
        setRolesRaw(list);
        // editing an account that has no menu choice saved yet: start from its role's default menus
        if (account && !account.has_menu_override && !touched.current) setSel(defaultsFor(list.find((x) => x.id === account.role_id)));
      })
      .catch(() => {});
  }, [visible, isSuper]); // eslint-disable-line

  const pickRole = (id) => {
    setRoleId(id);
    const r = rolesRaw.find((x) => x.id === id);
    if (r && !r.full_access) { touched.current = true; setSel(defaultsFor(r)); }   // a new role -> its default menus, still editable
  };
  const toggle = (m) => { touched.current = true; setSel((a) => (a.includes(m) ? a.filter((x) => x !== m) : [...a, m])); };
  const selectAll = () => { touched.current = true; setSel(UNIVERSE); };
  const clearAll = () => { touched.current = true; setSel([]); };
  const toggleGroup = (g) => {                                   // tick / untick a whole group
    touched.current = true;
    const mods = g.items.map((i) => i.module);
    setSel((a) => (mods.every((m) => a.includes(m)) ? a.filter((x) => !mods.includes(x)) : [...new Set([...a, ...mods])]));
  };
  const toggleOpen = (t) => setOpenG((o) => ({ ...o, [t]: !o[t] }));

  const validate = () => {
    const e = {};
    if (!name.trim()) e.name = 'Name is required';
    if (isSuper && !roleId) e.role = 'Please select a role';
    if (showMenus && roleId && sel.length === 0) e.menus = 'Select at least one sidebar menu';
    if (!isEdit && !username.trim()) e.username = 'Username is required';
    if ((!isEdit || password) && password.length < 8) e.password = 'Password must be at least 8 characters';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const save = async () => {
    if (!validate()) return;
    setSaving(true); setErr('');
    const menus = showMenus && roleId ? { menu_allowed: sel, menu_denied: UNIVERSE.filter((m) => !sel.includes(m)) } : {};
    try {
      if (isEdit) await api.put(`/accounts/${account.id}`, { full_name: name.trim(), password: password || undefined, role_id: isSuper ? roleId : undefined, ...menus });
      else await api.post('/accounts', { full_name: name.trim(), username: username.trim(), password, role_id: isSuper ? roleId : undefined, ...menus });
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

        {showMenus && (
          <View style={s.box}>
            <View style={s.head}>
              <MCI name="menu" size={18} color={COLORS.primary} />
              <Text style={s.title}>Assign Sidebar Menus</Text>
              <View style={{ flex: 1 }} />
              <Pressable onPress={selectAll} hitSlop={8}><Text style={s.link}>Select all</Text></Pressable>
              <Pressable onPress={clearAll} hitSlop={8} style={{ marginLeft: 14 }}><Text style={s.link}>Deselect all</Text></Pressable>
            </View>
            <Text style={s.hint}>{roleId ? 'Tap a group to open it. This person will see only the ticked menus after login (Dashboard is always shown).' : 'Select a role first, its default menus will be ticked here. You can change them.'}</Text>

            {GROUP_ITEMS.map((g) => {
              const mods = g.items.map((i) => i.module);
              const n = mods.filter((m) => sel.includes(m)).length;
              const all = n === mods.length;
              const open = !!openG[g.title];
              return (
                <View key={g.title} style={s.grp}>
                  <Pressable onPress={() => toggleOpen(g.title)} accessibilityRole="button" accessibilityLabel={`${g.title} menus`}
                    style={({ hovered }) => [s.grpHead, hovered && { backgroundColor: COLORS.bg }]}>
                    <Pressable onPress={() => toggleGroup(g)} hitSlop={8} accessibilityRole="checkbox" accessibilityState={{ checked: all }}>
                      <MCI name={all ? 'checkbox-marked' : n ? 'minus-box' : 'checkbox-blank-outline'} size={22} color={n ? COLORS.primary : COLORS.grey} />
                    </Pressable>
                    <Text style={s.grpTitle} numberOfLines={1}>{g.title}</Text>
                    <View style={[s.count, n > 0 && { backgroundColor: COLORS.primarySoft }]}><Text style={[s.countText, n > 0 && { color: COLORS.primary }]}>{n}/{mods.length}</Text></View>
                    <MCI name={open ? 'chevron-up' : 'chevron-down'} size={22} color={COLORS.grey} />
                  </Pressable>
                  {open && g.items.map((i) => {
                    const on = sel.includes(i.module);
                    return (
                      <Pressable key={i.module} onPress={() => toggle(i.module)} accessibilityRole="checkbox" accessibilityState={{ checked: on }}
                        style={({ hovered }) => [s.row, on && s.rowOn, hovered && !on && { backgroundColor: COLORS.bg }]}>
                        <MCI name={on ? 'checkbox-marked' : 'checkbox-blank-outline'} size={22} color={on ? COLORS.primary : COLORS.grey} />
                        <Text style={[s.rowText, on && { color: COLORS.text, fontWeight: '800' }]} numberOfLines={1}>{i.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              );
            })}

            <View style={s.summary}>
              <Text style={s.summaryTitle}>Selected menus ({sel.length})</Text>
              {sel.length === 0
                ? <Text style={s.hint}>Nothing selected yet</Text>
                : <View style={s.chips}>{sel.map((m) => <View key={m} style={s.chip}><Text style={s.chipText}>{LABEL[m] || m}</Text></View>)}</View>}
            </View>
            {!!errors.menus && <Text style={{ color: COLORS.danger, fontWeight: '700', marginTop: 6 }}>{errors.menus}</Text>}
          </View>
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

const s = StyleSheet.create({
  box: { borderWidth: 1.5, borderColor: COLORS.border, borderRadius: 14, padding: 12, marginTop: 4, marginBottom: 6 },
  head: { flexDirection: 'row', alignItems: 'center' },
  title: { marginLeft: 8, fontSize: 15, fontWeight: '900', color: COLORS.text },
  link: { color: COLORS.primary, fontWeight: '800', fontSize: 12.5 },
  hint: { fontSize: 12, fontWeight: '600', color: COLORS.grey, marginTop: 4 },
  grp: { marginTop: 8, borderWidth: 1, borderColor: COLORS.line, borderRadius: 12, overflow: 'hidden' },
  grpHead: { flexDirection: 'row', alignItems: 'center', minHeight: 46, paddingHorizontal: 10 },
  grpTitle: { flex: 1, marginLeft: 10, fontSize: 14, fontWeight: '900', color: COLORS.text },
  count: { backgroundColor: COLORS.bg, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2, marginRight: 6 },
  countText: { fontSize: 11.5, fontWeight: '900', color: COLORS.grey },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 38, paddingHorizontal: 8, borderRadius: 10 },
  rowOn: { backgroundColor: COLORS.primarySoft },
  rowText: { marginLeft: 10, flex: 1, fontSize: 14, fontWeight: '600', color: COLORS.textSoft },
  summary: { marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: COLORS.line },
  summaryTitle: { fontSize: 12.5, fontWeight: '900', color: COLORS.text },
  chips: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 6 },
  chip: { backgroundColor: COLORS.primarySoft, borderRadius: 10, paddingHorizontal: 9, paddingVertical: 3, marginRight: 6, marginBottom: 6 },
  chipText: { color: COLORS.primary, fontSize: 12, fontWeight: '800' },
});