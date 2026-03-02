import React, { useState, useRef, useEffect } from 'react';
import { View, Text, TextInput, StyleSheet, TouchableOpacity } from 'react-native';

interface OTPInputProps {
    value: string;
    onChange: (otp: string) => void;
    onResend: () => void;
    loading?: boolean;
    error?: string;
    resendSeconds?: number;
    length?: number;
}

const OTPInput: React.FC<OTPInputProps> = ({
    value,
    onChange,
    onResend,
    loading,
    error,
    resendSeconds = 30,
    length = 5,   // ✅ Telegram sends 5-digit codes — default to 5
}) => {
    const [timer, setTimer] = useState(resendSeconds);
    const [otp, setOtp] = useState<string[]>(Array(length).fill(''));
    const inputRefs = useRef<TextInput[]>([]);

    useEffect(() => {
        let interval: ReturnType<typeof setInterval>;
        if (timer > 0) {
            interval = setInterval(() => setTimer(prev => prev - 1), 1000);
        }
        return () => clearInterval(interval);
    }, [timer]);

    useEffect(() => {
        // Handle external value updates (e.g. from SMS auto-fill)
        if (value && value.length === length) {
            setOtp(value.split('').slice(0, length));
        }
    }, [value, length]);

    // Reset OTP boxes when length changes
    useEffect(() => {
        setOtp(Array(length).fill(''));
    }, [length]);

    const handleTextChange = (text: string, index: number) => {
        const cleaned = text.replace(/[^0-9]/g, '');

        // Handle paste: if pasted text length > 1, fill multiple boxes
        if (cleaned.length > 1) {
            const newOtp = [...otp];
            for (let i = 0; i < length && i < cleaned.length; i++) {
                newOtp[index + i < length ? index + i : length - 1] = cleaned[i];
            }
            setOtp(newOtp);
            const joined = newOtp.join('');
            onChange(joined);
            // Focus last filled box
            const lastIdx = Math.min(index + cleaned.length - 1, length - 1);
            inputRefs.current[lastIdx]?.focus();
            return;
        }

        const newOtp = [...otp];
        newOtp[index] = cleaned[cleaned.length - 1] || '';
        setOtp(newOtp);
        const currentOtp = newOtp.join('');
        onChange(currentOtp);

        // Auto focus next
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

    return (
        <View style={styles.container}>
            <View style={styles.otpRow}>
                {otp.map((digit, i) => (
                    <View
                        key={i}
                        style={[
                            styles.inputBox,
                            digit ? styles.inputFilled : null,
                            error ? styles.inputError : null,
                        ]}
                    >
                        <TextInput
                            ref={el => (inputRefs.current[i] = el as any)}
                            style={styles.input}
                            keyboardType="number-pad"
                            maxLength={length}  // allow paste of full code into first box
                            value={digit}
                            onChangeText={text => handleTextChange(text, i)}
                            onKeyPress={e => handleKeyPress(e, i)}
                            editable={!loading}
                            autoFocus={i === 0}
                            textContentType="oneTimeCode"   // iOS SMS auto-fill
                            selectTextOnFocus
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
        gap: 16,
        alignItems: 'center',
    },
    otpRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        width: '100%',
        gap: 10,
    },
    inputBox: {
        flex: 1,
        height: 60,
        backgroundColor: '#F4F6FB',
        borderRadius: 14,
        borderWidth: 1.5,
        borderColor: '#EAEDF3',
        justifyContent: 'center',
        alignItems: 'center',
    },
    inputFilled: {
        borderColor: '#4B6EF5',
        backgroundColor: '#EEF1FD',
    },
    inputError: {
        borderColor: '#EF4444',
        backgroundColor: '#FEF2F2',
    },
    input: {
        fontSize: 26,
        fontWeight: '700',
        color: '#1A1F36',
        textAlign: 'center',
        width: '100%',
        height: '100%',
    },
    errorText: {
        color: '#EF4444',
        fontSize: 13,
        fontWeight: '500',
        textAlign: 'center',
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
