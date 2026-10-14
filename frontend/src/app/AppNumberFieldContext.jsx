import { useAppNumberFieldContext } from "./appNumberField";
import {
  AppNumberFieldContext,
  appNumberInputProps,
} from "./appNumberField";

export function AppNumberFieldProvider({
  activeField,
  children,
  onActivate,
}) {
  return (
    <AppNumberFieldContext.Provider value={{ activeField, onActivate }}>
      {children}
    </AppNumberFieldContext.Provider>
  );
}

export function AppNumberInput({
  allowNegative = false,
  decimalScale,
  fieldKey,
  inputMode = "decimal",
  label,
  maxLength,
  prefix = "",
  suffix = "",
  ...inputProps
}) {
  const context = useAppNumberFieldContext();
  if (!context) return <input inputMode={inputMode} maxLength={maxLength} {...inputProps} />;
  return (
    <input
      {...inputProps}
      {...appNumberInputProps({
        activeField: context.activeField,
        allowNegative,
        className: inputProps.className,
        decimalScale,
        disabled: inputProps.disabled,
        fieldKey,
        inputMode,
        label,
        maxLength,
        onActivate: context.onActivate,
        prefix,
        suffix,
      })}
      maxLength={maxLength}
    />
  );
}
