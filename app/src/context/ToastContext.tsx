import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';

type ToastType = 'success' | 'error' | 'info';

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

export const ToastProvider = ({ children }: { children: React.ReactNode }) => {
    const [toasts, setToasts] = useState<Toast[]>([]);
    const counter = useRef(0);

    const showToast = useCallback((message: string, type: ToastType = 'success') => {
        const id = ++counter.current;
        setToasts(prev => [...prev, { id, message, type }]);
        setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3200);
    }, []);

    return (
        <ToastContext.Provider value={{ showToast }}>
            {children}
            {/* pointerEvents moved to style to avoid deprecation warning */}
            <View style={styles.container}>
                {toasts.map(t => (
                    <View key={t.id} style={[styles.toast, styles[t.type]]}>
                        <Text style={styles.text}>
                            {t.type === 'success' ? '✅ ' : t.type === 'error' ? '❌ ' : 'ℹ️ '}
                            {t.message}
                        </Text>
                    </View>
                ))}
            </View>
        </ToastContext.Provider>
    );
};

const styles = StyleSheet.create({
    container: {
        position: 'absolute',
        bottom: 110,
        left: 16,
        right: 16,
        zIndex: 9999,
        gap: 8,
        // pointerEvents: 'none' moved to inline style on the component
        ...Platform.select({
            web: {
                // Use boxShadow for web (avoids shadow* deprecation warning)
                boxShadow: 'none',
                pointerEvents: 'none' as any,
            },
            default: {},
        }),
    },
    toast: {
        paddingHorizontal: 18,
        paddingVertical: 14,
        borderRadius: 16,
        // Use platform-specific shadow
        ...Platform.select({
            web: {
                boxShadow: '0px 4px 14px rgba(0, 0, 0, 0.18)',
            },
            default: {
                shadowColor: '#000',
                shadowOpacity: 0.18,
                shadowRadius: 14,
                shadowOffset: { width: 0, height: 4 },
                elevation: 10,
            },
        }),
    },
    success: { backgroundColor: '#1A8C4E' },
    error: { backgroundColor: '#C0392B' },
    info: { backgroundColor: '#2563EB' },
    text: { color: '#fff', fontWeight: '600', fontSize: 14, lineHeight: 20 },
});
