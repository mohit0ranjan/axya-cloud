import React, { useState, useRef, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Animated,
  Platform,
} from "react-native";
import { useTheme } from "../context/ThemeContext";

interface PhoneInputFieldProps {
  value: string;
  onChangeText: (text: string) => void;
  error?: string;
  editable?: boolean;
  autoFocus?: boolean;
  onSubmitEditing?: () => void;
}

export default function PhoneInputField({
  value,
  onChangeText,
  error,
  editable = true,
  autoFocus = false,
  onSubmitEditing,
}: PhoneInputFieldProps) {
  const { theme, isDark } = useTheme();
  const C = theme.colors;
  const styles = React.useMemo(() => createStyles(C, isDark), [C, isDark]);

  const [isFocused, setIsFocused] = useState(false);
  const borderAnim = useRef(new Animated.Value(0)).current;
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (!autoFocus || !editable) return;
    // Slight delay gives the bottom sheet animation time to finish before popping keyboard
    const t = setTimeout(() => inputRef.current?.focus(), 400);
    return () => clearTimeout(t);
  }, [autoFocus, editable]);

  useEffect(() => {
    Animated.timing(borderAnim, {
      toValue: isFocused ? 1 : 0,
      duration: 250,
      useNativeDriver: false, // Color interpolation cannot use native driver
    }).start();
  }, [isFocused]);

  const handleChange = (text: string) => {
    const cleaned = text.replace(/[^0-9+]/g, "").replace(/(?!^)\+/g, "");
    if (cleaned.length <= 16) {
      onChangeText(cleaned);
    }
  };

  const borderColor = error
    ? C.danger || "#EF4444"
    : borderAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [C.border || "#CBD5E1", C.primary || "#4B6EF5"],
      });

  return (
    <View style={styles.container}>
      <Text style={styles.label}>Phone number</Text>
      <Animated.View
        style={[
          styles.inputContainer,
          {
            borderColor: borderColor as any,
            borderWidth: isFocused ? 1.5 : 1,
          },
        ]}
      >
        <TextInput
          ref={inputRef}
          style={[
            styles.input,
            Platform.OS === "web" && ({ outlineStyle: "none" } as any),
          ]}
          accessibilityLabel="Phone number including country code"
          placeholder="+91 98765 43210"
          placeholderTextColor={C.muted}
          keyboardType="phone-pad"
          autoComplete="tel"
          textContentType="telephoneNumber"
          autoCorrect={false}
          autoCapitalize="none"
          spellCheck={false}
          value={value}
          onChangeText={handleChange}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          editable={editable}
          maxLength={16}
          returnKeyType="done"
          onSubmitEditing={onSubmitEditing}
          selectionColor={C.primary || "#4B6EF5"}
        />
      </Animated.View>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  );
}

const createStyles = (C: any, isDark: boolean) =>
  StyleSheet.create({
    container: {
      width: "100%",
      marginBottom: 8,
    },
    inputContainer: {
      flexDirection: "row",
      alignItems: "center",
      minHeight: 56,
      paddingHorizontal: 14,
      borderRadius: 12,
      backgroundColor: C.inputBg || C.background,
      overflow: "hidden",
    },
    label: {
      fontSize: 13,
      fontWeight: "500",
      color: C.textBody,
      marginBottom: 8,
      fontFamily: "Inter_500Medium",
    },
    input: {
      flex: 1,
      minWidth: 0,
      width: 0,
      fontSize: 18,
      color: C.textHeading,
      fontWeight: "500",
      letterSpacing: 0,
      height: 48,
      padding: 0,
      margin: 0,
      borderWidth: 0,
      fontFamily: "Inter_500Medium",
    },
    errorText: {
      color: C.danger || "#EF4444",
      fontSize: 13,
      fontWeight: "500",
      marginTop: 8,
      fontFamily: "Inter_500Medium",
    },
  });
