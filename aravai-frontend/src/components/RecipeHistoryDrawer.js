import React, { useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, ActivityIndicator } from 'react-native-paper';
import api, { errMsg } from '../api';
import RightDrawer from './RightDrawer';
import RecipeTimeline from './RecipeTimeline';
import Badge from './Badge';
import { COLORS } from '../theme';

// Recipe history of one product: opens from the right, timeline inside.
export default function RecipeHistoryDrawer({ product, visible, onClose, rev = 0 }) {
  const [shown, setShown] = useState(product); // keeps the name on screen while the drawer slides out
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => { if (product) setShown(product); }, [product]);

  useEffect(() => {
    if (!visible || !product) return undefined;
    let live = true;
    setData(null); setErr('');
    (async () => {
      try { const d = (await api.get(`/recipes/product/${product.id}/history`)).data.data; if (live) setData(d); }
      catch (e) { if (live) setErr(errMsg(e)); }
    })();
    return () => { live = false; };
  }, [visible, product ? product.id : 0, rev]); // eslint-disable-line

  const n = data ? data.versions.length : 0;
  return (
    <RightDrawer visible={visible} onClose={onClose} icon="history" title="Recipe history" subtitle={shown ? shown.product_name : ''}>
      {!!err && <Text style={{ color: COLORS.danger, fontWeight: '700' }}>{err}</Text>}
      {!data && !err && <View style={{ padding: 40 }}><ActivityIndicator color={COLORS.primary} /></View>}
      {!!data && (
        <>
          <View style={s.sum}>
            <Badge tone="ok" text={`Current: v${data.latest_version_no}`} />
            <Text style={s.sumText}>{`${n} version${n === 1 ? '' : 's'} so far`}</Text>
          </View>
          <RecipeTimeline versions={data.versions} />
        </>
      )}
    </RightDrawer>
  );
}

const s = StyleSheet.create({
  sum: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  sumText: { marginLeft: 10, fontSize: 13, fontWeight: '700', color: COLORS.grey },
});