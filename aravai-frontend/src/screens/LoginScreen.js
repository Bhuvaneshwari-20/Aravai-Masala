import React, { useEffect, useRef, useState } from 'react';
import { View, StyleSheet, KeyboardAvoidingView, Platform, ScrollView, Animated } from 'react-native';
import { TextInput, Button, Text, HelperText } from 'react-native-paper';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { useAuth } from '../AuthContext';
import { errMsg } from '../api';
import { COLORS, GRADIENT } from '../theme';
import FadeIn from '../components/FadeIn';
import SpinningDabba from '../components/SpinningDabba';

export default function LoginScreen() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // logo: pops in, then floats gently
  const pop = useRef(new Animated.Value(0)).current;
  const float = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(pop, { toValue: 1, useNativeDriver: true, bounciness: 14 }).start();
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(float, { toValue: 1, duration: 1600, useNativeDriver: true }),
      Animated.timing(float, { toValue: 0, duration: 1600, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, []); // eslint-disable-line

  const submit = async () => {
    setError('');
    if (!username.trim() || !password) return setError('Please enter username and password');
    setBusy(true);
    try { await login(username.trim(), password); }
    catch (e) { setError(errMsg(e)); }
    setBusy(false);
  };

  return (
    <LinearGradient colors={GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flex: 1 }}>
      <StatusBar style="light" />
      <View style={s.c1} /><View style={s.c2} />
      <SpinningDabba size={440} duration={60000} style={{ position: 'absolute', right: -180, bottom: -170, opacity: 0.5 }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={s.wrap} keyboardShouldPersistTaps="handled">
          <Animated.View style={{ alignItems: 'center', transform: [{ scale: pop }, { translateY: float.interpolate({ inputRange: [0, 1], outputRange: [0, -8] }) }] }}>
            <View style={s.logo}><Text style={{ fontSize: 48 }}>🌶️</Text></View>
          </Animated.View>
          <FadeIn delay={200}>
            <Text style={s.title}>ARAVAI MASALA</Text>
            <Text style={s.sub}>Manufacturing Management</Text>
          </FadeIn>

          <FadeIn delay={400} from={40} style={s.card}>
            <Text style={s.welcome}>Login</Text>
            <TextInput label="Username" mode="outlined" value={username} onChangeText={setUsername}
              autoCapitalize="none" left={<TextInput.Icon icon="account" />} outlineStyle={{ borderRadius: 14 }}
              activeOutlineColor={COLORS.primary} style={s.input} />
            <TextInput label="Password" mode="outlined" value={password} onChangeText={setPassword}
              secureTextEntry={!show} left={<TextInput.Icon icon="lock" />} outlineStyle={{ borderRadius: 14 }}
              activeOutlineColor={COLORS.primary} style={s.input} onSubmitEditing={submit}
              right={<TextInput.Icon icon={show ? 'eye-off' : 'eye'} onPress={() => setShow(!show)} />} />
            <HelperText type="error" visible={!!error}>{error}</HelperText>
            <Button mode="contained" onPress={submit} loading={busy} disabled={busy} buttonColor={COLORS.primary}
              style={s.btn} contentStyle={{ paddingVertical: 8 }} labelStyle={{ fontSize: 16, fontWeight: '700' }}>
              Login
            </Button>
          </FadeIn>
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const s = StyleSheet.create({
  wrap: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  c1: { position: 'absolute', width: 260, height: 260, borderRadius: 130, backgroundColor: 'rgba(255,255,255,0.08)', top: -80, right: -70 },
  c2: { position: 'absolute', width: 200, height: 200, borderRadius: 100, backgroundColor: 'rgba(242,169,0,0.2)', bottom: -60, left: -50 },
  logo: { width: 104, height: 104, borderRadius: 52, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', elevation: 8,
    shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 14, shadowOffset: { width: 0, height: 6 } },
  title: { textAlign: 'center', fontWeight: '900', fontSize: 28, color: '#fff', marginTop: 18, letterSpacing: 2 },
  sub: { textAlign: 'center', marginBottom: 28, color: '#FFE2C6', fontSize: 15 },
  card: { backgroundColor: '#fff', borderRadius: 26, padding: 22, elevation: 8, maxWidth: 460, width: '100%', alignSelf: 'center',
    shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 18, shadowOffset: { width: 0, height: 8 } },
  welcome: { fontSize: 22, fontWeight: '800', color: COLORS.text, marginBottom: 14 },
  input: { marginBottom: 12, backgroundColor: '#fff' },
  btn: { marginTop: 4, borderRadius: 16 },
});
