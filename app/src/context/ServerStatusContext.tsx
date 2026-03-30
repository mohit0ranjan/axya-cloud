import React, { createContext, useContext, useState, ReactNode, useEffect } from 'react';
import { serverReadiness, SERVER_WAKE_BANNER_TEXT } from '../services/serverReadiness';

interface ServerStatus {
    isWaking: boolean;
    statusText: string;
    wakeTimedOut: boolean;
}

interface ServerStatusContextType {
    isWaking: boolean;
    statusText: string;
    wakeTimedOut: boolean;
    retryWake: () => void;
}

const ServerStatusContext = createContext<ServerStatusContextType | undefined>(undefined);

// Bridge for singleton -> React state
export const serverStatusManager = {
    setWaking: (waking: boolean, text?: string, timedOut: boolean = false) => {
        if (serverStatusManager.listener) {
            serverStatusManager.listener(waking, text, timedOut);
        }
    },
    listener: null as ((waking: boolean, text?: string, timedOut?: boolean) => void) | null,
};

export const ServerStatusProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [manualStatus, setManualStatus] = useState<ServerStatus>({
        isWaking: false,
        statusText: SERVER_WAKE_BANNER_TEXT,
        wakeTimedOut: false,
    });
    const [status, setStatus] = useState<ServerStatus>({
        isWaking: false,
        statusText: SERVER_WAKE_BANNER_TEXT,
        wakeTimedOut: false,
    });

    useEffect(() => {
        serverStatusManager.listener = (waking, text, timedOut) => {
            setManualStatus({
                isWaking: waking,
                statusText: text || SERVER_WAKE_BANNER_TEXT,
                wakeTimedOut: Boolean(timedOut),
            });
        };
        return () => { serverStatusManager.listener = null; };
    }, []);

    useEffect(() => {
        return serverReadiness.subscribe((readinessState) => {
            if (readinessState.phase === 'ready') {
                setStatus({ ...manualStatus });
                return;
            }

            if (readinessState.phase === 'waking' || readinessState.phase === 'timeout') {
                setStatus({
                    isWaking: true,
                    statusText: readinessState.statusText || SERVER_WAKE_BANNER_TEXT,
                    wakeTimedOut: readinessState.phase === 'timeout',
                });
                return;
            }

            setStatus({ ...manualStatus });
        });
    }, [manualStatus]);

    useEffect(() => {
        if (!serverReadiness.isWakeInProgress()) {
            setStatus({ ...manualStatus });
        }
    }, [manualStatus]);

    const retryWake = () => {
        void serverReadiness.retryWake();
    };

    return (
        <ServerStatusContext.Provider value={{ ...status, retryWake }}>
            {children}
        </ServerStatusContext.Provider>
    );
};

export const useServerStatus = () => {
    const context = useContext(ServerStatusContext);
    if (!context) {
        throw new Error('useServerStatus must be used within a ServerStatusProvider');
    }
    return context;
};
