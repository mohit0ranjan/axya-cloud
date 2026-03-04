import React, { createContext, useState, useEffect, ReactNode, useContext } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import apiClient from '../services/apiClient';

interface AuthContextType {
    isAuthenticated: boolean;
    isLoading: boolean;
    user: any;
    token: string | null;
    setUser: (user: any) => void;
    login: (token: string, userData?: any) => Promise<void>;
    logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
    const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [user, setUser] = useState<any>(null);
    const [token, setToken] = useState<string | null>(null);

    useEffect(() => {
        const bootstrapAsync = async () => {
            try {
                const userToken = await AsyncStorage.getItem('jwtToken');
                if (userToken) {
                    setToken(userToken);
                    // Use apiClient which has built-in retry logic
                    try {
                        const res = await apiClient.get('/auth/me');
                        if (res.data && res.data.success && res.data.user) {
                            setUser(res.data.user);
                            setIsAuthenticated(true);
                        } else {
                            throw new Error('Invalid token');
                        }
                    } catch (e: any) {
                        const status = e?.response?.status;
                        console.warn('[Auth] Token verification failed:', e);
                        // Keep session on transient network/server failures.
                        // Only clear auth on explicit unauthorized responses.
                        if (status === 401 || status === 403) {
                            await logout();
                        } else {
                            setIsAuthenticated(true);
                        }
                    }
                }
            } catch (e) {
                console.error("Auth Load Error:", e);
            } finally {
                setIsLoading(false);
            }
        };
        bootstrapAsync();
    }, []);

    const login = async (newToken: string, userData?: any) => {
        setToken(newToken);
        await AsyncStorage.setItem('jwtToken', newToken);
        if (userData) setUser(userData);
        setIsAuthenticated(true);
    };

    const logout = async () => {
        await AsyncStorage.removeItem('jwtToken');
        setToken(null);
        setUser(null);
        setIsAuthenticated(false);
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

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (!context) throw new Error('useAuth must be used within AuthProvider');
    return context;
};
