import {
  enhanceFormNumberInput,
  useAppNumberFieldContext,
} from "../app/appNumberField";

export default function FormField({ label, help, children, wide = false }) {
  const appNumberField = useAppNumberFieldContext();
  return (
    <label className={`form-field${wide ? " wide" : ""}`}>
      <span>{label}</span>
      {enhanceFormNumberInput(children, label, appNumberField)}
      {help ? <small>{help}</small> : null}
    </label>
  );
}
