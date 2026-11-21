import React from 'react';
import { View, Pressable, FlatList, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons as MCI } from '@expo/vector-icons';
import FadeIn from './FadeIn';
import PressableScale from './PressableScale';
import useLayout from '../hooks/useLayout';
import { COLORS, SHADOW, padGrid } from '../theme';

// ---------------------------------------------------------------------------------------------
// The card used on the Grams screen, made reusable:
//   [icon tile]                     [right slot: lock / delete / edit / chevron ...]
//   BIG VALUE  unit
//   caption
//   (extra lines / stats)
//   ----------------------------------------------------------------------------------------
//   [badge] [badge]
// ---------------------------------------------------------------------------------------------

// maps one of the COLORS.* values to a <Badge tone>
export const toneOf = (c) => (c === COLORS.ok ? 'ok' : c === COLORS.warn ? 'warn' : c === COLORS.danger ? 'danger'
  : c === COLORS.green ? 'green' : c === COLORS.primary ? 'primary' : 'grey');

export function RoundBtn({ icon, color = COLORS.primary, bg = COLORS.primarySoft, hoverBg, onPress, label }) {
  return (
    <Pressable onPress={onPress} accessibilityLabel={label} hitSlop={6}
      style={({ hovered }) => [s.round, { backgroundColor: bg }, hovered && hoverBg && { backgroundColor: hoverBg }]}>
      <MCI name={icon} size={19} color={color} />
    </Pressable>
  );
}

export const LockDot = () => (
  <View style={s.lock}><MCI name="lock-outline" size={16} color="#A99D94" /></View>
);

export const ChevronDot = () => (
  <View style={s.lock}><MCI name="chevron-right" size={18} color="#A99D94" /></View>
);

// small "icon + text" line
export function InfoLine({ icon, text, color, lines = 1 }) {
  if (text === undefined || text === null || text === '') return null;
  return (
    <View style={s.line}>
      {!!icon && <MCI name={icon} size={14} color={color || COLORS.grey} style={s.lineIcon} />}
      <Text style={[s.lineText, color && { color }]} numberOfLines={lines}>{text}</Text>
    </View>
  );
}

// tinted box with label/value cells, `per` cells per row
export function InfoStats({ items, per = 2 }) {
  const list = items.filter(Boolean);
  const rows = [];
  for (let i = 0; i < list.length; i += per) rows.push(list.slice(i, i + per));
  return (
    <View style={s.stats}>
      {rows.map((r, ri) => (
        <View key={ri} style={[s.statsRow, ri > 0 && { marginTop: 10 }]}>
          {r.map((c, ci) => (
            <View key={ci} style={s.statCell}>
              <Text style={s.statLabel}>{c.label}</Text>
              <Text style={[s.statValue, c.color && { color: c.color }]}>{c.value}</Text>
            </View>
          ))}
          {r.length < per && Array.from({ length: per - r.length }, (_, k) => <View key={`e${k}`} style={s.statCell} />)}
        </View>
      ))}
    </View>
  );
}

export default function InfoCard({
  icon, letter, color = COLORS.primary, right, value, unit, size = 'lg', caption, captionBold, sub,
  children, footer, bottom, onPress, dim, index = 0,
}) {
  const card = (
    <View style={[s.card, SHADOW.sm, dim && { opacity: 0.6 }]}>
      <View style={[s.glow, { backgroundColor: `${color}12` }]} />
      <View style={s.top}>
        <View style={[s.tile, { backgroundColor: `${color}1A` }]}>
          {letter ? <Text style={[s.letter, { color }]}>{letter}</Text> : <MCI name={icon || 'circle-outline'} size={22} color={color} />}
        </View>
        {!!right && <View style={s.right}>{right}</View>}
      </View>

      {value !== undefined && value !== null && value !== '' && (
        <View style={s.valueRow}>
          <Text style={[s.num, size === 'md' && s.numMd]} numberOfLines={size === 'md' ? 2 : 1}>{value}</Text>
          {!!unit && <Text style={s.unit}>{unit}</Text>}
        </View>
      )}
      {!!caption && <Text style={[s.caption, captionBold && s.captionBold]} numberOfLines={2}>{caption}</Text>}
      {!!sub && <Text style={s.caption} numberOfLines={2}>{sub}</Text>}

      {!!children && <View style={s.extra}>{children}</View>}

      {!!footer && (
        <>
          <View style={s.divider} />
          <View style={s.footer}>
            {React.Children.toArray(footer).map((c, i) => <View key={i} style={s.foot}>{c}</View>)}
          </View>
        </>
      )}
      {!!bottom && <View style={s.bottom}>{bottom}</View>}
    </View>
  );
  return (
    <FadeIn delay={Math.min(index, 10) * 40} from={14} style={{ flex: 1 }}>
      {onPress
        ? <PressableScale to={0.98} onPress={onPress} containerStyle={{ flex: 1 }} style={{ flex: 1 }}>{card}</PressableScale>
        : card}
    </FadeIn>
  );
}

// number of cards per row (same maths the Grams screen uses)
export function useCardCols({ min = 200, phoneMin = 150, max = 6 } = {}) {
  const { contentWidth, pad, isPhone } = useLayout();
  const gap = 12;
  const w = contentWidth - pad * 2;
  const cols = Math.max(1, Math.min(max, Math.floor((w + gap) / ((isPhone ? phoneMin : min) + gap))));
  return { cols, gap, pad };
}

// Grid of cards. `renderItem(item, index)` returns an <InfoCard/>. Other props go to the FlatList
// (refreshControl, onEndReached, ListEmptyComponent, ListFooterComponent, ListHeaderComponent ...).
export function CardList({ data, cols, gap, pad, renderItem, keyExtractor, ...rest }) {
  return (
    <FlatList
      key={`cards-${cols}`}
      numColumns={cols}
      data={padGrid(data, cols)}
      keyExtractor={(i, idx) => (i.pad ? `pad-${idx}` : keyExtractor(i))}
      contentContainerStyle={{ paddingHorizontal: pad - gap / 2, paddingTop: 4, paddingBottom: 40 }}
      showsVerticalScrollIndicator={false}
      renderItem={({ item, index }) => (
        <View style={{ flex: 1, padding: gap / 2 }}>{item.pad ? null : renderItem(item, index)}</View>
      )}
      {...rest}
    />
  );
}

const s = StyleSheet.create({
  card: { flex: 1, backgroundColor: '#fff', borderRadius: 22, padding: 16, borderWidth: 1, borderColor: COLORS.border, overflow: 'hidden' },
  glow: { position: 'absolute', width: 120, height: 120, borderRadius: 60, right: -40, top: -44 },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  tile: { width: 46, height: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  letter: { fontSize: 21, fontWeight: '900' },
  right: { flexDirection: 'row', alignItems: 'center' },
  round: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginLeft: 6 },
  lock: { width: 32, height: 32, borderRadius: 16, backgroundColor: COLORS.greyBg, alignItems: 'center', justifyContent: 'center' },
  valueRow: { flexDirection: 'row', alignItems: 'baseline', marginTop: 16 },
  num: { fontSize: 38, fontWeight: '900', color: COLORS.text, letterSpacing: -1, flexShrink: 1 },
  numMd: { fontSize: 21, lineHeight: 26, letterSpacing: -0.3 },
  unit: { fontSize: 15, fontWeight: '800', color: COLORS.grey, marginLeft: 6 },
  caption: { fontSize: 12, fontWeight: '700', color: COLORS.grey, marginTop: 2 },
  captionBold: { fontSize: 14, fontWeight: '800', color: COLORS.text },
  extra: { marginTop: 10 },
  bottom: { marginTop: 12 },
  divider: { height: 1, backgroundColor: COLORS.line, marginVertical: 12 },
  footer: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', marginBottom: -4 },
  foot: { marginRight: 6, marginBottom: 4, maxWidth: '100%' },

  line: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  lineIcon: { marginRight: 6 },
  lineText: { flex: 1, fontSize: 12.5, fontWeight: '600', color: COLORS.textSoft },

  stats: { backgroundColor: COLORS.bg, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12, marginTop: 6 },
  statsRow: { flexDirection: 'row' },
  statCell: { flex: 1, paddingRight: 6 },
  statLabel: { fontSize: 10, fontWeight: '800', color: COLORS.grey, letterSpacing: 0.5 },
  statValue: { fontSize: 14.5, fontWeight: '900', color: COLORS.text, marginTop: 2 },
});
