import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, Platform, Animated, Dimensions } from 'react-native';
import { CheckCircle, AlertCircle, Info, AlertTriangle } from 'lucide-react-native';
import { useTheme } from './ThemeContext';

const { width } = Dimensions.get('window');

type ToastType = 'success' | 'error' | 'info' | 'warning';

interface Toast {
    id: number;
    message: string;
    type: ToastType;
}

interface ToastContextType {
    showToast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextType>({ showToast: () => { } });

export const useToast = () => useContext(ToastContext);

const ToastItem = ({ toast, onHide }: { toast: Toast, onHide: (id: number) => void }) => {
    const opacity = useRef(new Animated.Value(0)).current;
    const translateY = useRef(new Animated.Value(-20)).current;
    const { theme } = useTheme();
    const useNativeDriver = Platform.OS !== 'web';

    useEffect(() => {
        Animated.parallel([
            Animated.timing(opacity, { toValue: 1, duration: 400, useNativeDriver }),
            Animated.spring(translateY, { toValue: 0, tension: 50, friction: 8, useNativeDriver }),
        ]).start();

        const timer = setTimeout(() => {
            hide();
        }, 3200);

        return () => clearTimeout(timer);
    }, []);

    const hide = () => {
        Animated.parallel([
            Animated.timing(opacity, { toValue: 0, duration: 300, useNativeDriver }),
            Animated.timing(translateY, { toValue: -15, duration: 300, useNativeDriver }),
        ]).start(() => onHide(toast.id));
    };

    const getIconConfig = () => {
        switch (toast.type) {
            case 'success': return { icon: <CheckCircle size={18} color="#1FD45A" />, bg: 'rgba(31, 212, 90, 0.15)' };
            case 'error': return { icon: <AlertCircle size={18} color="#FF4E4E" />, bg: 'rgba(255, 78, 78, 0.15)' };
            case 'warning': return { icon: <AlertTriangle size={18} color="#FCBD0B" />, bg: 'rgba(252, 189, 11, 0.15)' };
            case 'info': return { icon: <Info size={18} color="#4B6EF5" />, bg: 'rgba(75, 110, 245, 0.15)' };
            default: return { icon: <Info size={18} color="#fff" />, bg: 'rgba(255,255,255,0.1)' };
        }
    };

    const config = getIconConfig();

    return (
        <Animated.View style={[
            styles.toast,
            { backgroundColor: theme.mode === 'dark' ? 'rgba(30, 35, 50, 0.95)' : 'rgba(26, 31, 54, 0.95)' },
            { opacity, transform: [{ translateY }] }
        ]}>
            <View style={[styles.iconContainer, { backgroundColor: config.bg }]}>
                {config.icon}
            </View>
            <Text style={styles.text}>{toast.message}</Text>
        </Animated.View>
    );
};

export const ToastProvider = ({ children }: { children: React.ReactNode }) => {
    const [toasts, setToasts] = useState<Toast[]>([]);
    const counter = useRef(0);
    const recentToastRef = useRef<{ message: string; type: ToastType; ts: number } | null>(null);

    const showToast = useCallback((message: string, type: ToastType = 'success') => {
        const normalizedMessage = String(message || '').trim();
        if (!normalizedMessage) return;

        const now = Date.now();
        const recent = recentToastRef.current;
        if (recent && recent.message === normalizedMessage && recent.type === type && now - recent.ts < 1500) {
            return;
        }

        recentToastRef.current = { message: normalizedMessage, type, ts: now };
        const id = ++counter.current;
        setToasts(prev => [...prev, { id, message: normalizedMessage, type }].slice(-3));
    }, []);

    const removeToast = useCallback((id: number) => {
        setToasts(prev => prev.filter(t => t.id !== id));
    }, []);

    return (
        <ToastContext.Provider value={{ showToast }}>
            {children}
            <View style={[styles.container, styles.pointerPassthrough]}>
                {toasts.map(t => (
                    <ToastItem key={t.id} toast={t} onHide={removeToast} />
                ))}
            </View>
        </ToastContext.Provider>
    );
};

const styles = StyleSheet.create({
    container: {
        position: 'absolute',
        top: Platform.OS === 'ios' ? 50 : 35,
        left: 0,
        right: 0,
        alignItems: 'center',
        zIndex: 10000,
        gap: 12,
    },
    pointerPassthrough: {
        pointerEvents: 'none' as any,
    },
    toast: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderRadius: 24,
        alignSelf: 'center',
        minWidth: 200,
        maxWidth: width - 40,
        ...Platform.select({
            web: {
                boxShadow: '0 8px 16px rgba(0, 0, 0, 0.2)',
            },
            default: {
                shadowColor: '#000',
                shadowOpacity: 0.2,
                shadowRadius: 16,
                shadowOffset: { width: 0, height: 8 },
                elevation: 8,
            },
        }),
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.1)'
    },
    iconContainer: {
        marginRight: 12,
        width: 32,
        height: 32,
        borderRadius: 16,
        justifyContent: 'center',
        alignItems: 'center'
    },
    text: {
        flex: 1,
        color: '#FFFFFF',
        fontWeight: '600',
        fontSize: 14,
        letterSpacing: 0.2
    },
});
