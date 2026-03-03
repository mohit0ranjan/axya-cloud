import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { FolderOpen, AlertCircle, WifiOff, FileSearch, LucideIcon } from 'lucide-react-native';

interface EmptyStateProps {
    title: string;
    description: string;
    icon?: LucideIcon;
    iconType?: 'folder' | 'file' | 'error' | 'network' | 'search';
    buttonText?: string;
    onButtonPress?: () => void;
    style?: any;
}

export function EmptyState({
    title,
    description,
    icon: CustomIcon,
    iconType = 'folder',
    buttonText,
    onButtonPress,
    style
}: EmptyStateProps) {
    const { theme } = useTheme();

    // Map types to default icons and colors
    const typeConfig = {
        folder: {
            Icon: FolderOpen,
            color: theme.colors.primary,
            bg: theme.colors.primary + '1A', // 10% opacity
        },
        file: {
            Icon: FileSearch,
            color: theme.colors.info,
            bg: theme.colors.info + '1A',
        },
        error: {
            Icon: AlertCircle,
            color: theme.colors.danger,
            bg: theme.colors.danger + '1A',
        },
        network: {
            Icon: WifiOff,
            color: theme.colors.warning,
            bg: theme.colors.warning + '1A',
        },
        search: {
            Icon: FileSearch,
            color: theme.colors.neutral[500],
            bg: theme.colors.neutral[200],
        }
    };

    const config = typeConfig[iconType] || typeConfig.folder;
    const Icon = CustomIcon || config.Icon;

    return (
        <View style={[styles.container, style]}>
            <View style={[styles.iconWrapper, { backgroundColor: config.bg }]}>
                <Icon color={config.color} size={36} strokeWidth={1.5} />
            </View>
            <Text style={[styles.title, { color: theme.colors.neutral[900] }]}>{title}</Text>
            <Text style={[styles.description, { color: theme.colors.neutral[500] }]}>{description}</Text>

            {buttonText && onButtonPress && (
                <TouchableOpacity
                    style={[styles.button, { backgroundColor: theme.colors.primary }]}
                    activeOpacity={0.8}
                    onPress={onButtonPress}
                >
                    <Text style={styles.buttonText}>{buttonText}</Text>
                </TouchableOpacity>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 32,
        paddingVertical: 48,
    },
    iconWrapper: {
        width: 80,
        height: 80,
        borderRadius: 24,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 24,
    },
    title: {
        fontSize: 18,
        fontWeight: '700',
        textAlign: 'center',
        marginBottom: 8,
        letterSpacing: -0.3,
    },
    description: {
        fontSize: 14,
        textAlign: 'center',
        lineHeight: 22,
        marginBottom: 24,
    },
    button: {
        paddingHorizontal: 24,
        paddingVertical: 14,
        borderRadius: 16,
        shadowColor: '#1A1F36',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.1,
        shadowRadius: 12,
        elevation: 2,
    },
    buttonText: {
        color: '#FFFFFF',
        fontSize: 15,
        fontWeight: '600',
        letterSpacing: 0.2,
    }
});
