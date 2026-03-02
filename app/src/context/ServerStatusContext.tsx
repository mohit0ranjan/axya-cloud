import React, { createContext, useContext, useState, ReactNode, useEffect } from 'react';

interface ServerStatus {
    isWaking: boolean;
    statusText: string;
}

interface ServerStatusContextType {
    isWaking: boolean;
    statusText: string;
}

const ServerStatusContext = createContext<ServerStatusContextType | undefined>(undefined);

// Bridge for singleton -> React state
export const serverStatusManager = {
    setWaking: (waking: boolean, text?: string) => {
        if (serverStatusManager.listener) {
            serverStatusManager.listener(waking, text);
        }
    },
    listener: null as ((waking: boolean, text?: string) => void) | null,
};

export const ServerStatusProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [status, setStatus] = useState<ServerStatus>({
        isWaking: false,
        statusText: 'Starting server, please wait...',
    });

    useEffect(() => {
        serverStatusManager.listener = (waking, text) => {
            setStatus({ isWaking: waking, statusText: text || 'Starting server, please wait...' });
        };
        return () => { serverStatusManager.listener = null; };
    }, []);

    return (
        <ServerStatusContext.Provider value={{ ...status }}>
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
