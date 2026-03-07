import React from 'react';
import { EmptyState } from './EmptyState';

interface ErrorStateProps {
    title?: string;
    message: string;
    onRetry?: () => void;
    retryText?: string;
    style?: any;
}

export function ErrorState({
    title = 'Something went wrong',
    message,
    onRetry,
    retryText = 'Try again',
    style,
}: ErrorStateProps) {
    return (
        <EmptyState
            title={title}
            description={message}
            iconType="error"
            buttonText={onRetry ? retryText : undefined}
            onButtonPress={onRetry}
            style={style}
        />
    );
}

