import React, { useState } from 'react';
import { View, ScrollView, Pressable, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons as MCI } from '@expo/vector-icons';
import { useRoute } from '@react-navigation/native';
import Container from '../../components/Container';
import { NotificationBell } from '../../components/NotificationCenter';
import useLayout from '../../hooks/useLayout';
import SalesCustomersTab from './SalesCustomersTab';
import SalesInvoiceForm from './SalesInvoiceForm';
import { COLORS, SHADOW } from '../../theme';

// New Sales Entry = two tabs:  Customers (master list)  |  Sales Entry (Invoice).
// Both tabs stay mounted, so a half-typed invoice is not lost when you look at the Customers tab.
// Open straight on a tab with navigation.navigate('SalesEntry', { tab: 'invoice' }).
const TABS = [
  { key: 'customers', label: 'Customers', icon: 'account-group' },
  { key: 'invoice', label: 'Sales Entry (Invoice)', icon: 'file-document-outline' },
];

export default function SalesEntryScreen() {
  const { isPhone, pad } = useLayout();
  const route = useRoute();
  const [tab, setTab] = useState(route.params?.tab === 'invoice' ? 'invoice' : 'customers');
  const [custVersion, setCustVersion] = useState(0);   // bumps when a customer is added / edited, so the invoice tab reloads its list

  React.useEffect(() => { if (route.params?.tab) setTab(route.params.tab === 'invoice' ? 'invoice' : 'customers'); }, [route.params?.tab]);

  return (
    <View style={s.wrap}>
      <Container fill>
        <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: pad, paddingTop: 16, paddingBottom: 60 }}>
          <View style={s.head}>
            <View style={s.headIcon}><MCI name="cart-outline" size={isPhone ? 26 : 32} color={COLORS.primary} /></View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[s.h1, isPhone && { fontSize: 22 }]} numberOfLines={1}>New Sales Entry</Text>
              <Text style={s.h1sub} numberOfLines={2}>Manage customers and create new sales invoice.</Text>
            </View>
            <NotificationBell />
          </View>

          <View style={s.tabs}>
            {TABS.map((t) => {
              const on = tab === t.key;
              return (
                <Pressable key={t.key} onPress={() => setTab(t.key)} accessibilityRole="tab" accessibilityState={{ selected: on }}
                  style={({ hovered }) => [s.tab, on && s.tabOn, on && SHADOW.sm, hovered && !on && { borderColor: COLORS.primary }]}>
                  <MCI name={t.icon} size={20} color={on ? '#fff' : COLORS.primary} />
                  <Text style={[s.tabText, on && { color: '#fff' }]} numberOfLines={1}>{t.label}</Text>
                </Pressable>
              );
            })}
          </View>

          <View style={{ display: tab === 'customers' ? 'flex' : 'none' }}>
            <SalesCustomersTab active={tab === 'customers'} onChanged={() => setCustVersion((v) => v + 1)} />
          </View>
          <View style={{ display: tab === 'invoice' ? 'flex' : 'none' }}>
            <SalesInvoiceForm active={tab === 'invoice'} refreshKey={custVersion} />
          </View>
        </ScrollView>
      </Container>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: COLORS.bg },
  head: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  headIcon: { width: 52, height: 52, borderRadius: 14, backgroundColor: COLORS.primarySoft, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  h1: { fontSize: 28, fontWeight: '900', color: COLORS.text },
  h1sub: { fontSize: 13.5, color: COLORS.textSoft, fontWeight: '600', marginTop: 2 },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 14 },
  tab: { flexDirection: 'row', alignItems: 'center', height: 48, borderRadius: 24, borderWidth: 1.5, borderColor: COLORS.border, backgroundColor: '#fff', paddingHorizontal: 20, marginRight: 12, marginBottom: 6 },
  tabOn: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  tabText: { marginLeft: 8, fontSize: 14.5, fontWeight: '800', color: COLORS.primary },
});
