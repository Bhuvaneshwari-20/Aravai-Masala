import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

// Phone = SecureStore, Web = localStorage
export const storage = {
  get: async (k) => (Platform.OS === 'web' ? localStorage.getItem(k) : SecureStore.getItemAsync(k)),
  set: async (k, v) => (Platform.OS === 'web' ? localStorage.setItem(k, v) : SecureStore.setItemAsync(k, v)),
  del: async (k) => (Platform.OS === 'web' ? localStorage.removeItem(k) : SecureStore.deleteItemAsync(k)),
};