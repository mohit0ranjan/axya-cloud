import React, {
  createContext,
  useState,
  useEffect,
  ReactNode,
  useContext,
} from "react";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { uploadManager } from "../services/UploadManager";
import { downloadManager } from "../services/DownloadManager";
import { useApiCacheStore } from "./ApiCacheStore";
import apiClient from "../services/apiClient";
import {
  setSecureValue,
  getSecureValue,
  deleteSecureValue,
  SECURE_KEYS,
} from "../utils/secureStorage";

interface AuthContextType {
  isAuthenticated: boolean;
  isLoading: boolean;
  user: any;
  token: string | null;
  setUser: (user: any) => void;
  login: (token: string, userData?: any) => Promise<void>;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextType | undefined>(
  undefined,
);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [user, setUser] = useState<any>(null);
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    const bootstrapAsync = async () => {
      try {
        // Use secure storage for JWT token
        const userToken = await getSecureValue(SECURE_KEYS.JWT_TOKEN);
        if (userToken) {
          setToken(userToken);
          // Use apiClient which has built-in retry logic
          try {
            const res = await apiClient.get("/auth/me");
            if (res.data && res.data.success && res.data.user) {
              if (Platform.OS === "web") await apiClient.post("/auth/browser-session", {}, { withCredentials: true });
              await uploadManager.bindOwner(res.data.user.id);
              downloadManager.bindOwner(res.data.user.id);
              setUser(res.data.user);
              await setSecureValue('axya_cached_user', JSON.stringify(res.data.user));
              setIsAuthenticated(true);
            } else {
              throw new Error("Invalid token");
            }
          } catch (e: any) {
            const status = e?.response?.status;
            console.warn("[Auth] Token verification failed:", e);
            // Keep session on transient network/server failures.
            // Only clear auth on explicit unauthorized responses.
            if (status === 401 || status === 403) {
              await logout();
            } else {
              const cached = await getSecureValue('axya_cached_user');
              const remembered = cached ? JSON.parse(cached) : null;
              if (remembered?.id) {
                setUser(remembered); setIsAuthenticated(true);
                await uploadManager.bindOwner(remembered.id); downloadManager.bindOwner(remembered.id);
              } else { setUser(null); setIsAuthenticated(false); }
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
    // Stop old-account requests while their original credentials are still active.
    await uploadManager.bindOwner(null);
    downloadManager.bindOwner(null);
    useApiCacheStore.getState().clearCache();
    setToken(newToken);
    // Store JWT in secure storage (keychain/keystore on native)
    await setSecureValue(SECURE_KEYS.JWT_TOKEN, newToken);
    if (Platform.OS === "web") await apiClient.post("/auth/browser-session", {}, { withCredentials: true });
    if (userData) {
      await uploadManager.bindOwner(userData.id);
      downloadManager.bindOwner(userData.id);
      setUser(userData);
      await setSecureValue('axya_cached_user', JSON.stringify(userData));
    }
    setIsAuthenticated(true);
  };

  const logout = async () => {
    if (Platform.OS === "web") {
      try { await apiClient.post("/auth/logout", {}, { withCredentials: true }); }
      catch { /* Local logout still cancels transfers when offline. */ }
    }
    useApiCacheStore.getState().clearCache();
    await uploadManager.bindOwner(null);
    downloadManager.bindOwner(null);
    // Remove JWT from secure storage
    await deleteSecureValue(SECURE_KEYS.JWT_TOKEN);
    await deleteSecureValue('axya_cached_user');
    setToken(null);
    setUser(null);
    setIsAuthenticated(false);
  };

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated,
        isLoading,
        user,
        token,
        setUser,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
};
