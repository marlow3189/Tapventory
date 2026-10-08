// Pole tekstowe: białe, zaokrąglone, tekst 17 pt — jak formularze systemowe iOS.
// Etykieta nad polem (footnote, wersaliki) i miejsce na komunikat błędu.

import { StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { colors, radius, spacing, touchTarget, typography } from '../../theme/tokens';

type Props = TextInputProps & {
  label?: string;
  error?: string;
};

export function TextField({ label, error, style, ...inputProps }: Props) {
  return (
    <View style={styles.wrap}>
      {label ? <Text style={styles.label}>{label.toUpperCase()}</Text> : null}
      <TextInput
        placeholderTextColor={colors.tertiaryLabel}
        style={[styles.input, error ? styles.inputError : null, style]}
        {...inputProps}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: spacing.m },
  label: {
    ...typography.footnote,
    color: colors.secondaryLabel,
    marginBottom: spacing.xs,
    marginLeft: spacing.xs,
  },
  input: {
    minHeight: touchTarget,
    backgroundColor: colors.cellBackground,
    borderRadius: radius.s,
    paddingHorizontal: spacing.m,
    ...typography.body,
    color: colors.label,
  },
  inputError: { borderWidth: 1, borderColor: colors.red },
  error: { ...typography.footnote, color: colors.red, marginTop: spacing.xs, marginLeft: spacing.xs },
});
