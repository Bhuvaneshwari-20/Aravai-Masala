import React, { useState } from 'react';
import { ActivityIndicator, View, useWindowDimensions } from 'react-native';
import { PaperProvider } from 'react-native-paper';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { AuthProvider, useAuth } from './src/AuthContext';
import { COLORS, paperTheme } from './src/theme';
import LoginScreen from './src/screens/LoginScreen';
import HomeScreen from './src/screens/HomeScreen';
import Sidebar from './src/components/Sidebar';
import MobileTabBar from './src/components/MobileTabBar';
import { UiProvider } from './src/ui';
import MaterialListScreen from './src/screens/material/MaterialListScreen';
import MaterialDetailScreen from './src/screens/material/MaterialDetailScreen';
import VendorListScreen from './src/screens/vendor/VendorListScreen';
import VendorDetailScreen from './src/screens/vendor/VendorDetailScreen';
import AccountListScreen from './src/screens/users/AccountListScreen';
import StockListScreen from './src/screens/stock/StockListScreen';
import StockCardScreen from './src/screens/stock/StockCardScreen';
import ProductListScreen from './src/screens/product/ProductListScreen';
import GramListScreen from './src/screens/gram/GramListScreen';
import RecipeListScreen from './src/screens/recipe/RecipeListScreen';
import BatchListScreen from './src/screens/batch/BatchListScreen';
import BatchDetailScreen from './src/screens/batch/BatchDetailScreen';
import MachineListScreen from './src/screens/machine/MachineListScreen';
import BlendingListScreen from './src/screens/production/BlendingListScreen';
import PackingListScreen from './src/screens/production/PackingListScreen';  


const Stack = createNativeStackNavigator();
const navRef = createNavigationContainerRef();

const headerOpts = {
  headerStyle: { backgroundColor: COLORS.primaryDark },
  headerTintColor: '#fff',
  headerTitleStyle: { fontWeight: '700' },
  headerShadowVisible: false,
  animation: 'slide_from_right',
};

function Root() {
  const { user, loading } = useAuth();
  const { width } = useWindowDimensions();
  const [route, setRoute] = useState('Home');
  if (loading) {
    return <View style={{ flex: 1, justifyContent: 'center' }}><ActivityIndicator size="large" color={COLORS.primary} /></View>;
  }
  if (!user) return <LoginScreen />;
  return (
    <View style={{ flex: 1, flexDirection: 'row', backgroundColor: COLORS.bg }}>
      {width >= 900 && <Sidebar navRef={navRef} current={route} />}
      <View style={{ flex: 1, minWidth: 0 }}>
    <View style={{ flex: 1 }}>
    <NavigationContainer ref={navRef} onStateChange={() => setRoute(navRef.getCurrentRoute()?.name || 'Home')}>
      <Stack.Navigator screenOptions={headerOpts}>
        <Stack.Screen name="Home" component={HomeScreen} options={{ headerShown: false }} />
        <Stack.Screen name="MaterialList" component={MaterialListScreen} options={{ title: 'Material Master' }} />
        <Stack.Screen name="MaterialDetail" component={MaterialDetailScreen} options={{ title: 'Material Details' }} />
        <Stack.Screen name="VendorList" component={VendorListScreen} options={{ title: 'Vendor Master' }} />
        <Stack.Screen name="VendorDetail" component={VendorDetailScreen} options={{ title: 'Vendor Details' }} />
        <Stack.Screen name="StockList" component={StockListScreen} options={{ title: 'Material Stock' }} />
        <Stack.Screen name="StockCard" component={StockCardScreen} options={{ title: 'Material Card' }} />
        <Stack.Screen name="ProductList" component={ProductListScreen} options={{ title: 'Products & MRP' }} />
        <Stack.Screen name="GramList" component={GramListScreen} options={{ title: 'Grams' }} />
        <Stack.Screen name="RecipeList" component={RecipeListScreen} options={{ title: 'Recipes' }} />
        <Stack.Screen name="BatchList" component={BatchListScreen} options={{ title: 'Batches' }} />
        <Stack.Screen name="BatchDetail" component={BatchDetailScreen} options={{ title: 'Batch' }} />
        <Stack.Screen name="MachineList" component={MachineListScreen} options={{ title: 'Machines' }} />
        <Stack.Screen name="AccountList" component={AccountListScreen} options={{ title: 'Users' }} />
      <Stack.Screen name="BlendingList" component={BlendingListScreen} options={{ title: 'Blending' }} />
<Stack.Screen name="PackingList" component={PackingListScreen} options={{ title: 'Packing' }} /> 
      </Stack.Navigator>
    </NavigationContainer>
    </View>
    {width < 900 && <MobileTabBar navRef={navRef} current={route} />}
      </View>
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <PaperProvider theme={paperTheme}>
        <AuthProvider>
          <UiProvider>
            <Root />
          </UiProvider>
        </AuthProvider>
      </PaperProvider>
    </SafeAreaProvider>
  );
}