import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { logger } from '../utils/logger';

type Props = {
    children: React.ReactNode;
};

type State = {
    hasError: boolean;
};

export default class AppErrorBoundary extends React.Component<Props, State> {
    state: State = { hasError: false };

    static getDerivedStateFromError(): State {
        return { hasError: true };
    }

    componentDidCatch(error: Error, info: React.ErrorInfo) {
        logger.error('frontend.error_boundary', 'Unhandled render error', {
            name: error.name,
            message: error.message,
            stack: error.stack,
            componentStack: info.componentStack,
        });
    }

    private handleReload = () => {
        this.setState({ hasError: false });
    };

    render() {
        if (!this.state.hasError) {
            return this.props.children;
        }

        return (
            <View style={styles.root}>
                <Text style={styles.title}>Something went wrong</Text>
                <Text style={styles.body}>Please reopen this screen.</Text>
                <TouchableOpacity style={styles.button} onPress={this.handleReload}>
                    <Text style={styles.buttonText}>Try Again</Text>
                </TouchableOpacity>
            </View>
        );
    }
}

const styles = StyleSheet.create({
    root: {
        flex: 1,
        backgroundColor: '#0A0E1F',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 24,
    },
    title: {
        color: '#FFFFFF',
        fontSize: 20,
        fontWeight: '700',
    },
    body: {
        color: 'rgba(255,255,255,0.7)',
        fontSize: 14,
        marginTop: 10,
        marginBottom: 20,
        textAlign: 'center',
    },
    button: {
        height: 44,
        minWidth: 120,
        borderRadius: 12,
        backgroundColor: '#4B6EF5',
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 16,
    },
    buttonText: {
        color: '#fff',
        fontWeight: '700',
    },
});

