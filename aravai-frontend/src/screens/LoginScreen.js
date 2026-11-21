import React, { useEffect, useRef, useState } from 'react';
import { View, Image, StyleSheet, KeyboardAvoidingView, Platform, ScrollView, Animated, TouchableOpacity, ActivityIndicator, useWindowDimensions } from 'react-native';
import { TextInput, Text, HelperText } from 'react-native-paper';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { useAuth } from '../AuthContext';
import { errMsg } from '../api';
import FadeIn from '../components/FadeIn';

// put the files from the "assets" folder in your project: assets/login-bg.jpg, assets/chilli-logo.png
const BG = require('../../assets/login-bg.jpg');
const LOGO = require('../../assets/chilli-logo.png');
// Optional: a real 9:16 portrait version of the background (same style). Add the file, then swap null for the require.
const BG_PORTRAIT = null; // require('../../assets/login-bg-portrait.jpg');

const C = {
  maroon: '#8A1020',
  maroonDark: '#6B0A17',
  gold: '#F2A900',
  ink: '#1F1A17',
  border: '#F0D8BE',
  field: '#FFFBF6',
};

export default function LoginScreen() {
  const { login } = useAuth();
  const { height, width } = useWindowDimensions();
  const small = height < 700 || width < 360;
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const pop = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(pop, { toValue: 1, useNativeDriver: true, bounciness: 12 }).start();
  }, []); // eslint-disable-line

  const submit = async () => {
    setError('');
    if (!username.trim() || !password) return setError('Please enter username and password');
    setBusy(true);
    try { await login(username.trim(), password); }
    catch (e) { setError(errMsg(e)); }
    setBusy(false);
  };

  // Landscape background (1600x900): fill the screen, anchored left so the spice bowls,
  // gold curve and maroon panel all stay in view on a phone.
  const portrait = height > width;
  const bannerMode = portrait && !BG_PORTRAIT;   // phones: show the whole picture as a header banner
  const bannerH = (width * 9) / 16;
  const scale = Math.max(width / 1600, height / 900);
  const imgW = 1600 * scale, imgH = 900 * scale;
  const imgLeft = -(imgW - width) * (portrait ? 0.2 : 0.5);
  const imgTop = -(imgH - height) * 0.5;

  return (
    <View style={{ flex: 1, backgroundColor: '#FBEEDC', overflow: 'hidden' }}>
      <StatusBar style="dark" />
      {portrait && BG_PORTRAIT ? (
        <Image source={BG_PORTRAIT} resizeMode="cover" style={StyleSheet.absoluteFill} />
      ) : bannerMode ? (
        <>
          {/* soft blurred copy fills the rest of the screen */}
          <Image source={BG} blurRadius={Platform.OS === 'web' ? 0 : 20} resizeMode="cover"
            style={[StyleSheet.absoluteFill, Platform.OS === 'web' && { filter: 'blur(24px)', transform: [{ scale: 1.15 }] }]} />
          {/* the FULL image, nothing cropped */}
          <View style={{ position: 'absolute', top: 0, left: 0, width, height: bannerH, borderBottomLeftRadius: 28, borderBottomRightRadius: 28, overflow: 'hidden' }}>
            <Image source={BG} resizeMode="cover" style={{ width, height: bannerH }} />
          </View>
        </>
      ) : (
        <Image source={BG} style={{ position: 'absolute', width: imgW, height: imgH, left: imgLeft, top: imgTop }} />
      )}

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={[s.wrap, bannerMode && { justifyContent: 'flex-start', paddingTop: Math.max(bannerH - 60, 120) }]} keyboardShouldPersistTaps="handled">
          <FadeIn delay={150} from={40} style={[s.card, small && { padding: 18 }]}>
            <Animated.View style={{ alignItems: 'center', transform: [{ scale: pop }] }}>
              <Image source={LOGO} style={{ width: small ? 58 : 72, height: small ? 52 : 64 }} resizeMode="contain" />
            </Animated.View>

            <Text style={[s.title, small && { fontSize: 22 }]}>
              ARAVAI <Text style={{ color: C.maroon }}>MASALA</Text>
            </Text>
            <Text style={s.sub}>Manufacturing Management</Text>
            <View style={s.underline} />

            <Text style={s.welcome}>Login to Your Account</Text>

            <TextInput
              label="Username" mode="outlined" value={username} onChangeText={setUsername}
              autoCapitalize="none" left={<TextInput.Icon icon="account" />}
              outlineColor={C.border} activeOutlineColor={C.maroon}
              outlineStyle={{ borderRadius: 14 }} style={s.input}
            />
            <TextInput
              label="Password" mode="outlined" value={password} onChangeText={setPassword}
              secureTextEntry={!show} left={<TextInput.Icon icon="lock" />}
              right={<TextInput.Icon icon={show ? 'eye-off' : 'eye'} onPress={() => setShow(!show)} />}
              outlineColor={C.border} activeOutlineColor={C.maroon}
              outlineStyle={{ borderRadius: 14 }} style={s.input} onSubmitEditing={submit}
            />
            <HelperText type="error" visible={!!error}>{error}</HelperText>

            <TouchableOpacity activeOpacity={0.85} onPress={submit} disabled={busy} style={s.btnWrap}>
              <LinearGradient colors={['#9B1427', '#74091A']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.btn}>
                {busy
                  ? <ActivityIndicator color="#fff" />
                  : <><MaterialCommunityIcons name="login" size={22} color="#fff" /><Text style={s.btnText}>Login</Text></>}
              </LinearGradient>
            </TouchableOpacity>
          </FadeIn>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flexGrow: 1, justifyContent: 'center', padding: 20, paddingVertical: 32 },
  card: {
    backgroundColor: 'rgba(255,255,255,0.96)', borderRadius: 30, padding: 26, maxWidth: 400, width: '100%', alignSelf: 'center',
    elevation: 12, shadowColor: '#3a0a10', shadowOpacity: 0.25, shadowRadius: 24, shadowOffset: { width: 0, height: 12 },
  },
  title: { textAlign: 'center', fontWeight: '900', fontSize: 27, color: C.ink, marginTop: 8, letterSpacing: 0.5 },
  sub: { textAlign: 'center', color: C.ink, fontSize: 14, marginTop: 2 },
  underline: { alignSelf: 'center', width: 110, height: 3, borderRadius: 3, backgroundColor: C.gold, marginTop: 8, marginBottom: 22 },
  welcome: { textAlign: 'center', fontSize: 19, fontWeight: '800', color: C.maroonDark, marginBottom: 18 },
  input: { marginBottom: 12, backgroundColor: C.field },
  btnWrap: { marginTop: 6, borderRadius: 14, overflow: 'hidden' },
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 15, gap: 10 },
  btnText: { color: '#fff', fontSize: 17, fontWeight: '700' },
});