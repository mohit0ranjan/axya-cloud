import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { logger } from '../utils/logger';
import { useTheme } from '../context/ThemeContext';

type FallbackProps = {
    error: Error;
    resetError: () => void;
};

type Props = {
    children: React.ReactNode;
    fallback?: React.ReactNode | ((props: FallbackProps) => React.ReactNode);
};

type State = {
    error: Error | null;
};

class ErrorBoundaryCore extends React.Component<Props, State> {
    state: State = { error: null };

    static getDerivedStateFromError(error: Error): State {
        return { error };
    }

    componentDidCatch(error: Error, info: React.ErrorInfo) {
        logger.error('frontend.error_boundary', 'Unhandled render error', {
            name: error.name,
            message: error.message,
            stack: error.stack,
            componentStack: info.componentStack,
        });
    }

    resetError = () => {
        this.setState({ error: null });
    };

    render() {
        if (this.state.error) {
            if (typeof this.props.fallback === 'function') {
                return this.props.fallback({ error: this.state.error, resetError: this.resetError });
            }
            if (this.props.fallback) {
                return this.props.fallback;
            }
            return <DefaultFallback error={this.state.error} resetError={this.resetError} />;
        }
        return this.props.children;
    }
}

const DefaultFallback = ({ error, resetError }: FallbackProps) => {
    const { theme } = useTheme();
    return (
        <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
            <Text style={[styles.title, { color: theme.colors.textHeading }]}>Something went wrong</Text>
            <Text style={[styles.body, { color: theme.colors.textBody }]}>Please reopen this screen.</Text>
            <TouchableOpacity 
                style={[styles.button, { backgroundColor: theme.colors.primary }]} 
                onPress={resetError}
            >
                <Text style={styles.buttonText}>Try Again</Text>
            </TouchableOpacity>
        </View>
    );
};

const styles = StyleSheet.create({
    root: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 24,
    },
    title: {
        fontSize: 20,
        fontWeight: '700',
    },
    body: {
        fontSize: 14,
        marginTop: 10,
        marginBottom: 20,
        textAlign: 'center',
    },
    button: {
        height: 44,
        minWidth: 120,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 16,
    },
    buttonText: {
        color: '#fff',
        fontWeight: '700',
    },
});

export default function AppErrorBoundary(props: Props) {
    return <ErrorBoundaryCore {...props} />;
}
