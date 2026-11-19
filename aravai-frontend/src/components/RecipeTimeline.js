import React, { useEffect, useRef, useState } from 'react';
import { View, Pressable, Animated, Easing, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons as MCI } from '@expo/vector-icons';
import FadeIn from './FadeIn';
import Badge from './Badge';
import { COLORS, fmt } from '../theme';

// ---- Recipe history as a vertical timeline -------------------------------------------------------
// Every recipe change is saved by the backend as a NEW version row (recipe_master.version_no); old versions are never edited.
// What changed in a version is worked out by comparing it with the version before it.
export const who = (v) => v.updated_by_name || v.updated_by_username || v.created_by_name || v.created_by_username || (v.created_by ? `User #${v.created_by}` : '-');

// NOTE: the backend sends MySQL DATETIME strings (dateStrings: true) without a zone, so they are read as the device's local time.
// That is right as long as the DB server and the users are in the same zone (IST). If the DB runs in UTC, append 'Z' below.
const parse = (v) => {
  const raw = v.updated_at || v.created_at;
  if (!raw) return null;
  const d = new Date(String(raw).replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? null : d;
};
export const dateOf = (v) => { const d = parse(v); return d ? d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '-'; };
export const timeOf = (v) => { const d = parse(v); return d ? d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '-'; };

export const diffVersions = (prev, cur) => {
  const before = new Map((prev?.ingredients || []).map((i) => [i.material_id, i]));
  const after = new Map((cur.ingredients || []).map((i) => [i.material_id, i]));
  const added = []; const removed = []; const qty = [];
  after.forEach((i, id) => {
    const o = before.get(id);
    if (!o) added.push(i);
    else if (Number(o.quantity_kg || 0) !== Number(i.quantity_kg || 0)) qty.push({ name: i.material_name, from: Number(o.quantity_kg || 0), to: Number(i.quantity_kg || 0) });
  });
  before.forEach((i, id) => { if (!after.has(id)) removed.push(i); });
  return { added, removed, qty };
};

function Pills({ items, color, bg, sign }) {
  return (
    <View style={s.pills}>
      {items.map((i) => (
        <View key={i.material_id} style={[s.pill, { backgroundColor: bg }]}>
          <Text style={{ fontSize: 12.5, fontWeight: '800', color }}>{sign ? `${sign} ${i.material_name}` : i.material_name}</Text>
        </View>
      ))}
    </View>
  );
}

// dot on the line; the latest version gets a soft pulsing ring
function Dot({ latest, pulse = true }) {
  const p = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!latest || !pulse) return undefined;
    const loop = Animated.loop(Animated.timing(p, { toValue: 1, duration: 1800, easing: Easing.out(Easing.quad), useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [latest, pulse]); // eslint-disable-line
  return (
    <View style={s.dotWrap}>
      {latest && pulse && <Animated.View style={[s.ring, { opacity: p.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0] }), transform: [{ scale: p.interpolate({ inputRange: [0, 1], outputRange: [1, 2.4] }) }] }]} />}
      <View style={[s.dot, latest ? s.dotLatest : s.dotOld]}>
        {latest && <MCI name="check" size={11} color="#fff" />}
      </View>
    </View>
  );
}

function Item({ v, change, latest, first, last, index, pulse, viewable }) {
  const [showAll, setShowAll] = useState(false); // read-only look at the full material list of this version
  const none = !first && !change.added.length && !change.removed.length && !change.qty.length;
  const count = v.ingredients.length;
  return (
    <FadeIn delay={Math.min(index, 8) * 70} from={12} style={s.row}>
      <View style={s.rail}>
        <Dot latest={latest} pulse={pulse} />
        {!last && <View style={s.line} />}
      </View>
      <View style={[s.card, latest && s.cardLatest, !last && { marginBottom: 14 }]}>
        <View style={s.head}>
          <Text style={s.ver}>{`Version ${v.version_no}`}</Text>
          {latest && <Badge tone="ok" text="Latest" style={{ marginLeft: 8 }} />}
          <Text style={s.count}>{`${count} material${count === 1 ? '' : 's'}`}</Text>
        </View>
        <View style={s.meta}>
          <View style={s.metaItem}><MCI name="calendar-outline" size={14} color={COLORS.grey} /><Text style={s.metaText}>{dateOf(v)}</Text></View>
          <View style={s.metaItem}><MCI name="clock-outline" size={14} color={COLORS.grey} /><Text style={s.metaText}>{timeOf(v)}</Text></View>
          <View style={s.metaItem}>
            <View style={s.uAvatar}><Text style={s.uAvatarText}>{who(v) === '-' ? '?' : String(who(v)).trim().charAt(0).toUpperCase()}</Text></View>
            <Text style={s.metaText}>{who(v)}</Text>
          </View>
        </View>
        <View style={{ marginTop: 8 }}>
          {first && <><Text style={s.chgHead}>INITIAL MATERIALS</Text><Pills items={v.ingredients} color={COLORS.textSoft} bg={COLORS.greyBg} /></>}
          {none && <Text style={s.none}>No material or quantity change.</Text>}
          {change.added.length > 0 && <View style={s.chg}><Text style={[s.chgHead, { color: COLORS.ok }]}>ADDED</Text><Pills items={change.added} color={COLORS.ok} bg={COLORS.okBg} sign="+" /></View>}
          {change.removed.length > 0 && <View style={s.chg}><Text style={[s.chgHead, { color: COLORS.danger }]}>REMOVED</Text><Pills items={change.removed} color={COLORS.danger} bg={COLORS.dangerBg} sign="−" /></View>}
          {viewable && !first && (
            <Pressable onPress={() => setShowAll((x) => !x)} style={s.viewBtn} accessibilityRole="button">
              <MCI name={showAll ? 'chevron-up' : 'eye-outline'} size={15} color={COLORS.primary} />
              <Text style={s.viewText}>{showAll ? 'Hide materials' : `View all ${count} materials`}</Text>
            </Pressable>
          )}
          {viewable && !first && showAll && <View style={s.chg}><Text style={s.chgHead}>MATERIALS IN THIS VERSION</Text><Pills items={v.ingredients} color={COLORS.textSoft} bg={COLORS.greyBg} /></View>}
          {change.qty.length > 0 && (
            <View style={s.chg}>
              <Text style={[s.chgHead, { color: COLORS.warn }]}>QUANTITY CHANGED</Text>
              {change.qty.map((q) => <Text key={q.name} style={s.qty}>{`${q.name}: ${fmt(q.from)} kg → ${fmt(q.to)} kg`}</Text>)}
            </View>
          )}
        </View>
      </View>
    </FadeIn>
  );
}

// versions: oldest -> newest, each with `ingredients`. Shown newest first.
// limit = show only the newest N (changes are still compared with the version before, so the preview stays correct).
export default function RecipeTimeline({ versions, limit }) {
  if (!versions || !versions.length) return <Text style={s.none}>No history yet.</Text>;
  const rev = [...versions].reverse();
  const shown = limit ? rev.slice(0, limit) : rev;
  return (
    <View>
      {shown.map((v, k) => {
        const i = versions.length - 1 - k;
        return <Item key={v.id} v={v} index={k} pulse={!limit} viewable={!limit} latest={i === versions.length - 1} first={i === 0} last={k === shown.length - 1} change={diffVersions(versions[i - 1], v)} />;
      })}
      {!limit && <Text style={s.note}>Old versions are never changed. A batch always keeps the recipe version it was made with.</Text>}
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row' },
  rail: { width: 30, alignItems: 'center' },
  dotWrap: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  ring: { position: 'absolute', width: 22, height: 22, borderRadius: 11, backgroundColor: COLORS.ok },
  dot: { alignItems: 'center', justifyContent: 'center' },
  dotLatest: { width: 20, height: 20, borderRadius: 10, backgroundColor: COLORS.ok },
  dotOld: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#fff', borderWidth: 2.5, borderColor: '#CFC5BB' },
  line: { flex: 1, width: 2, backgroundColor: COLORS.border, marginTop: 4, marginBottom: -12, borderRadius: 1 },
  card: { flex: 1, borderWidth: 1.5, borderColor: COLORS.border, borderRadius: 14, padding: 12, backgroundColor: '#fff', marginLeft: 6 },
  cardLatest: { borderColor: COLORS.ok, backgroundColor: `${COLORS.okBg}88` },
  uAvatar: { width: 18, height: 18, borderRadius: 9, backgroundColor: COLORS.primarySoft, alignItems: 'center', justifyContent: 'center' },
  uAvatarText: { fontSize: 10, fontWeight: '900', color: COLORS.primary },
  head: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  ver: { fontSize: 15.5, fontWeight: '900', color: COLORS.text },
  count: { marginLeft: 'auto', fontSize: 12, fontWeight: '700', color: COLORS.grey },
  meta: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 5 },
  metaItem: { flexDirection: 'row', alignItems: 'center', marginRight: 14, marginTop: 2 },
  metaText: { marginLeft: 4, fontSize: 12.5, fontWeight: '600', color: COLORS.grey },
  chg: { marginTop: 6 },
  chgHead: { fontSize: 10.5, fontWeight: '900', letterSpacing: 1, marginBottom: 2, color: COLORS.grey },
  pills: { flexDirection: 'row', flexWrap: 'wrap' },
  pill: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, marginRight: 6, marginTop: 4 },
  qty: { fontSize: 13, fontWeight: '700', color: COLORS.textSoft, marginTop: 2 },
  viewBtn: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  viewText: { marginLeft: 5, fontSize: 12.5, fontWeight: '800', color: COLORS.primary },
  none: { fontSize: 13, fontWeight: '600', color: COLORS.textSoft },
  note: { fontSize: 12, fontWeight: '600', color: COLORS.grey, marginTop: 10, marginLeft: 36 },
});