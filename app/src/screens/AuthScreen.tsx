import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
    View, Text, StyleSheet,
    ActivityIndicator, Dimensions, StatusBar,
    Animated, Easing, KeyboardAvoidingView, Platform,
    TouchableOpacity, SafeAreaView, Keyboard,
    Pressable,
} from 'react-native';
import { Image } from 'expo-image';
import { ArrowRight, ArrowLeft, Shield, Zap, HardDrive } from 'lucide-react-native';
import apiClient from '../services/apiClient';
import { useAuth } from '../context/AuthContext';
import PhoneInput from '../components/PhoneInput';
import OTPInput from '../components/OTPInput';

const { width, height } = Dimensions.get('window');

const DOTS = [
    { top: 0.08, left: 0.10, size: 10, color: '#4B6EF5', opacity: 0.45 },
    { top: 0.11, left: 0.82, size: 8, color: '#FCBD0B', opacity: 0.40 },
    { top: 0.20, left: 0.05, size: 6, color: '#EF4444', opacity: 0.35 },
    { top: 0.16, left: 0.78, size: 10, color: '#4B6EF5', opacity: 0.30 },
    { top: 0.30, left: 0.92, size: 5, color: '#1FD45A', opacity: 0.35 },
    { top: 0.33, left: 0.04, size: 8, color: '#FCBD0B', opacity: 0.30 },
    { top: 0.05, left: 0.50, size: 6, color: '#9333EA', opacity: 0.25 },
    { top: 0.24, left: 0.42, size: 4, color: '#1FD45A', opacity: 0.20 },
];

const FEATURES = [
    { icon: Shield, label: 'MTProto Encrypted', color: '#4B6EF5', bg: '#EEF1FD' },
    { icon: Zap, label: 'Instant Upload', color: '#E5A400', bg: '#FFFBEB' },
    { icon: HardDrive, label: 'Unlimited Space', color: '#16A34A', bg: '#F0FDF4' },
];

// ── Animated CTA Button ─────────────────────────────────────────
function CTAButton({
    onPress,
    disabled,
    loading,
    label,
}: { onPress: () => void; disabled: boolean; loading: boolean; label: string }) {
    const scaleAnim = useRef(new Animated.Value(1)).current;

    const onPressIn = () => {
        Animated.spring(scaleAnim, {
            toValue: 0.96,
            useNativeDriver: true,
            speed: 50,
            bounciness: 4,
        }).start();
    };

    const onPressOut = () => {
        Animated.spring(scaleAnim, {
            toValue: 1,
            useNativeDriver: true,
            speed: 20,
            bounciness: 6,
        }).start();
    };

    const isDisabled = disabled || loading;

    return (
        <Pressable
            onPress={onPress}
            onPressIn={onPressIn}
            onPressOut={onPressOut}
            disabled={isDisabled}
        >
            <Animated.View
                style={[
                    styles.ctaBtn,
                    isDisabled && styles.ctaDisabled,
                    { transform: [{ scale: scaleAnim }] },
                ]}
            >
                {loading ? (
                    <ActivityIndicator color="#fff" size="small" />
                ) : (
                    <>
                        <Text style={styles.ctaText}>{label}</Text>
                        <View style={styles.ctaArrow}>
                            <ArrowRight color="#fff" size={18} strokeWidth={2.5} />
                        </View>
                    </>
                )}
            </Animated.View>
        </Pressable>
    );
}

export default function AuthScreen({ navigation }: any) {
    const { login } = useAuth();

    const [step, setStep] = useState<'phone' | 'otp'>('phone');
    const [isLoading, setIsLoading] = useState(false);
    const [phone, setPhone] = useState('');
    const [otp, setOtp] = useState('');
    const [error, setError] = useState<string | undefined>();

    // Telegram specific session info
    const [tempSession, setTempSession] = useState('');
    const [phoneCodeHash, setPhoneCodeHash] = useState('');
    const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);

    // Animations
    const heroOpacity = useRef(new Animated.Value(0)).current;
    const heroScale = useRef(new Animated.Value(0.72)).current;
    const sheetY = useRef(new Animated.Value(200)).current;
    const sheetOpacity = useRef(new Animated.Value(0)).current;
    const floatAnim = useRef(new Animated.Value(0)).current;
    const dotAnims = useRef(DOTS.map(() => new Animated.Value(0))).current;
    const stepAnim = useRef(new Animated.Value(0)).current;

    // Keyboard-aware hero shrink animation
    const heroShrink = useRef(new Animated.Value(1)).current;
    const heroFadeOut = useRef(new Animated.Value(1)).current;

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

    // Keyboard show/hide — shrink hero so the sheet has room
    useEffect(() => {
        const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
        const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

        const onShow = () => {
            setIsKeyboardVisible(true);
            Animated.parallel([
                Animated.timing(heroShrink, { toValue: 0.55, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
                Animated.timing(heroFadeOut, { toValue: 0.0, duration: 200, useNativeDriver: true }),
            ]).start();
        };
        const onHide = () => {
            setIsKeyboardVisible(false);
            Animated.parallel([
                Animated.timing(heroShrink, { toValue: 1, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
                Animated.timing(heroFadeOut, { toValue: 1, duration: 280, useNativeDriver: true }),
            ]).start();
        };

        const sub1 = Keyboard.addListener(showEvent, onShow);
        const sub2 = Keyboard.addListener(hideEvent, onHide);
        return () => { sub1.remove(); sub2.remove(); };
    }, []);

    const animateStep = useCallback(() => {
        stepAnim.setValue(0);
        Animated.timing(stepAnim, { toValue: 1, duration: 350, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    }, []);

    const handleSendCode = async () => {
        if (!phone || phone.length !== 10) {
            setError('Please enter a valid 10-digit number');
            return;
        }

        setError(undefined);
        setIsLoading(true);

        try {
            const fullPhone = `+91${phone}`;
            const res = await apiClient.post('/auth/send-code', { phoneNumber: fullPhone });

            if (res.data.success) {
                setTempSession(res.data.tempSession);
                setPhoneCodeHash(res.data.phoneCodeHash);
                animateStep();
                setStep('otp');
            } else {
                setError(res.data.error || 'Failed to send code');
            }
        } catch (e: any) {
            setError(e?.response?.data?.error || 'Network error. Please try again.');
        } finally {
            setIsLoading(false);
        }
    };

    const handleVerifyOtp = async (inputOtp?: string) => {
        const otpToVerify = inputOtp || otp;
        if (!otpToVerify || otpToVerify.length < 5) return; // ✅ Telegram 5-digit codes

        setError(undefined);
        setIsLoading(true);
        try {
            const fullPhone = `+91${phone}`;
            const res = await apiClient.post('/auth/verify-code', {
                phoneNumber: fullPhone,
                phoneCodeHash,
                phoneCode: otpToVerify,
                tempSession,
            });
            if (res.data.success && res.data.token) {
                await login(res.data.token, res.data.user);
            } else {
                setError(res.data.error || 'Incorrect OTP');
            }
        } catch (e: any) {
            setError(e?.response?.data?.error || 'Verification failed');
        } finally {
            setIsLoading(false);
        }
    };

    const floatY = floatAnim.interpolate({ inputRange: [0, 1], outputRange: [0, -10] });
    const stepFadeIn = stepAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });
    const stepSlide = stepAnim.interpolate({ inputRange: [0, 1], outputRange: [20, 0] });
    const keyboardOffset = Platform.OS === 'ios' ? 24 : 0;

    return (
        <SafeAreaView style={styles.root}>
            <StatusBar barStyle="dark-content" backgroundColor="#F4F6FB" />

            {/* Floating dots — refined with per-dot opacity */}
            {DOTS.map((d, i) => (
                <Animated.View key={i} pointerEvents="none" style={{
                    position: 'absolute',
                    top: height * d.top,
                    left: width * d.left,
                    width: d.size,
                    height: d.size,
                    borderRadius: d.size / 2,
                    backgroundColor: d.color,
                    opacity: dotAnims[i].interpolate({ inputRange: [0, 1], outputRange: [0, d.opacity] }),
                }} />
            ))}

            <TouchableOpacity style={styles.backBtn} onPress={() => navigation?.goBack()}>
                <ArrowLeft color="#64748B" size={22} />
            </TouchableOpacity>

            <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                keyboardVerticalOffset={keyboardOffset}
                style={styles.keyboardContainer}
            >
                <Pressable style={styles.contentContainer} onPress={Keyboard.dismiss}>
                        {/* Hero — shrinks when keyboard opens */}
                        <Animated.View style={[
                            styles.heroArea,
                            isKeyboardVisible && styles.heroAreaKeyboard,
                            {
                                opacity: Animated.multiply(heroOpacity, heroFadeOut),
                                transform: [{ scale: Animated.multiply(heroScale, heroShrink) }],
                            },
                        ]}>
                            <Animated.View style={{
                                transform: [{ translateY: floatY }],
                                alignItems: 'center',
                            }}>
                                {/* Refined background circles */}
                                <View style={styles.blobOuter} />
                                <View style={styles.blobInner} />
                                <View style={styles.logoCircle}>
                                    <Image
                                        source={require('../../assets/axya_logo.png')}
                                        style={styles.logoImg}
                                        contentFit="contain"
                                    />
                                </View>
                                <View style={styles.featureRow}>
                                    {FEATURES.map((f) => {
                                        const FIcon = f.icon;
                                        return (
                                            <View key={f.label} style={[styles.featurePill, { backgroundColor: f.bg }]}>
                                                <FIcon color={f.color} size={13} strokeWidth={2.5} />
                                                <Text style={[styles.featurePillText, { color: f.color }]}>{f.label}</Text>
                                            </View>
                                        );
                                    })}
                                </View>
                            </Animated.View>
                        </Animated.View>

                        {/* Form sheet */}
                        <Animated.View style={[styles.sheet, {
                            opacity: sheetOpacity,
                            transform: [{ translateY: sheetY }],
                            marginBottom: isKeyboardVisible ? 14 : 0,
                        }]}>
                            <View style={styles.sheetHandle} />

                            <View style={styles.scrollContent}>
                                <View style={styles.sheetHeader}>
                                    <Text style={styles.sheetTitle}>
                                        {step === 'phone' ? 'Sign in with Telegram' : 'Enter the code'}
                                    </Text>
                                    <Text style={styles.sheetSubtitle}>
                                        {step === 'phone'
                                            ? 'Enter your mobile number to\nsecurely log in via Telegram.'
                                            : `A verification code was sent to\n+91 ${phone.substring(0, 5)} ${phone.substring(5)}`
                                        }
                                    </Text>
                                </View>

                                <View style={styles.stepDots}>
                                    <View style={[styles.stepDot, { backgroundColor: '#4B6EF5', width: step === 'phone' ? 24 : 8 }]} />
                                    <View style={[styles.stepDot, { backgroundColor: step === 'otp' ? '#4B6EF5' : '#E2E8F0', width: step === 'otp' ? 24 : 8 }]} />
                                </View>

                                {step === 'phone' ? (
                                    <View style={styles.formArea}>
                                        <PhoneInput
                                            value={phone}
                                            onChangeText={setPhone}
                                            error={error}
                                            editable={!isLoading}
                                            autoFocus={step === 'phone' && !isLoading}
                                            onSubmitEditing={handleSendCode}
                                        />

                                        <CTAButton
                                            onPress={handleSendCode}
                                            disabled={phone.length !== 10}
                                            loading={isLoading}
                                            label="Send Verification Code"
                                        />
                                    </View>
                                ) : (
                                    <Animated.View style={[styles.formArea, { opacity: stepFadeIn, transform: [{ translateY: stepSlide }] }]}>
                                        <OTPInput
                                            value={otp}
                                            onChange={(val) => {
                                                setOtp(val);
                                                if (val.length === 5) handleVerifyOtp(val);
                                            }}
                                            length={5}
                                            onResend={handleSendCode}
                                            loading={isLoading}
                                            error={error}
                                        />

                                        <CTAButton
                                            onPress={() => handleVerifyOtp()}
                                            disabled={otp.length < 5}
                                            loading={isLoading}
                                            label="Verify & Sign In"
                                        />

                                        <TouchableOpacity onPress={() => setStep('phone')} style={styles.backLink} disabled={isLoading}>
                                            <ArrowLeft color="#64748B" size={16} />
                                            <Text style={styles.backLinkText}>Wrong number? Change it</Text>
                                        </TouchableOpacity>
                                    </Animated.View>
                                )}

                                <Text style={styles.finePrint}>
                                    By continuing you agree to Axya's Terms · No passwords stored
                                </Text>
                            </View>
                        </Animated.View>
                </Pressable>
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1, backgroundColor: '#F4F6FB' },
    keyboardContainer: { flex: 1 },
    contentContainer: { flex: 1, justifyContent: 'flex-end' },
    backBtn: {
        padding: 14,
        marginTop: Platform.OS === 'ios' ? 8 : 12,
        position: 'absolute', top: 0, left: 4, zIndex: 20,
    },

    // Hero — reduced top spacing via smaller flex
    heroArea: {
        flex: 0.85,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        minHeight: 180,
    },
    heroAreaKeyboard: {
        flex: 0,
        minHeight: 24,
        maxHeight: 84,
    },
    // Refined concentric background circles
    blobOuter: {
        position: 'absolute',
        width: 280, height: 280,
        borderRadius: 9999,
        backgroundColor: '#E8EFFE',
        opacity: 0.35,
    },
    blobInner: {
        position: 'absolute',
        width: 180, height: 180,
        borderRadius: 9999,
        backgroundColor: '#D6DFFD',
        opacity: 0.30,
    },
    logoCircle: {
        width: 88, height: 88,
        borderRadius: 24,
        backgroundColor: '#fff',
        justifyContent: 'center', alignItems: 'center',
        shadowColor: '#4B6EF5',
        shadowOffset: { width: 0, height: 12 },
        shadowOpacity: 0.18,
        shadowRadius: 24,
        elevation: 10,
        marginBottom: 18,
    },
    logoImg: { width: 62, height: 62, borderRadius: 16 },
    featureRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', justifyContent: 'center', paddingHorizontal: 16 },
    featurePill: {
        flexDirection: 'row', alignItems: 'center', gap: 5,
        paddingVertical: 6, paddingHorizontal: 11,
        borderRadius: 20,
    },
    featurePillText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.1 },

    // Sheet
    sheet: {
        width: '100%',
        backgroundColor: '#fff',
        borderTopLeftRadius: 28, borderTopRightRadius: 28,
        paddingHorizontal: 24, paddingTop: 14, paddingBottom: 32,
        alignItems: 'center',
        shadowColor: '#1A1F36',
        shadowOffset: { width: 0, height: -6 },
        shadowOpacity: 0.06, shadowRadius: 20,
        elevation: 16,
    },
    scrollContent: { alignItems: 'center', gap: 16, paddingBottom: 8 },
    sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#E2E8F0', marginBottom: 4 },
    sheetHeader: { alignItems: 'center', gap: 8 },
    // Improved typography hierarchy
    sheetTitle: {
        fontSize: 22, fontWeight: '800', color: '#0F172A',
        letterSpacing: -0.4, textAlign: 'center',
    },
    sheetSubtitle: {
        fontSize: 14, color: '#64748B', textAlign: 'center',
        lineHeight: 21, fontWeight: '500',
    },
    stepDots: { flexDirection: 'row', gap: 6, alignItems: 'center' },
    stepDot: { height: 8, borderRadius: 4 },

    formArea: { width: '100%', gap: 20 },

    // CTA Button — premium styling
    ctaBtn: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
        gap: 10, backgroundColor: '#4B6EF5',
        borderRadius: 16, height: 58, width: '100%',
        shadowColor: '#3B5DE7',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.30, shadowRadius: 16,
        elevation: 8,
    },
    ctaDisabled: {
        backgroundColor: '#94A3B8',
        shadowColor: '#94A3B8',
        shadowOpacity: 0.12,
        elevation: 2,
    },
    ctaText: { fontSize: 16, fontWeight: '700', color: '#fff', letterSpacing: 0.2 },
    ctaArrow: {
        width: 28, height: 28, borderRadius: 14,
        backgroundColor: 'rgba(255,255,255,0.2)',
        justifyContent: 'center', alignItems: 'center',
    },

    backLink: { flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'center', marginTop: 8 },
    backLinkText: { fontSize: 14, color: '#64748B', fontWeight: '600' },
    // Improved contrast: #94A3B8 instead of #B0BAC9
    finePrint: { fontSize: 11, color: '#94A3B8', textAlign: 'center', lineHeight: 17, marginTop: 4, fontWeight: '500' },
});
