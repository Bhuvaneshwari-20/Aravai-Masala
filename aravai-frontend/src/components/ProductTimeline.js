import React, { useEffect, useMemo, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, ActivityIndicator } from 'react-native-paper';
import { MaterialCommunityIcons as MCI } from '@expo/vector-icons';
import api from '../api';
import FadeIn from './FadeIn';
import Badge from './Badge';
import { dateOf, timeOf, who } from './RecipeTimeline';
import { COLORS, money } from '../theme';

// Product timeline: product created, pack size / MRP added, recipe versions - newest first.
const niceDate = (d) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || ''));
  if (!m) return String(d || '');
  return `${m[3]} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m[2]) - 1]} ${m[1]}`;
};
const ts = (raw) => { const d = new Date(String(raw || '').replace(' ', 'T')); return Number.isNaN(d.getTime()) ? 0 : d.getTime(); };

const KIND = {
  product: { icon: 'tag-outline', color: COLORS.primary, bg: COLORS.primarySoft, label: 'Product' },
  mrp: { icon: 'currency-inr', color: COLORS.warn, bg: COLORS.greyBg, label: 'Pack size & MRP' },
  recipe: { icon: 'book-open-variant', color: COLORS.ok, bg: COLORS.okBg, label: 'Recipe' },
};

function Item({ e, index, last, latest }) {
  const k = KIND[e.kind];
  return (
    <FadeIn delay={Math.min(index, 8) * 60} from={12} style={s.row}>
      <View style={s.rail}>
        <View style={[s.dot, { backgroundColor: k.bg, borderColor: k.color }]}><MCI name={k.icon} size={12} color={k.color} /></View>
        {!last && <View style={s.line} />}
      </View>
      <View style={[s.card, latest && s.cardLatest, !last && { marginBottom: 14 }]}>
        <View style={s.head}>
          <Text style={s.title}>{e.title}</Text>
          {latest && <Badge tone="ok" text="Latest" dot={false} style={{ marginLeft: 8 }} />}
          <Text style={[s.kind, { color: k.color }]}>{k.label}</Text>
        </View>
        {!!e.sub && <Text style={s.sub}>{e.sub}</Text>}
        <View style={s.meta}>
          <View style={s.metaItem}><MCI name="calendar-outline" size={14} color={COLORS.grey} /><Text style={s.metaText}>{e.date}</Text></View>
          {!!e.time && <View style={s.metaItem}><MCI name="clock-outline" size={14} color={COLORS.grey} /><Text style={s.metaText}>{e.time}</Text></View>}
          {!!e.by && e.by !== '-' && <View style={s.metaItem}><MCI name="account-outline" size={14} color={COLORS.grey} /><Text style={s.metaText}>{e.by}</Text></View>}
        </View>
      </View>
    </FadeIn>
  );
}

export default function ProductTimeline({ product, canRecipeView }) {
  const [versions, setVersions] = useState([]);
  const [loading, setLoading] = useState(false);
  const pid = product ? product.id : 0;
  const recipeKey = product && product.current_recipe ? product.current_recipe.version_no : 0;

  useEffect(() => {
    if (!pid || !canRecipeView) { setVersions([]); return undefined; }
    let live = true;
    setLoading(true);
    (async () => {
      try { const d = (await api.get(`/recipes/product/${pid}/history`)).data.data; if (live) setVersions(d.versions || []); }
      catch (e) { if (live) setVersions([]); }
      if (live) setLoading(false);
    })();
    return () => { live = false; };
  }, [pid, recipeKey, canRecipeView]);

  const events = useMemo(() => {
    if (!product) return [];
    const out = [];
    if (product.created_at) {
      out.push({ key: 'p', kind: 'product', title: 'Product added', sub: `${product.product_name} (${product.product_code})`, date: dateOf({ created_at: product.created_at }), time: timeOf({ created_at: product.created_at }), by: '', at: ts(product.created_at) });
    }
    (product.packs || []).forEach((p) => (p.mrp_history || []).forEach((h, i) => {
      out.push({ key: `m${h.id}`, kind: 'mrp', title: i === 0 ? `${p.packing_size_label} pack added` : `${p.packing_size_label} MRP changed`,
        sub: `MRP ${money(h.mrp)} • from ${niceDate(h.effective_from)}${h.effective_to ? ` to ${niceDate(h.effective_to)}` : ''}${h.status === 'UPCOMING' ? ' • upcoming' : ''}`,
        date: niceDate(h.effective_from), time: '', by: '', at: ts(`${h.effective_from}T00:00:00`) });
    }));
    versions.forEach((v, i) => {
      out.push({ key: `r${v.id}`, kind: 'recipe', title: i === 0 ? 'Recipe added' : `Recipe updated (v${v.version_no})`,
        sub: `Version ${v.version_no} • ${(v.ingredients || []).length} materials`, date: dateOf(v), time: timeOf(v), by: who(v), at: ts(v.updated_at || v.created_at) });
    });
    return out.sort((a, b) => b.at - a.at);
  }, [product, versions]);

  if (loading && !events.length) return <View style={{ padding: 30 }}><ActivityIndicator color={COLORS.primary} /></View>;
  if (!events.length) return <Text style={s.none}>No history yet.</Text>;
  return (
    <View>
      {events.map((e, i) => <Item key={e.key} e={e} index={i} latest={i === 0} last={i === events.length - 1} />)}
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row' },
  rail: { width: 30, alignItems: 'center' },
  dot: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginTop: 10 },
  line: { flex: 1, width: 2, backgroundColor: COLORS.border, marginTop: 4, marginBottom: -12, borderRadius: 1 },
  card: { flex: 1, borderWidth: 1.5, borderColor: COLORS.border, borderRadius: 14, padding: 12, backgroundColor: '#fff', marginLeft: 6 },
  cardLatest: { borderColor: COLORS.ok, backgroundColor: `${COLORS.okBg}88` },
  head: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  title: { fontSize: 15, fontWeight: '900', color: COLORS.text },
  kind: { marginLeft: 'auto', fontSize: 12, fontWeight: '800' },
  sub: { marginTop: 3, fontSize: 13, fontWeight: '600', color: COLORS.textSoft },
  meta: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 5 },
  metaItem: { flexDirection: 'row', alignItems: 'center', marginRight: 14, marginTop: 2 },
  metaText: { marginLeft: 4, fontSize: 12.5, fontWeight: '600', color: COLORS.grey },
  none: { fontSize: 13, fontWeight: '600', color: COLORS.textSoft },
});
