import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { useTheme } from "../context/ThemeContext";
import {
  FolderOpen,
  AlertCircle,
  WifiOff,
  FileSearch,
  LucideIcon,
} from "lucide-react-native";

interface EmptyStateProps {
  title: string;
  description: string;
  icon?: LucideIcon;
  iconType?: "folder" | "file" | "error" | "network" | "search";
  buttonText?: string;
  onButtonPress?: () => void;
  style?: any;
}

export function EmptyState({
  title,
  description,
  icon: CustomIcon,
  iconType = "folder",
  buttonText,
  onButtonPress,
  style,
}: EmptyStateProps) {
  const { theme } = useTheme();

  // Map types to default icons and colors
  const typeConfig = {
    folder: {
      Icon: FolderOpen,
      color: theme.colors.primary,
      bg: theme.colors.primary + "1A", // 10% opacity
    },
    file: {
      Icon: FileSearch,
      color: theme.colors.primary,
      bg: theme.colors.primary + "1A",
    },
    error: {
      Icon: AlertCircle,
      color: theme.colors.danger,
      bg: theme.colors.danger + "1A",
    },
    network: {
      Icon: WifiOff,
      color: theme.colors.accent,
      bg: theme.colors.accent + "1A",
    },
    search: {
      Icon: FileSearch,
      color: theme.colors.muted,
      bg: theme.colors.border,
    },
  };

  const config = typeConfig[iconType] || typeConfig.folder;
  const Icon = CustomIcon || config.Icon;

  return (
    <View style={[styles.container, style]}>
      <View style={[styles.iconWrapper, { backgroundColor: config.bg }]}>
        <Icon color={config.color} size={36} strokeWidth={1.5} />
      </View>
      <Text style={[styles.title, { color: theme.colors.textHeading }]}>
        {title}
      </Text>
      <Text style={[styles.description, { color: theme.colors.muted }]}>
        {description}
      </Text>

      {buttonText && onButtonPress && (
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={buttonText}
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
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 32,
    paddingVertical: 48,
  },
  iconWrapper: {
    justifyContent: "center",
    alignItems: "center",
    width: 64,
    height: 64,
    borderRadius: 20,
    marginBottom: 18,
  },
  title: {
    fontWeight: "600",
    textAlign: "center",
    marginBottom: 8,
    letterSpacing: -0.3,
    fontSize: 18,
    lineHeight: 25,
    fontFamily: "Inter_600SemiBold",
  },
  description: {
    fontSize: 14,
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 24,
    maxWidth: 300,
    fontFamily: "Inter_400Regular",
  },
  button: {
    paddingHorizontal: 24,
    paddingVertical: 14,
    shadowColor: "#1A1F36",
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 12,
    minHeight: 48,
    borderRadius: 12,
    shadowOpacity: 0,
    elevation: 0,
  },
  buttonText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "600",
    letterSpacing: 0.2,
    fontFamily: "Inter_600SemiBold",
  },
});
