import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
    View, Text, StyleSheet,
    StatusBar, Animated, Easing, KeyboardAvoidingView, Platform,
    TouchableOpacity, Keyboard, TouchableWithoutFeedback
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft } from 'lucide-react-native';

import apiClient from '../services/apiClient';
import { useAuth } from '../context/AuthContext';

import HeroSection from '../components/HeroSection';
import LoginCard from '../components/LoginCard';
import PhoneInputField from '../components/PhoneInputField';
import OTPInput from '../components/OTPInput';
import PrimaryButton from '../components/PrimaryButton';

export default function AuthScreen({ navigation }: any) {
    const { login } = useAuth();

    const [step, setStep] = useState<'phone' | 'otp'>('phone');
    const [isLoading, setIsLoading] = useState(false);
    const [phone, setPhone] = useState('');
    const [otp, setOtp] = useState('');
    const [error, setError] = useState<string | undefined>();

    const [tempSession, setTempSession] = useState('');
    const [phoneCodeHash, setPhoneCodeHash] = useState('');
    const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);

    // Fix #1: Guard against double-submit race condition
    const isVerifying = useRef(false);
    // Fix #5: Only auto-focus on initial mount
    const hasAutoFocused = useRef(false);

    // Hero Animations
    const heroOpacity = useRef(new Animated.Value(0)).current;
    const heroScale = useRef(new Animated.Value(0.85)).current;
    const heroShrink = useRef(new Animated.Value(1)).current;
    const heroFadeOut = useRef(new Animated.Value(1)).current;

    // Step Transition Animation
    const stepAnim = useRef(new Animated.Value(0)).current;

    // Fix #8: Animated step dot values
    const dot1Width = useRef(new Animated.Value(24)).current;
    const dot2Width = useRef(new Animated.Value(8)).current;
    const dot1Color = useRef(new Animated.Value(1)).current;  // 1 = active, 0 = inactive
    const dot2Color = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        Animated.parallel([
            Animated.spring(heroScale, { toValue: 1, tension: 52, friction: 8, useNativeDriver: true }),
            Animated.timing(heroOpacity, { toValue: 1, duration: 600, useNativeDriver: true }),
        ]).start();
    }, []);

    useEffect(() => {
        const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
        const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

        const onShow = () => {
            setIsKeyboardVisible(true);
            Animated.parallel([
                Animated.timing(heroShrink, { toValue: 0.65, duration: 250, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
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

    // Fix #8: Animate step dots when step changes
    useEffect(() => {
        const isOtp = step === 'otp';
        Animated.parallel([
            Animated.timing(dot1Width, { toValue: isOtp ? 8 : 24, duration: 300, useNativeDriver: false }),
            Animated.timing(dot2Width, { toValue: isOtp ? 24 : 8, duration: 300, useNativeDriver: false }),
            Animated.timing(dot1Color, { toValue: isOtp ? 0 : 1, duration: 300, useNativeDriver: false }),
            Animated.timing(dot2Color, { toValue: isOtp ? 1 : 0, duration: 300, useNativeDriver: false }),
        ]).start();
    }, [step]);

    const animateStep = useCallback(() => {
        stepAnim.setValue(0);
        Animated.timing(stepAnim, {
            toValue: 1,
            duration: 400,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true
        }).start();
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

    // Fix #1: Race-condition-safe OTP verification
    const handleVerifyOtp = async (inputOtp?: string) => {
        const otpToVerify = inputOtp || otp;
        if (!otpToVerify || otpToVerify.length < 5) return;

        // Prevent double-submit
        if (isVerifying.current) return;
        isVerifying.current = true;

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
            isVerifying.current = false;
        }
    };

    const stepFadeIn = stepAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });
    const stepSlide = stepAnim.interpolate({ inputRange: [0, 1], outputRange: [24, 0] });
    const keyboardOffset = Platform.OS === 'ios' ? 0 : 20;

    // Fix #8: Interpolate dot colors
    const dot1BgColor = dot1Color.interpolate({
        inputRange: [0, 1],
        outputRange: ['#E2E8F0', '#4B6EF5'],
    });
    const dot2BgColor = dot2Color.interpolate({
        inputRange: [0, 1],
        outputRange: ['#E2E8F0', '#4B6EF5'],
    });

    // Fix #5: Compute autoFocus only once on mount
    const shouldAutoFocus = !hasAutoFocused.current && step === 'phone';
    if (shouldAutoFocus) hasAutoFocused.current = true;

    return (
        <SafeAreaView style={styles.root} edges={['top', 'left', 'right']}>
            <StatusBar barStyle="dark-content" backgroundColor="#F4F6FB" />

            {/* Back Button */}
            <TouchableOpacity style={styles.backBtn} onPress={() => navigation?.goBack()}>
                <View style={styles.backIconCircle}>
                    <ArrowLeft color="#1A1F36" size={22} strokeWidth={2.5} />
                </View>
            </TouchableOpacity>

            <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                keyboardVerticalOffset={keyboardOffset}
                style={styles.keyboardContainer}
            >
                <View style={styles.contentContainer}>
                    <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
                        <View style={styles.heroWrapper} pointerEvents={isKeyboardVisible ? 'none' : 'auto'}>
                            <HeroSection
                                keyboardVisible={isKeyboardVisible}
                                heroOpacity={heroOpacity}
                                heroScale={heroScale}
                                heroShrink={heroShrink}
                                heroFadeOut={heroFadeOut}
                            />
                        </View>
                    </TouchableWithoutFeedback>

                    <LoginCard keyboardVisible={isKeyboardVisible}>
                        <View style={styles.sheetHeader}>
                            <Text style={styles.sheetTitle}>
                                {step === 'phone' ? 'Welcome Back' : 'Verification'}
                            </Text>
                            <Text style={styles.sheetSubtitle}>
                                {step === 'phone'
                                    ? 'Enter your phone number to continue'
                                    : `Code sent to +91 ${phone.substring(0, 5)} ${phone.substring(5)}`
                                }
                            </Text>
                        </View>

                        {/* Fix #8: Animated step dots */}
                        <View style={styles.stepDots}>
                            <Animated.View style={[styles.stepDot, {
                                backgroundColor: dot1BgColor as any,
                                width: dot1Width,
                            }]} />
                            <Animated.View style={[styles.stepDot, {
                                backgroundColor: dot2BgColor as any,
                                width: dot2Width,
                            }]} />
                        </View>

                        {step === 'phone' ? (
                            <View style={styles.formArea}>
                                <PhoneInputField
                                    value={phone}
                                    onChangeText={(text) => {
                                        setPhone(text);
                                        setError(undefined);
                                    }}
                                    error={error}
                                    editable={!isLoading}
                                    autoFocus={shouldAutoFocus}
                                    onSubmitEditing={handleSendCode}
                                />

                                {/* Fix #10: Use StyleSheet spacer instead of inline */}
                                <View style={styles.spacerSm} />

                                <PrimaryButton
                                    onPress={handleSendCode}
                                    disabled={phone.length !== 10}
                                    loading={isLoading}
                                    label="Continue"
                                />
                            </View>
                        ) : (
                            <Animated.View style={[styles.formArea, {
                                opacity: stepFadeIn,
                                transform: [{ translateY: stepSlide }]
                            }]}>
                                <OTPInput
                                    value={otp}
                                    onChange={(val) => {
                                        setOtp(val);
                                        setError(undefined);
                                        if (val.length === 5) handleVerifyOtp(val);
                                    }}
                                    length={5}
                                    onResend={handleSendCode}
                                    loading={isLoading}
                                    error={error}
                                />

                                <View style={styles.spacerSm} />

                                <PrimaryButton
                                    onPress={() => handleVerifyOtp()}
                                    disabled={otp.length < 5}
                                    loading={isLoading}
                                    label="Verify & Sign In"
                                />

                                <TouchableOpacity
                                    onPress={() => {
                                        setStep('phone');
                                        setOtp('');
                                        setError(undefined);
                                    }}
                                    style={styles.backLink}
                                    disabled={isLoading}
                                >
                                    <Text style={styles.backLinkText}>Wrong number? Edit</Text>
                                </TouchableOpacity>
                            </Animated.View>
                        )}

                        <Text style={styles.finePrint}>
                            Protected by MTProto · End-to-End Encrypted
                        </Text>
                    </LoginCard>

                </View>
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    root: {
        flex: 1,
        backgroundColor: '#F4F6FB'
    },
    keyboardContainer: {
        flex: 1
    },
    contentContainer: {
        flex: 1,
        justifyContent: 'space-between'
    },
    heroWrapper: {
        flex: 1,
        width: '100%'
    },
    backBtn: {
        position: 'absolute',
        top: Platform.OS === 'ios' ? 60 : 24,
        left: 20,
        zIndex: 20,
    },
    backIconCircle: {
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: 'rgba(255, 255, 255, 0.6)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    sheetHeader: {
        alignItems: 'center',
        gap: 6,
        marginTop: 4,
    },
    sheetTitle: {
        fontSize: 28,
        fontWeight: '700',
        color: '#0F172A',
        letterSpacing: -0.3,
        textAlign: 'center',
    },
    sheetSubtitle: {
        fontSize: 15,
        color: '#64748B',
        textAlign: 'center',
        lineHeight: 22,
        fontWeight: '400',
    },
    stepDots: {
        flexDirection: 'row',
        gap: 6,
        alignItems: 'center'
    },
    stepDot: {
        height: 6,
        borderRadius: 3
    },
    formArea: {
        width: '100%',
        gap: 16
    },
    // Fix #10: StyleSheet spacer
    spacerSm: {
        height: 8,
    },
    backLink: {
        alignItems: 'center',
        marginTop: 8,
        paddingVertical: 4,
    },
    backLinkText: {
        fontSize: 15,
        color: '#64748B',
        fontWeight: '600'
    },
    finePrint: {
        fontSize: 12,
        color: '#94A3B8',
        textAlign: 'center',
        marginTop: 8,
        fontWeight: '600',
        letterSpacing: 0.2,
    },
});
