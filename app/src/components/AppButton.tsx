import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../context/ThemeContext';

type Variant = 'primary' | 'secondary' | 'danger';
type Size = 'sm' | 'md' | 'lg';

type Props = {
  label: string;
  onPress: () => void;
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  icon?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
};

const HEIGHT_BY_SIZE: Record<Size, number> = {
  sm: 40,
  md: 44,
  lg: 50,
};

export default function AppButton({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  fullWidth = false,
  icon,
  style,
}: Props) {
  const { theme } = useTheme();
  const isDisabled = disabled || loading;
  const height = HEIGHT_BY_SIZE[size];

  const variantStyle =
    variant === 'secondary'
      ? { backgroundColor: theme.colors.background, borderWidth: 1, borderColor: theme.colors.border }
      : variant === 'danger'
        ? { backgroundColor: theme.colors.danger }
        : { backgroundColor: theme.colors.primary };

  const textColor = variant === 'secondary' ? theme.colors.textHeading : '#fff';

  return (
    <Pressable
      accessibilityRole="button"
      disabled={isDisabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        { minHeight: 44, height, opacity: pressed && !isDisabled ? 0.88 : 1 },
        variantStyle,
        fullWidth && styles.fullWidth,
        isDisabled && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={textColor} size="small" />
      ) : (
        <View style={styles.content}>
          {icon}
          <Text style={[styles.text, { color: textColor }]}>{label}</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullWidth: {
    width: '100%',
  },
  disabled: {
    opacity: 0.6,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  text: {
    fontSize: 14,
    fontWeight: '600',
  },
});
