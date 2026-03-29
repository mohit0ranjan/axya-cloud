import React, { useState, useRef, useEffect, useCallback } from 'react';
import { View, Text, TextInput, StyleSheet, TouchableOpacity, Animated } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useTheme } from '../context/ThemeContext';

interface OTPInputProps {
    value: string;
    onChange: (otp: string) => void;
    onResend: () => void;
    loading?: boolean;
    error?: string;
    resendSeconds?: number;
    length?: number;
}

export default React.memo(function OTPInput({
    value,
    onChange,
    onResend,
    loading,
    error,
    resendSeconds = 30,
    length = 5,
}: OTPInputProps) {
    const { theme, isDark } = useTheme();
    const C = theme.colors;
    const styles = React.useMemo(() => createStyles(C, isDark), [C, isDark]);

    const [timer, setTimer] = useState(resendSeconds);
    const [otp, setOtp] = useState<string[]>(Array(length).fill(''));
    const inputRefs = useRef<TextInput[]>([]);
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // Dynamic underline color animations
    const focusAnims = useRef(Array(length).fill(0).map(() => new Animated.Value(0))).current;

    useEffect(() => {
        if (timer > 0) {
            intervalRef.current = setInterval(() => {
                setTimer(prev => {
                    if (prev <= 1) {
                        if (intervalRef.current) clearInterval(intervalRef.current);
                        return 0;
                    }
                    return prev - 1;
                });
            }, 1000);
        }
        return () => {
            if (intervalRef.current) clearInterval(intervalRef.current);
        };
    }, [timer > 0 ? 'running' : 'stopped']);

    // Removed value sync useEffect (Fix #5) — component manages its own otp array state

    const animateFocus = useCallback((index: number, isFocused: boolean) => {
        Animated.timing(focusAnims[index], {
            toValue: isFocused ? 1 : 0,
            duration: 200,
            useNativeDriver: false,
        }).start();
    }, [focusAnims]);

    const handleTextChange = (text: string, index: number) => {
        const cleaned = text.replace(/[^0-9]/g, '');

        if (cleaned.length > 1) {
            const newOtp = [...otp];
            for (let i = 0; i < length && i < cleaned.length; i++) {
                newOtp[index + i < length ? index + i : length - 1] = cleaned[i];
            }
            setOtp(newOtp);
            const joined = newOtp.join('');
            onChange(joined);
            const lastIdx = Math.min(index + cleaned.length - 1, length - 1);
            inputRefs.current[lastIdx]?.focus();
            return;
        }

        const newOtp = [...otp];
        newOtp[index] = cleaned[cleaned.length - 1] || '';
        setOtp(newOtp);
        const currentOtp = newOtp.join('');
        onChange(currentOtp);

        if (cleaned && index < length - 1) {
            inputRefs.current[index + 1]?.focus();
        }
    };

    const handleKeyPress = (e: any, index: number) => {
        if (e.nativeEvent.key === 'Backspace' && !otp[index] && index > 0) {
            const newOtp = [...otp];
            newOtp[index - 1] = '';
            setOtp(newOtp);
            onChange(newOtp.join(''));
            inputRefs.current[index - 1]?.focus();
        }
    };

    const handleResend = () => {
        if (timer === 0) {
            setOtp(Array(length).fill(''));
            onChange('');
            onResend();
            setTimer(resendSeconds);
        }
    };

    const checkClipboardForOTP = async () => {
        try {
            const hasText = await Clipboard.hasStringAsync();
            if (hasText) {
                const text = await Clipboard.getStringAsync();
                const cleaned = text.replace(/[^0-9]/g, '');
                if (cleaned.length === length) {
                    setOtp(cleaned.split(''));
                    inputRefs.current[length - 1]?.focus();
                }
            }
        } catch (e) {
            // Ignore clipboard errors
        }
    };

    useEffect(() => {
        checkClipboardForOTP();
    }, []);

    return (
        <View style={styles.container}>
            <View style={styles.otpRow}>
                {otp.map((digit, i) => {
                    const borderColor = error
                        ? C.danger || '#EF4444'
                        : focusAnims[i].interpolate({
                            inputRange: [0, 1],
                            outputRange: [C.border || '#CBD5E1', C.primary || '#4B6EF5']
                        });

                    return (
                        <View key={i} style={styles.inputBoxWrapper}>
                            <Animated.View style={[
                                styles.underline,
                                { borderBottomColor: borderColor as unknown as string }
                            ]} />

                            <TextInput
                                ref={el => (inputRefs.current[i] = el as any)}
                                style={styles.input}
                                keyboardType="number-pad"
                                maxLength={1}
                                value={digit}
                                onChangeText={text => handleTextChange(text, i)}
                                onKeyPress={e => handleKeyPress(e, i)}
                                onFocus={() => animateFocus(i, true)}
                                onBlur={() => animateFocus(i, false)}
                                editable={!loading}
                                autoFocus={i === 0 && !loading}
                                textContentType="oneTimeCode"
                                autoComplete="sms-otp"
                                selectTextOnFocus
                            />
                        </View>
                    );
                })}
            </View>

            {error ? <Text style={styles.errorText}>{error}</Text> : null}

            <View style={styles.footer}>
                {timer > 0 ? (
                    <Text style={styles.timerText}>
                        <Text style={styles.timerSub}>Resend code in </Text>
                        <Text style={styles.timerBold}>{timer}s</Text>
                    </Text>
                ) : (
                    <TouchableOpacity onPress={handleResend} disabled={loading} style={styles.resendBtn}>
                        <Text style={styles.resendBtnText}>Resend Code</Text>
                    </TouchableOpacity>
                )}
            </View>
        </View>
    );
});

const createStyles = (C: any, isDark: boolean) => StyleSheet.create({
    container: {
        width: '100%',
        gap: 24,
        alignItems: 'center',
    },
    otpRow: {
        flexDirection: 'row',
        justifyContent: 'center',
        width: '100%',
        gap: 16,
    },
    inputBoxWrapper: {
        width: 48,
        height: 56,
        justifyContent: 'center',
        alignItems: 'center',
        position: 'relative',
    },
    underline: {
        position: 'absolute',
        bottom: 0,
        width: '100%',
        borderBottomWidth: 2,
    },
    input: {
        fontSize: 32,
        fontWeight: '700',
        color: C.textHeading,
        textAlign: 'center',
        width: '100%',
        height: '100%',
    },
    errorText: {
        color: C.danger || '#EF4444',
        fontSize: 14,
        fontWeight: '500',
        textAlign: 'center',
    },
    footer: {
        alignItems: 'center',
        justifyContent: 'center',
    },
    timerText: {
        fontSize: 15,
    },
    timerSub: {
        color: C.textBody,
        fontWeight: '500',
    },
    timerBold: {
        color: C.textHeading,
        fontWeight: '700',
    },
    resendBtn: {
        paddingVertical: 8,
    },
    resendBtnText: {
        color: C.primary || '#4B6EF5',
        fontSize: 15,
        fontWeight: '700',
    },
});
