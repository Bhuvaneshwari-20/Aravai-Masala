import React, { useState } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons as MCI } from '@expo/vector-icons';
import { MENU, GROUPS, ACTION_LABELS, actionsFor, groupsForRole } from '../menu';
import { COLORS } from '../theme';

// "Assign Sidebar Menus" + the permission switches of every ticked menu.
//   value    = { module: { create: true, start: false, ... } }   (a module that is in the object is ticked = shown in the sidebar = View)
//   onChange = (newValue) => ...
// Menus come from menu.js; the switches shown for a module come from MODULE_ACTIONS in menu.js (only the ones that make sense for it).

// 'users' (account management) is never given through this screen
const NOT_FOR_STAFF = ['users'];
export const GROUP_ITEMS = GROUPS.map((g) => ({
  title: g.title,
  items: g.modules.filter((m) => !NOT_FOR_STAFF.includes(m)).map((m) => MENU.find((x) => x.module === m)).filter(Boolean),
})).filter((g) => g.items.length);
export const UNIVERSE = GROUP_ITEMS.flatMap((g) => g.items.map((i) => i.module));
const LABEL = Object.fromEntries(MENU.map((m) => [m.module, m.label]));

// What a role gives by default (role_permissions rows, or the whole Admin level), shown as the starting point for a user of that role.
export function defaultsForRole(r) {
  const out = {};
  if (!r) return out;
  if (r.permissions === 'ALL') {
    groupsForRole(r.role_name).forEach((g) => g.modules.forEach((m) => {
      if (!UNIVERSE.includes(m)) return;
      out[m] = Object.fromEntries(actionsFor(m).map((a) => [a, true]));
    }));
    return out;
  }
  (Array.isArray(r.permissions) ? r.permissions : []).forEach((p) => {
    if (!p.can_view || !UNIVERSE.includes(p.module)) return;
    const on = { create: p.can_create, start: p.can_create, stop: p.can_create, edit: p.can_edit, review: p.can_edit, remark: p.can_edit, delete: p.can_delete, approve: p.can_approve, history: p.can_view };
    out[p.module] = Object.fromEntries(actionsFor(p.module).map((a) => [a, !!on[a]]));
  });
  return out;
}
// the server sends { module: { view, create, ... } } -> keep only the menus of the sidebar and the switches that apply
export function cleanFromServer(map) {
  const out = {};
  Object.keys(map || {}).forEach((m) => {
    if (!UNIVERSE.includes(m)) return;
    out[m] = Object.fromEntries(actionsFor(m).map((a) => [a, !!(map[m] && map[m][a])]));
  });
  return out;
}

const Check = ({ on, partial, size = 22 }) => (
  <MCI name={on ? 'checkbox-marked' : partial ? 'minus-box' : 'checkbox-blank-outline'} size={size} color={on || partial ? COLORS.primary : COLORS.grey} />
);

export default function PermissionEditor({ value, onChange, error, hint }) {
  const [openG, setOpenG] = useState({});
  const v = value || {};
  const selected = Object.keys(v).filter((m) => UNIVERSE.includes(m));

  const toggleModule = (m) => {
    if (v[m]) { const { [m]: _gone, ...rest } = v; onChange(rest); } else onChange({ ...v, [m]: {} });
  };
  const toggleGroup = (g) => {
    const mods = g.items.map((i) => i.module);
    if (mods.every((m) => v[m])) { const rest = { ...v }; mods.forEach((m) => delete rest[m]); onChange(rest); }
    else { const add = { ...v }; mods.forEach((m) => { if (!add[m]) add[m] = {}; }); onChange(add); }
  };
  const selectAll = () => { const all = { ...v }; UNIVERSE.forEach((m) => { if (!all[m]) all[m] = {}; }); onChange(all); };
  const clearAll = () => onChange({});
  const toggleAction = (m, a) => onChange({ ...v, [m]: { ...v[m], [a]: !(v[m] && v[m][a]) } });
  const setAllActions = (m, on) => onChange({ ...v, [m]: Object.fromEntries(actionsFor(m).map((a) => [a, on])) });

  return (
    <View style={s.box}>
      <View style={s.head}>
        <MCI name="menu" size={18} color={COLORS.primary} />
        <Text style={s.title}>Assign Sidebar Menus & Permissions</Text>
      </View>
      <View style={s.headLinks}>
        <Pressable onPress={selectAll} hitSlop={8}><Text style={s.link}>Select all menus</Text></Pressable>
        <Pressable onPress={clearAll} hitSlop={8} style={{ marginLeft: 16 }}><Text style={s.link}>Deselect all</Text></Pressable>
      </View>
      <Text style={s.hint}>{hint || 'Tick a menu to show it in this person\'s sidebar (that is the View permission), then switch on exactly what he may do in it.'}</Text>

      {GROUP_ITEMS.map((g) => {
        const mods = g.items.map((i) => i.module);
        const n = mods.filter((m) => v[m]).length;
        const open = !!openG[g.title];
        return (
          <View key={g.title} style={s.grp}>
            <Pressable onPress={() => setOpenG((o) => ({ ...o, [g.title]: !o[g.title] }))} accessibilityRole="button" accessibilityLabel={`${g.title} menus`}
              style={({ hovered }) => [s.grpHead, hovered && { backgroundColor: COLORS.bg }]}>
              <Pressable onPress={() => toggleGroup(g)} hitSlop={8} accessibilityRole="checkbox" accessibilityState={{ checked: n === mods.length }}>
                <Check on={n === mods.length} partial={n > 0} />
              </Pressable>
              <Text style={s.grpTitle} numberOfLines={1}>{g.title}</Text>
              <View style={[s.count, n > 0 && { backgroundColor: COLORS.primarySoft }]}><Text style={[s.countText, n > 0 && { color: COLORS.primary }]}>{n}/{mods.length}</Text></View>
              <MCI name={open ? 'chevron-up' : 'chevron-down'} size={22} color={COLORS.grey} />
            </Pressable>

            {open && g.items.map((i) => {
              const on = !!v[i.module];
              const acts = actionsFor(i.module);
              const nOn = on ? acts.filter((a) => v[i.module][a]).length : 0;
              return (
                <View key={i.module} style={[s.mod, on && s.modOn]}>
                  <Pressable onPress={() => toggleModule(i.module)} accessibilityRole="checkbox" accessibilityState={{ checked: on }} style={s.modRow}>
                    <Check on={on} />
                    <Text style={[s.modText, on && { color: COLORS.text, fontWeight: '800' }]} numberOfLines={1}>{i.label}</Text>
                    {on && <Text style={s.modCount}>{acts.length ? `${nOn}/${acts.length} actions` : 'View only'}</Text>}
                  </Pressable>
                  {on && acts.length > 0 && (
                    <View style={s.perms}>
                      <View style={s.permLinks}>
                        <Pressable onPress={() => setAllActions(i.module, true)} hitSlop={6}><Text style={s.miniLink}>All</Text></Pressable>
                        <Pressable onPress={() => setAllActions(i.module, false)} hitSlop={6} style={{ marginLeft: 12 }}><Text style={s.miniLink}>None</Text></Pressable>
                      </View>
                      <View style={s.chips}>
                        {acts.map((a) => {
                          const ao = !!v[i.module][a];
                          return (
                            <Pressable key={a} onPress={() => toggleAction(i.module, a)} accessibilityRole="checkbox" accessibilityState={{ checked: ao }}
                              style={({ hovered }) => [s.pchip, ao && s.pchipOn, !ao && hovered && { backgroundColor: COLORS.bg }]}>
                              <MCI name={ao ? 'check-circle' : 'circle-outline'} size={15} color={ao ? '#fff' : COLORS.grey} />
                              <Text style={[s.pchipText, ao && { color: '#fff' }]}>{ACTION_LABELS[a]}</Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        );
      })}

      <View style={s.summary}>
        <Text style={s.summaryTitle}>Selected menus ({selected.length})</Text>
        {selected.length === 0
          ? <Text style={s.hint}>Nothing selected yet</Text>
          : (
            <View style={s.sumChips}>
              {selected.map((m) => {
                const acts = actionsFor(m).filter((a) => v[m][a]);
                return (
                  <View key={m} style={s.sumChip}>
                    <Text style={s.sumChipText}>{LABEL[m] || m}</Text>
                    <Text style={s.sumChipSub}>{acts.length ? acts.map((a) => ACTION_LABELS[a]).join(' · ') : 'View'}</Text>
                  </View>
                );
              })}
            </View>
          )}
      </View>
      {!!error && <Text style={{ color: COLORS.danger, fontWeight: '700', marginTop: 6 }}>{error}</Text>}
    </View>
  );
}

const s = StyleSheet.create({
  box: { borderWidth: 1.5, borderColor: COLORS.border, borderRadius: 14, padding: 12, marginTop: 4, marginBottom: 6 },
  head: { flexDirection: 'row', alignItems: 'center' },
  title: { marginLeft: 8, fontSize: 15, fontWeight: '900', color: COLORS.text, flex: 1 },
  headLinks: { flexDirection: 'row', marginTop: 6 },
  link: { color: COLORS.primary, fontWeight: '800', fontSize: 12.5 },
  hint: { fontSize: 12, fontWeight: '600', color: COLORS.grey, marginTop: 4, lineHeight: 17 },
  grp: { marginTop: 8, borderWidth: 1, borderColor: COLORS.line, borderRadius: 12, overflow: 'hidden' },
  grpHead: { flexDirection: 'row', alignItems: 'center', minHeight: 46, paddingHorizontal: 10 },
  grpTitle: { flex: 1, marginLeft: 10, fontSize: 14, fontWeight: '900', color: COLORS.text },
  count: { backgroundColor: COLORS.bg, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2, marginRight: 6 },
  countText: { fontSize: 11.5, fontWeight: '900', color: COLORS.grey },
  mod: { borderTopWidth: 1, borderTopColor: COLORS.line },
  modOn: { backgroundColor: '#FFF9F8' },
  modRow: { flexDirection: 'row', alignItems: 'center', minHeight: 42, paddingHorizontal: 10 },
  modText: { marginLeft: 10, flex: 1, fontSize: 14, fontWeight: '600', color: COLORS.textSoft },
  modCount: { fontSize: 11.5, fontWeight: '800', color: COLORS.primary },
  perms: { paddingHorizontal: 12, paddingBottom: 10 },
  permLinks: { flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 4 },
  miniLink: { color: COLORS.primary, fontWeight: '800', fontSize: 11.5 },
  chips: { flexDirection: 'row', flexWrap: 'wrap' },
  pchip: { flexDirection: 'row', alignItems: 'center', borderRadius: 16, borderWidth: 1.5, borderColor: COLORS.border, backgroundColor: '#fff', paddingHorizontal: 10, paddingVertical: 5, marginRight: 6, marginBottom: 6 },
  pchipOn: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  pchipText: { marginLeft: 5, fontSize: 12.5, fontWeight: '700', color: COLORS.textSoft },
  summary: { marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: COLORS.line },
  summaryTitle: { fontSize: 12.5, fontWeight: '900', color: COLORS.text },
  sumChips: { marginTop: 6 },
  sumChip: { backgroundColor: COLORS.primarySoft, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5, marginBottom: 6 },
  sumChipText: { color: COLORS.primary, fontSize: 12.5, fontWeight: '900' },
  sumChipSub: { color: COLORS.textSoft, fontSize: 11.5, fontWeight: '600', marginTop: 1 },
});