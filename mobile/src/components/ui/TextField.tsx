import { forwardRef, useState, type ReactNode } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import { noOutline, radius, spacing, useColors } from '@/theme';
import { Icon } from './Icon';
import { Text } from './Text';
import { Touchable } from './Touchable';

export type TextFieldProps = TextInputProps & {
  label?: string;
  error?: string | null;
  hint?: string;
  /** pole hasła: pokazuje oko do odkrywania wpisanego tekstu */
  secret?: boolean;
  right?: ReactNode;
};

export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField(
  { label, error, hint, secret, right, multiline, style, onFocus, onBlur, ...rest },
  ref
) {
  const c = useColors();
  const [focused, setFocused] = useState(false);
  const [shown, setShown] = useState(false);
  return (
    <View style={styles.wrap}>
      {label ? (
        <Text variant="subhead" color="secondary" bold style={styles.label}>
          {label}
        </Text>
      ) : null}
      <View
        style={[
          styles.box,
          { backgroundColor: c.bgSecondary, borderColor: error ? c.danger : focused ? c.textSecondary : c.border },
          multiline ? styles.boxMulti : null,
        ]}
      >
        <TextInput
          ref={ref}
          {...rest}
          multiline={multiline}
          secureTextEntry={secret && !shown}
          placeholderTextColor={c.textSecondary}
          accessibilityLabel={rest.accessibilityLabel ?? label}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          style={[styles.input, { color: c.text }, multiline ? styles.inputMulti : null, noOutline, style]}
        />
        {secret ? (
          <Touchable onPress={() => setShown((v) => !v)} accessibilityLabel={shown ? 'Ukryj hasło' : 'Pokaż hasło'} style={styles.eye}>
            <Icon name={shown ? 'eye-off-outline' : 'eye-outline'} size={20} color={c.textSecondary} />
          </Touchable>
        ) : null}
        {right}
      </View>
      {error ? (
        <Text variant="footnote" color="danger" style={styles.msg}>
          {error}
        </Text>
      ) : hint ? (
        <Text variant="footnote" color="secondary" style={styles.msg}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  label: { marginLeft: 2 },
  box: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: radius.m, paddingHorizontal: spacing.m, minHeight: 46 },
  boxMulti: { alignItems: 'flex-start', paddingVertical: 4 },
  input: { flex: 1, fontSize: 16, paddingVertical: 10 },
  inputMulti: { minHeight: 84, textAlignVertical: 'top' },
  eye: { paddingLeft: 8, paddingVertical: 8 },
  msg: { marginLeft: 2 },
});
