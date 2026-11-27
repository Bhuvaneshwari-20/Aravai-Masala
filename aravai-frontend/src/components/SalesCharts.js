import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { Line, Rect, Path, Circle, Text as SvgText } from 'react-native-svg';
import { Text } from 'react-native-paper';
import { COLORS } from '../theme';
import { compactMoney } from '../screens/sales/salesUtils';

// Light-weight bar / line chart drawn with react-native-svg (same library the stock overview uses).
//   data   = [{ label: '12 Nov', values: [gross, net, profit] }]
//   series = [{ name: 'Gross', color: '#1F5C52' }, ...]   (one entry per value)
//   type   = 'bar' | 'line'
const niceStep = (range, ticks = 4) => {
  const raw = range / ticks;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag;
};

const inr = (v) => `₹ ${Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

// highlight = 'max' | 'last' (bar charts with one series): that bar is solid, the others are soft, and a tooltip shows its value.
export default function TrendChart({ data = [], series = [], type = 'bar', height = 220, valueFmt = compactMoney, highlight = null, tipFmt = inr, hideLegend = false }) {
  const [w, setW] = useState(0);
  const n = data.length;
  const all = data.flatMap((d) => d.values.map((v) => Number(v) || 0));
  const hasData = n > 0 && all.some((v) => v !== 0);

  const L = 56; const R = 10; const T = highlight ? 36 : 10; const B = 28;
  const plotW = Math.max(w - L - R, 0);
  const plotH = height - T - B;
  let lo = Math.min(0, ...all);
  let hi = Math.max(0, ...all);
  if (hi === lo) hi = lo + 1;
  const step = niceStep(hi - lo);
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  const y = (v) => T + plotH - ((v - lo) / (hi - lo)) * plotH;
  const tickCount = Math.round((hi - lo) / step);
  const ticks = Array.from({ length: tickCount + 1 }, (_, i) => lo + i * step);
  const groupW = n ? plotW / n : 0;
  const cx = (i) => L + groupW * (i + 0.5);
  const firstVals = data.map((d) => Number(d.values[0]) || 0);
  const hiIdx = !highlight ? -1 : highlight === 'last' ? n - 1 : firstVals.indexOf(Math.max(...firstVals, 0));
  const every = Math.ceil(n / Math.max(1, Math.floor(plotW / 46)));

  return (
    <View>
      {!hideLegend && <View style={s.legend}>
        {series.map((sr) => (
          <View key={sr.name} style={s.legendItem}>
            <View style={[s.dot, { backgroundColor: sr.color }]} />
            <Text style={s.legendText}>{sr.name}</Text>
          </View>
        ))}
      </View>}
      <View onLayout={(e) => setW(e.nativeEvent.layout.width)} style={{ height }}>
        {!hasData ? (
          <View style={s.empty}><Text style={s.emptyText}>No sales data for this period</Text></View>
        ) : w > 0 && (
          <Svg width={w} height={height}>
            {ticks.map((t) => (
              <React.Fragment key={t}>
                <Line x1={L} x2={w - R} y1={y(t)} y2={y(t)} stroke={t === 0 ? '#CFC4BA' : COLORS.line} strokeWidth={t === 0 ? 1.2 : 1} />
                <SvgText x={L - 8} y={y(t) + 4} fontSize="10.5" fill={COLORS.grey} textAnchor="end">{valueFmt(t)}</SvgText>
              </React.Fragment>
            ))}

            {type === 'bar' && data.map((d, i) => {
              const bw = Math.max(2, Math.min(highlight ? 34 : 24, (groupW * 0.72) / series.length));
              const x0 = cx(i) - (bw * series.length) / 2;
              return d.values.map((v, si) => {
                const val = Number(v) || 0;
                const top = Math.min(y(val), y(0));
                const h = val === 0 ? 0 : Math.max(Math.abs(y(val) - y(0)), 1.5);
                const fill = highlight && i !== hiIdx ? `${series[si].color}59` : series[si].color;
                return <Rect key={`${i}-${si}`} x={x0 + si * bw} y={top} width={Math.max(bw - 1.5, 1)} height={h} rx={3} fill={fill} />;
              });
            })}

            {type === 'bar' && highlight && hiIdx >= 0 && (() => {
              const txt = tipFmt(Number(data[hiIdx].values[0]) || 0);
              const tw = txt.length * 7 + 20;
              const tx = Math.min(Math.max(cx(hiIdx) - tw / 2, L), w - R - tw);
              const ty = Math.max(y(Number(data[hiIdx].values[0]) || 0) - 32, 2);
              return (
                <React.Fragment>
                  <Rect x={tx} y={ty} width={tw} height={24} rx={7} fill={COLORS.primaryDark} fillOpacity={0.1} />
                  <Rect x={tx} y={ty} width={tw} height={24} rx={7} fill="#fff" stroke={COLORS.border} />
                  <SvgText x={tx + tw / 2} y={ty + 16} fontSize="12" fontWeight="800" fill={COLORS.text} textAnchor="middle">{txt}</SvgText>
                </React.Fragment>
              );
            })()}

            {type === 'line' && series.map((sr, si) => {
              const path = data.map((d, i) => `${i === 0 ? 'M' : 'L'}${cx(i).toFixed(1)} ${y(Number(d.values[si]) || 0).toFixed(1)}`).join(' ');
              return (
                <React.Fragment key={sr.name}>
                  <Path d={path} stroke={sr.color} strokeWidth={2.2} fill="none" strokeLinejoin="round" strokeLinecap="round" />
                  {n <= 31 && data.map((d, i) => <Circle key={i} cx={cx(i)} cy={y(Number(d.values[si]) || 0)} r={2.6} fill={sr.color} />)}
                </React.Fragment>
              );
            })}

            {data.map((d, i) => (i % every === 0 ? (
              <SvgText key={`l${i}`} x={cx(i)} y={height - 8} fontSize="10.5" fill={COLORS.grey} textAnchor="middle">{d.label}</SvgText>
            ) : null))}
          </Svg>
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  legend: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 6 },
  legendItem: { flexDirection: 'row', alignItems: 'center', marginRight: 16 },
  dot: { width: 9, height: 9, borderRadius: 5, marginRight: 6 },
  legendText: { fontSize: 12, fontWeight: '700', color: COLORS.textSoft },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: COLORS.grey, fontWeight: '600' },
});