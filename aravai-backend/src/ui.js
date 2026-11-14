import React, { createContext, useContext, useState } from 'react';
import { View } from 'react-native';
import { Snackbar } from 'react-native-paper';

// App-wide toast ("coming soon" etc.) that works on web and phone
const Ctx = createContext({ toast: () => {} });
export const useUi = () => useContext(Ctx);

export function UiProvider({ children }) {
  const [msg, setMsg] = useState('');
  return (
    <Ctx.Provider value={{ toast: setMsg }}>
      <View style={{ flex: 1 }}>
        {children}
        <Snackbar visible={!!msg} onDismiss={() => setMsg('')} duration={2500} action={{ label: 'OK', onPress: () => setMsg('') }}>{msg}</Snackbar>
      </View>
    </Ctx.Provider>
  );
}
