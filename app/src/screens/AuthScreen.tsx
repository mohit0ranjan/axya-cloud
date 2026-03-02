import React, { useState, useEffect, useRef } from 'react';
import {
    View, Text, StyleSheet,
    ActivityIndicator, Alert, Dimensions, StatusBar,
    Animated, Easing, KeyboardAvoidingView, Platform,
    TouchableOpacity
} from 'react-native';
import { Image } from 'expo-image';
import { ArrowRight, ArrowLeft, Shield, Zap, HardDrive } from 'lucide-react-native';
import apiClient from '../services/apiClient';
import { useAuth } from '../context/AuthContext';
import PhoneInput from '../components/PhoneInput';
import OTPInput from '../components/OTPInput';

const { width, height } = Dimensions.get('window');

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
    const { login } = useAuth();

    const [step, setStep] = useState<'phone' | 'otp'>('phone');
    const [isLoading, setIsLoading] = useState(false);
    const [phone, setPhone] = useState('');
    const [otp, setOtp] = useState('');
    const [error, setError] = useState<string | undefined>();

    // Telegram specific session info
    const [tempSession, setTempSession] = useState('');
    const [phoneCodeHash, setPhoneCodeHash] = useState('');

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

    const animateStep = () => {
        stepAnim.setValue(0);
        Animated.timing(stepAnim, { toValue: 1, duration: 350, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    };

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
        if (!otpToVerify || otpToVerify.length < 5) return;

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

    const floatY = floatAnim.interpolate({ inputRange: [0, 1], outputRange: [0, -12] });
    const stepFadeIn = stepAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });
    const stepSlide = stepAnim.interpolate({ inputRange: [0, 1], outputRange: [20, 0] });

    return (
        <View style={styles.root}>
            <StatusBar barStyle="dark-content" backgroundColor="#F4F6FB" />

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

            <TouchableOpacity style={styles.backBtn} onPress={() => navigation?.goBack()}>
                <ArrowLeft color="#8892A4" size={22} />
            </TouchableOpacity>

            <View style={styles.heroArea}>
                <Animated.View style={{
                    transform: [{ scale: heroScale }, { translateY: floatY }],
                    opacity: heroOpacity,
                    alignItems: 'center',
                }}>
                    <View style={styles.blob} />
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
                                    <FIcon color={f.color} size={14} />
                                    <Text style={[styles.featurePillText, { color: f.color }]}>{f.label}</Text>
                                </View>
                            );
                        })}
                    </View>
                </Animated.View>
            </View>

            <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'position' : undefined}
                style={styles.kavWrapper}
            >
                <Animated.View style={[styles.sheet, {
                    opacity: sheetOpacity,
                    transform: [{ translateY: sheetY }],
                }]}>
                    <View style={styles.sheetHandle} />

                    <View style={styles.sheetHeader}>
                        <Text style={styles.sheetTitle}>
                            {step === 'phone' ? 'Sign in with Telegram' : 'Enter the code'}
                        </Text>
                        <Text style={styles.sheetSubtitle}>
                            {step === 'phone'
                                ? 'Enter your mobile number to\nsecurely log in with Telegram.'
                                : `A verification code was sent to\n+91 ${phone.substring(0, 5)} ${phone.substring(5)}`
                            }
                        </Text>
                    </View>

                    <View style={styles.stepDots}>
                        <View style={[styles.stepDot, { backgroundColor: '#4B6EF5', width: step === 'phone' ? 24 : 8 }]} />
                        <View style={[styles.stepDot, { backgroundColor: step === 'otp' ? '#4B6EF5' : '#EAEDF3', width: step === 'otp' ? 24 : 8 }]} />
                    </View>

                    {step === 'phone' ? (
                        <View style={styles.formArea}>
                            <PhoneInput
                                value={phone}
                                onChangeText={setPhone}
                                error={error}
                                editable={!isLoading}
                            />

                            <TouchableOpacity
                                style={[styles.ctaBtn, (isLoading || phone.length !== 10) && styles.ctaDisabled]}
                                onPress={handleSendCode}
                                activeOpacity={0.85}
                                disabled={isLoading || phone.length !== 10}
                            >
                                {isLoading ? (
                                    <ActivityIndicator color="#fff" />
                                ) : (
                                    <>
                                        <Text style={styles.ctaText}>Send Verification Code</Text>
                                        <ArrowRight color="#fff" size={20} />
                                    </>
                                )}
                            </TouchableOpacity>
                        </View>
                    ) : (
                        <Animated.View style={[styles.formArea, { opacity: stepFadeIn, transform: [{ translateY: stepSlide }] }]}>
                            <OTPInput
                                value={otp}
                                onChange={(val) => {
                                    setOtp(val);
                                    if (val.length === 6) handleVerifyOtp(val);
                                }}
                                onResend={handleSendCode}
                                loading={isLoading}
                                error={error}
                            />

                            <TouchableOpacity
                                style={[styles.ctaBtn, (isLoading || otp.length < 5) && styles.ctaDisabled]}
                                onPress={() => handleVerifyOtp()}
                                activeOpacity={0.85}
                                disabled={isLoading || otp.length < 5}
                            >
                                {isLoading ? <ActivityIndicator color="#fff" /> : (
                                    <>
                                        <Text style={styles.ctaText}>Verify &amp; Sign In</Text>
                                        <ArrowRight color="#fff" size={20} />
                                    </>
                                )}
                            </TouchableOpacity>

                            <TouchableOpacity onPress={() => setStep('phone')} style={styles.backLink} disabled={isLoading}>
                                <ArrowLeft color="#8892A4" size={16} />
                                <Text style={styles.backLinkText}>Wrong number? Change it</Text>
                            </TouchableOpacity>
                        </Animated.View>
                    )}

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
    backBtn: { padding: 18, marginTop: Platform.OS === 'ios' ? 44 : 20, position: 'absolute', top: 0, left: 0, zIndex: 20 },
    heroArea: {
        position: 'absolute',
        top: 0, left: 0, right: 0,
        bottom: 380,
        alignItems: 'center', justifyContent: 'center',
    },
    blob: {
        position: 'absolute',
        width: 260, height: 260,
        borderRadius: 9999,
        backgroundColor: '#E8EFFE',
        opacity: 0.65,
    },
    logoCircle: {
        width: 90, height: 90,
        borderRadius: 26,
        backgroundColor: '#fff',
        justifyContent: 'center', alignItems: 'center',
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
        flexDirection: 'row', alignItems: 'center', gap: 5,
        paddingVertical: 6, paddingHorizontal: 12,
        borderRadius: 20,
    },
    featurePillText: { fontSize: 11, fontWeight: '700' },

    kavWrapper: { position: 'absolute', bottom: 0, left: 0, right: 0 },
    sheet: {
        backgroundColor: '#fff',
        borderTopLeftRadius: 32, borderTopRightRadius: 32,
        paddingHorizontal: 28, paddingTop: 16, paddingBottom: 36,
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -8 },
        shadowOpacity: 0.07, shadowRadius: 24,
        elevation: 20,
        gap: 16,
    },
    sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#E2E8F0', marginBottom: 4 },
    sheetHeader: { alignItems: 'center', gap: 6 },
    sheetTitle: { fontSize: 24, fontWeight: '800', color: '#1A1F36', letterSpacing: -0.5, textAlign: 'center' },
    sheetSubtitle: { fontSize: 14, color: '#8892A4', textAlign: 'center', lineHeight: 21 },
    stepDots: { flexDirection: 'row', gap: 6, alignItems: 'center' },
    stepDot: { height: 8, borderRadius: 4 },

    formArea: { width: '100%', gap: 20 },
    ctaBtn: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
        gap: 10, backgroundColor: '#4B6EF5',
        borderRadius: 18, height: 58, width: '100%',
        shadowColor: '#4B6EF5',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.28, shadowRadius: 14,
        elevation: 8,
    },
    ctaDisabled: { backgroundColor: '#A0AABB', shadowOpacity: 0, elevation: 0 },
    ctaText: { fontSize: 16, fontWeight: '700', color: '#fff' },
    backLink: { flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'center', marginTop: 8 },
    backLinkText: { fontSize: 14, color: '#8892A4', fontWeight: '600' },
    finePrint: { fontSize: 11, color: '#B0BAC9', textAlign: 'center', lineHeight: 17, marginTop: 4 },
});
