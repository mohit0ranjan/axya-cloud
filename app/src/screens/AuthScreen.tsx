import React, { useState, useContext, useEffect, useRef } from 'react';
import {
    View, Text, TextInput, TouchableOpacity, StyleSheet,
    ActivityIndicator, Alert, Dimensions, StatusBar,
    Animated, Easing, KeyboardAvoidingView, Platform,
} from 'react-native';
import { Image } from 'expo-image';
import { Phone, Lock, ArrowRight, ArrowLeft, Shield, Zap, HardDrive } from 'lucide-react-native';
import apiClient from '../api/client';
import { AuthContext } from '../context/AuthContext';

const { width, height } = Dimensions.get('window');

// Same scattered dots pattern as WelcomeScreen
const DOTS = [
    { top: 0.06, left: 0.08, size: 9, color: '#4B6EF5' },
    { top: 0.09, left: 0.84, size: 7, color: '#FCBD0B' },
    { top: 0.18, left: 0.06, size: 6, color: '#EF4444' },
    { top: 0.14, left: 0.76, size: 9, color: '#4B6EF5' },
    { top: 0.28, left: 0.90, size: 5, color: '#1FD45A' },
    { top: 0.35, left: 0.03, size: 8, color: '#FCBD0B' },
];

const FEATURES = [
    { icon: Shield, label: 'MTProto Encrypted', color: '#4B6EF5', bg: '#EEF1FD' },
    { icon: Zap, label: 'Instant Upload', color: '#FCBD0B', bg: '#FFFBEB' },
    { icon: HardDrive, label: 'Unlimited Space', color: '#1FD45A', bg: '#F0FDF4' },
];

export default function AuthScreen({ navigation }: any) {
    const { login } = useContext(AuthContext);

    const [step, setStep] = useState<'phone' | 'otp'>('phone');
    const [isLoading, setIsLoading] = useState(false);
    const [phone, setPhone] = useState('+');
    const [tempSession, setTempSession] = useState('');
    const [phoneCodeHash, setPhoneCodeHash] = useState('');
    const [otp, setOtp] = useState('');

    // Animations
    const heroOpacity = useRef(new Animated.Value(0)).current;
    const heroScale = useRef(new Animated.Value(0.72)).current;
    const sheetY = useRef(new Animated.Value(200)).current;
    const sheetOpacity = useRef(new Animated.Value(0)).current;
    const floatAnim = useRef(new Animated.Value(0)).current;
    const dotAnims = useRef(DOTS.map(() => new Animated.Value(0))).current;
    const stepAnim = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        Animated.parallel([
            Animated.spring(heroScale, { toValue: 1, tension: 52, friction: 7, useNativeDriver: true }),
            Animated.timing(heroOpacity, { toValue: 1, duration: 500, useNativeDriver: true }),
            Animated.spring(sheetY, { toValue: 0, tension: 44, friction: 9, delay: 220, useNativeDriver: true }),
            Animated.timing(sheetOpacity, { toValue: 1, duration: 420, delay: 220, useNativeDriver: true }),
        ]).start();

        Animated.stagger(65, dotAnims.map(a =>
            Animated.timing(a, { toValue: 1, duration: 380, useNativeDriver: true })
        )).start();

        const float = Animated.loop(
            Animated.sequence([
                Animated.timing(floatAnim, { toValue: 1, duration: 2200, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
                Animated.timing(floatAnim, { toValue: 0, duration: 2200, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
            ])
        );
        const t = setTimeout(() => float.start(), 600);
        return () => { clearTimeout(t); float.stop(); };
    }, []);

    // Animate step transition
    const animateStep = () => {
        stepAnim.setValue(0);
        Animated.timing(stepAnim, { toValue: 1, duration: 350, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    };

    const handleSendCode = async () => {
        if (!phone || phone.length < 5) return Alert.alert('Error', 'Please enter a valid phone number.');
        setIsLoading(true);
        try {
            console.log(`📡 [Auth] Attempting to reach: ${apiClient.defaults.baseURL}/auth/send-code`);
            const res = await apiClient.post('/auth/send-code', { phoneNumber: phone });
            if (res.data.success) {
                setTempSession(res.data.tempSession);
                setPhoneCodeHash(res.data.phoneCodeHash);
                animateStep();
                setStep('otp');
            } else Alert.alert('Error', res.data.error || 'Failed to send code');
        } catch (e: any) {
            const errorMsg = e?.response?.data?.error || e.message || 'Unknown network error';
            Alert.alert(
                'Connection Error',
                `URL: ${apiClient.defaults.baseURL}\n\nError: ${errorMsg}\n\nPlease ensure your backend is online and the URL is correct.`
            );
        }
        finally { setIsLoading(false); }
    };

    const handleVerifyOtp = async () => {
        if (!otp || otp.length < 4) return Alert.alert('Error', 'Enter valid OTP.');
        setIsLoading(true);
        try {
            const res = await apiClient.post('/auth/verify-code', {
                phoneNumber: phone, phoneCodeHash, phoneCode: otp, tempSession,
            });
            if (res.data.success && res.data.token) await login(res.data.token);
            else Alert.alert('Verification Failed', res.data.error || 'Incorrect OTP');
        } catch (e: any) { Alert.alert('API Error', e?.response?.data?.error || 'Verify Failed'); }
        finally { setIsLoading(false); }
    };

    const floatY = floatAnim.interpolate({ inputRange: [0, 1], outputRange: [0, -12] });
    const stepFadeIn = stepAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });
    const stepSlide = stepAnim.interpolate({ inputRange: [0, 1], outputRange: [20, 0] });

    return (
        <View style={styles.root}>
            <StatusBar barStyle="dark-content" backgroundColor="#F4F6FB" />

            {/* ── Decorative dots ── */}
            {DOTS.map((d, i) => (
                <Animated.View key={i} style={{
                    position: 'absolute',
                    top: height * d.top,
                    left: width * d.left,
                    width: d.size,
                    height: d.size,
                    borderRadius: d.size / 2,
                    backgroundColor: d.color,
                    opacity: dotAnims[i].interpolate({ inputRange: [0, 1], outputRange: [0, 0.52] }),
                }} />
            ))}

            {/* ── Back arrow ── */}
            <TouchableOpacity style={styles.backBtn} onPress={() => navigation?.goBack()}>
                <ArrowLeft color="#8892A4" size={22} />
            </TouchableOpacity>

            {/* ── Hero section ── */}
            <View style={styles.heroArea}>
                <Animated.View style={{
                    transform: [{ scale: heroScale }, { translateY: floatY }],
                    opacity: heroOpacity,
                    alignItems: 'center',
                }}>
                    {/* Warm blob */}
                    <View style={styles.blob} />

                    {/* Axya logo in a glowing circle */}
                    <View style={styles.logoCircle}>
                        <Image
                            source={require('../../assets/axya_logo.png')}
                            style={styles.logoImg}
                            contentFit="contain"
                        />
                    </View>

                    {/* Feature pills floating around */}
                    <View style={styles.featureRow}>
                        {FEATURES.map((f) => {
                            const FIcon = f.icon;
                            return (
                                <View key={f.label} style={[styles.featurePill, { backgroundColor: f.bg }]}>
                                    <FIcon color={f.color} size={14} />
                                    <Text style={[styles.featurePillText, { color: f.color }]}>{f.label}</Text>
                                </View>
                            );
                        })}
                    </View>
                </Animated.View>
            </View>

            {/* ── Floating bottom sheet ── */}
            <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'position' : undefined}
                style={styles.kavWrapper}
            >
                <Animated.View style={[styles.sheet, {
                    opacity: sheetOpacity,
                    transform: [{ translateY: sheetY }],
                }]}>
                    {/* Handle */}
                    <View style={styles.sheetHandle} />

                    {/* Header */}
                    <View style={styles.sheetHeader}>
                        <Text style={styles.sheetTitle}>
                            {step === 'phone' ? 'Sign in with Telegram' : 'Enter the code'}
                        </Text>
                        <Text style={styles.sheetSubtitle}>
                            {step === 'phone'
                                ? 'Enter your Telegram phone number to\ncontinue to Axya.'
                                : `A verification code was sent to\n${phone}`
                            }
                        </Text>
                    </View>

                    {/* Step progress dots */}
                    <View style={styles.stepDots}>
                        <View style={[styles.stepDot, { backgroundColor: '#4B6EF5', width: step === 'phone' ? 24 : 8 }]} />
                        <View style={[styles.stepDot, { backgroundColor: step === 'otp' ? '#4B6EF5' : '#EAEDF3', width: step === 'otp' ? 24 : 8 }]} />
                    </View>

                    {/* Form fields */}
                    {step === 'phone' ? (
                        <>
                            <View style={styles.inputWrap}>
                                <View style={styles.inputIconBox}>
                                    <Phone color="#4B6EF5" size={18} />
                                </View>
                                <TextInput
                                    style={styles.input}
                                    placeholder="+1 234 567 8900"
                                    placeholderTextColor="#B0BAC9"
                                    keyboardType="phone-pad"
                                    value={phone}
                                    onChangeText={setPhone}
                                    editable={!isLoading}
                                    autoFocus
                                />
                            </View>

                            <TouchableOpacity
                                style={[styles.ctaBtn, isLoading && styles.ctaDisabled]}
                                onPress={handleSendCode}
                                activeOpacity={0.85}
                                disabled={isLoading}
                            >
                                {isLoading
                                    ? <ActivityIndicator color="#fff" />
                                    : <>
                                        <Text style={styles.ctaText}>Send Code</Text>
                                        <ArrowRight color="#fff" size={20} />
                                    </>
                                }
                            </TouchableOpacity>
                        </>
                    ) : (
                        <Animated.View style={{ width: '100%', gap: 16, opacity: stepFadeIn, transform: [{ translateY: stepSlide }] }}>
                            <View style={styles.inputWrap}>
                                <View style={styles.inputIconBox}>
                                    <Lock color="#4B6EF5" size={18} />
                                </View>
                                <TextInput
                                    style={styles.input}
                                    placeholder="5-digit code"
                                    placeholderTextColor="#B0BAC9"
                                    keyboardType="number-pad"
                                    value={otp}
                                    onChangeText={setOtp}
                                    editable={!isLoading}
                                    autoFocus
                                    maxLength={6}
                                />
                            </View>

                            <TouchableOpacity
                                style={[styles.ctaBtn, isLoading && styles.ctaDisabled]}
                                onPress={handleVerifyOtp}
                                activeOpacity={0.85}
                                disabled={isLoading}
                            >
                                {isLoading
                                    ? <ActivityIndicator color="#fff" />
                                    : <>
                                        <Text style={styles.ctaText}>Verify &amp; Sign In</Text>
                                        <ArrowRight color="#fff" size={20} />
                                    </>
                                }
                            </TouchableOpacity>

                            <TouchableOpacity onPress={() => setStep('phone')} style={styles.backLink}>
                                <ArrowLeft color="#8892A4" size={16} />
                                <Text style={styles.backLinkText}>Wrong number? Change it</Text>
                            </TouchableOpacity>
                        </Animated.View>
                    )}

                    {/* Fine print */}
                    <Text style={styles.finePrint}>
                        By continuing you agree to Axya's Terms · No passwords stored
                    </Text>
                </Animated.View>
            </KeyboardAvoidingView>
        </View>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1, backgroundColor: '#F4F6FB' },
    backBtn: { padding: 18, marginTop: 44, position: 'absolute', top: 0, left: 0, zIndex: 20 },

    // Dots / hero
    heroArea: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 380,
        alignItems: 'center',
        justifyContent: 'center',
    },
    blob: {
        position: 'absolute',
        width: 260,
        height: 260,
        borderRadius: 9999,
        backgroundColor: '#E8EFFE',
        opacity: 0.65,
    },
    logoCircle: {
        width: 90,
        height: 90,
        borderRadius: 26,
        backgroundColor: '#fff',
        justifyContent: 'center',
        alignItems: 'center',
        shadowColor: '#4B6EF5',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.2,
        shadowRadius: 20,
        elevation: 10,
        marginBottom: 20,
    },
    logoImg: { width: 66, height: 66, borderRadius: 18 },
    featureRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', justifyContent: 'center', paddingHorizontal: 20 },
    featurePill: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        paddingVertical: 6,
        paddingHorizontal: 12,
        borderRadius: 20,
    },
    featurePillText: { fontSize: 11, fontWeight: '700' },

    // Sheet
    kavWrapper: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
    },
    sheet: {
        backgroundColor: '#fff',
        borderTopLeftRadius: 32,
        borderTopRightRadius: 32,
        paddingHorizontal: 28,
        paddingTop: 16,
        paddingBottom: 36,
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -8 },
        shadowOpacity: 0.07,
        shadowRadius: 24,
        elevation: 20,
        gap: 16,
    },
    sheetHandle: {
        width: 40, height: 4, borderRadius: 2,
        backgroundColor: '#E2E8F0', marginBottom: 4,
    },
    sheetHeader: { alignItems: 'center', gap: 6 },
    sheetTitle: {
        fontSize: 24,
        fontWeight: '800',
        color: '#1A1F36',
        letterSpacing: -0.5,
        textAlign: 'center',
    },
    sheetSubtitle: {
        fontSize: 14,
        color: '#8892A4',
        textAlign: 'center',
        lineHeight: 21,
    },

    // Step dots
    stepDots: { flexDirection: 'row', gap: 6, alignItems: 'center' },
    stepDot: {
        height: 8,
        borderRadius: 4,
        // width is set inline
    },

    // Input
    inputWrap: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#F4F6FB',
        borderRadius: 16,
        borderWidth: 1.5,
        borderColor: '#EAEDF3',
        height: 58,
        width: '100%',
        paddingHorizontal: 4,
        gap: 4,
    },
    inputIconBox: {
        width: 44,
        height: 44,
        borderRadius: 12,
        backgroundColor: '#EEF1FD',
        justifyContent: 'center',
        alignItems: 'center',
        marginLeft: 4,
    },
    input: {
        flex: 1,
        fontSize: 16,
        color: '#1A1F36',
        fontWeight: '500',
        paddingRight: 14,
    },

    // CTA
    ctaBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        backgroundColor: '#4B6EF5',
        borderRadius: 18,
        height: 58,
        width: '100%',
        shadowColor: '#4B6EF5',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.28,
        shadowRadius: 14,
        elevation: 8,
    },
    ctaDisabled: { backgroundColor: '#A0AABB', shadowOpacity: 0, elevation: 0 },
    ctaText: { fontSize: 17, fontWeight: '700', color: '#fff' },

    // Back link
    backLink: { flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'center' },
    backLinkText: { fontSize: 14, color: '#8892A4', fontWeight: '600' },

    finePrint: { fontSize: 11, color: '#B0BAC9', textAlign: 'center', lineHeight: 17 },
});
