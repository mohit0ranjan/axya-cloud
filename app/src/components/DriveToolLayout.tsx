import React from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { ChevronRight, Check, Circle } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../context/ThemeContext";
import { LibraryGlyph, LibraryHeader } from "./LibraryUI";
export function ToolPage({ title, subtitle, navigation, children }: any) {
  const { theme, isDark } = useTheme();
  const c = theme.colors;
  const i = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: c.background, paddingTop: i.top }}>
      <LibraryHeader
        title={title}
        subtitle="YOUR AXYA"
        onBack={() => navigation.goBack()}
      />
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingTop: 6,
          paddingBottom: i.bottom + 40,
          gap: 12,
          width: "100%",
          maxWidth: 680,
          alignSelf: "center",
        }}
      >
        {!!subtitle && (
          <View
            style={{
              backgroundColor: c.primaryLight,
              borderRadius: 28,
              padding: 22,
              flexDirection: "row",
              alignItems: "center",
              gap: 16,
              marginBottom: 10,
            }}
          >
            <LibraryGlyph title={title} size={54} />
            <Text
              style={{
                flex: 1,
                minWidth: 0,
                color: isDark ? "#C4D3E9" : "#405675",
                fontFamily: "Inter_500Medium",
                fontSize: 14,
                lineHeight: 22,
              }}
            >
              {subtitle}
            </Text>
          </View>
        )}
        {children}
      </ScrollView>
    </View>
  );
}
export function ToolRow({
  title,
  detail,
  onPress,
  disabled,
  right,
  selected,
  selectionMode = "multiple",
}: any) {
  const { theme, isDark } = useTheme();
  const c = theme.colors;
  return (
    <Pressable
      accessibilityRole={
        typeof selected === "boolean"
          ? selectionMode === "single"
            ? "radio"
            : "checkbox"
          : onPress
            ? "button"
            : undefined
      }
      accessibilityState={{ disabled: !!disabled, checked: selected }}
      aria-checked={typeof selected === "boolean" ? selected : undefined}
      aria-disabled={!!disabled}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: selected
          ? c.primaryLight
          : pressed
            ? c.surfaceMuted
            : c.card,
        borderRadius: 24,
        padding: 16,
        flexDirection: "row",
        alignItems: "center",
        gap: 14,
        opacity: disabled ? 0.55 : 1,
        minHeight: 86,
      })}
    >
      <LibraryGlyph title={title} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          style={{
            color: c.textHeading,
            fontSize: 15,
            lineHeight: 21,
            fontFamily: "Inter_600SemiBold",
          }}
        >
          {title}
        </Text>
        {!!detail && (
          <Text
            style={{
              color: isDark ? "#A5B0C5" : "#65748B",
              fontSize: 12,
              lineHeight: 19,
              fontFamily: "Inter_400Regular",
              marginTop: 4,
            }}
          >
            {detail}
          </Text>
        )}
      </View>
      {right ||
        (typeof selected === "boolean" ? (
          selected ? (
            <Check color={c.primary} size={20} />
          ) : (
            <Circle color={c.muted} size={20} />
          )
        ) : (
          onPress && <ChevronRight color={c.muted} size={18} />
        ))}
    </Pressable>
  );
}
export function ToolInput(props: any) {
  const { theme, isDark } = useTheme();
  return (
    <TextInput
      accessibilityLabel={props.accessibilityLabel || props.placeholder}
      placeholderTextColor={isDark ? "#A5B0C5" : "#65748B"}
      {...props}
      style={[
        {
          padding: 16,
          borderRadius: 22,
          borderWidth: 1,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.card,
          color: theme.colors.textHeading,
          fontFamily: "Inter_400Regular",
          fontSize: 15,
          minWidth: 0,
          minHeight: 54,
        },
        props.style,
      ]}
    />
  );
}
