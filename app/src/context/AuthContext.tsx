import React, { createContext, useState, useEffect, ReactNode } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_BASE } from '../api/client';

interface AuthContextType {
    isAuthenticated: boolean;
    isLoading: boolean;
    user: any;
    token: string | null;
    setUser: (user: any) => void;
    login: (token: string, userData?: any) => Promise<void>;
    logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextType>({
    isAuthenticated: false,
    isLoading: true,
    user: null,
    token: null,
    setUser: () => { },
    login: async () => { },
    logout: async () => { },
});

export const AuthProvider = ({ children }: { children: ReactNode }) => {
    const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [user, setUser] = useState<any>(null);
    const [token, setToken] = useState<string | null>(null);

    // Check for stored token dynamically on launch
    useEffect(() => {
        const bootstrapAsync = async () => {
            let userToken;
            try {
                userToken = await AsyncStorage.getItem('jwtToken');
                if (Platform.OS === 'web' && !userToken) {
                    userToken = localStorage.getItem('jwtToken');
                }
                if (userToken) {
                    setToken(userToken);
                    // Pre-verify token & fetch user identity here ONCE
                    try {
                        const res = await fetch(`${API_BASE}/auth/me`, {
                            headers: { Authorization: `Bearer ${userToken}` }
                        });
                        const data = await res.json();
                        if (data.success && data.user) {
                            setUser(data.user);
                            setIsAuthenticated(true);
                        } else {
                            // invalid token
                            setToken(null);
                            await AsyncStorage.removeItem('jwtToken');
                            if (Platform.OS === 'web') localStorage.removeItem('jwtToken');
                        }
                    } catch (e) {
                        // Network error on load - still admit user with cached session to persist state offline
                        setIsAuthenticated(true);
                    }
                }
            } catch (e) {
                console.error("AsyncStorage Auth Load Error:", e);
                if (Platform.OS === 'web') {
                    localStorage.removeItem('jwtToken');
                }
            }
            setIsLoading(false);
        };

        bootstrapAsync();
    }, []);

    const login = async (newToken: string, userData?: any) => {
        try {
            setToken(newToken);
            await AsyncStorage.setItem('jwtToken', newToken);
            if (Platform.OS === 'web') localStorage.setItem('jwtToken', newToken);
            if (userData) setUser(userData);
            setIsAuthenticated(true);
        } catch (error) {
            console.error("Error storing token:", error);
            if (Platform.OS === 'web') localStorage.setItem('jwtToken', newToken);
            setIsAuthenticated(true);
        }
    };

    const logout = async () => {
        try {
            await AsyncStorage.removeItem('jwtToken');
            if (Platform.OS === 'web') localStorage.removeItem('jwtToken');
            setUser(null);
            setIsAuthenticated(false);
        } catch (error) {
            console.error("Error clearing token:", error);
            if (Platform.OS === 'web') localStorage.removeItem('jwtToken');
            setUser(null);
            setIsAuthenticated(false);
        }
    };

    return (
        <AuthContext.Provider value={{
            isAuthenticated,
            isLoading,
            user,
            token,
            setUser,
            login,
            logout
        }}>
            {children}
        </AuthContext.Provider>
    );
};
