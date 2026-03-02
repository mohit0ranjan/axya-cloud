import React, { useState, useRef, useEffect } from 'react';
import { View, Text, TextInput, StyleSheet, TouchableOpacity } from 'react-native';

interface OTPInputProps {
    value: string;
    onChange: (otp: string) => void;
    onResend: () => void;
    loading?: boolean;
    error?: string;
    resendSeconds?: number;
}

const OTPInput: React.FC<OTPInputProps> = ({ value, onChange, onResend, loading, error, resendSeconds = 30 }) => {
    const [timer, setTimer] = useState(resendSeconds);
    const [otp, setOtp] = useState(['', '', '', '', '', '']);
    const inputRefs = useRef<TextInput[]>([]);

    useEffect(() => {
        let interval: NodeJS.Timeout;
        if (timer > 0) {
            interval = setInterval(() => setTimer(prev => prev - 1), 1000);
        }
        return () => clearInterval(interval);
    }, [timer]);

    useEffect(() => {
        // Handle external value updates (e.g. from SMS receiver)
        if (value && value.length === 6) {
            setOtp(value.split(''));
        }
    }, [value]);

    const handleTextChange = (text: string, index: number) => {
        const cleaned = text.replace(/[^0-9]/g, '');
        const newOtp = [...otp];
        newOtp[index] = cleaned[cleaned.length - 1] || '';
        setOtp(newOtp);
        const currentOtp = newOtp.join('');
        onChange(currentOtp);

        // Auto focus next
        if (cleaned && index < 5) {
            inputRefs.current[index + 1]?.focus();
        }
    };

    const handleKeyPress = (e: any, index: number) => {
        if (e.nativeEvent.key === 'Backspace' && !otp[index] && index > 0) {
            inputRefs.current[index - 1]?.focus();
        }
    };

    const handleResend = () => {
        if (timer === 0) {
            onResend();
            setTimer(resendSeconds);
        }
    };

    return (
        <View style={styles.container}>
            <View style={styles.otpRow}>
                {otp.map((digit, i) => (
                    <View key={i} style={[styles.inputBox, error ? styles.inputError : null]}>
                        <TextInput
                            ref={el => (inputRefs.current[i] = el as any)}
                            style={styles.input}
                            keyboardType="number-pad"
                            maxLength={1}
                            value={digit}
                            onChangeText={text => handleTextChange(text, i)}
                            onKeyPress={e => handleKeyPress(e, i)}
                            editable={!loading}
                            autoFocus={i === 0}
                        />
                    </View>
                ))}
            </View>

            {error ? <Text style={styles.errorText}>{error}</Text> : null}

            <View style={styles.footer}>
                {timer > 0 ? (
                    <Text style={styles.timerText}>Resend in {timer}s</Text>
                ) : (
                    <TouchableOpacity onPress={handleResend} disabled={loading}>
                        <Text style={styles.resendBtnText}>Resend OTP</Text>
                    </TouchableOpacity>
                )}
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        width: '100%',
        gap: 20,
        alignItems: 'center',
    },
    otpRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        width: '100%',
        gap: 8,
    },
    inputBox: {
        flex: 1,
        height: 58,
        backgroundColor: '#F4F6FB',
        borderRadius: 12,
        borderWidth: 1.5,
        borderColor: '#EAEDF3',
        justifyContent: 'center',
        alignItems: 'center',
    },
    inputError: {
        borderColor: '#EF4444',
    },
    input: {
        fontSize: 24,
        fontWeight: '700',
        color: '#1A1F36',
        textAlign: 'center',
        width: '100%',
    },
    errorText: {
        color: '#EF4444',
        fontSize: 13,
        fontWeight: '500',
    },
    footer: {
        alignItems: 'center',
    },
    timerText: {
        color: '#8892A4',
        fontSize: 14,
        fontWeight: '500',
    },
    resendBtnText: {
        color: '#4B6EF5',
        fontSize: 15,
        fontWeight: '700',
    },
});

export default OTPInput;
