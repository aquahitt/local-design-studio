import { createContext, useContext, useEffect, useId, useState } from "react";
export const PendingNumbers = createContext<
  (id: string, pending: boolean) => void
>(() => {});
export function Numeric({
  label,
  value,
  onChange,
  disabled,
  min,
  max,
  step = "any",
}: {
  label: string;
  value: number;
  onChange: (next: number) => void;
  disabled: boolean;
  min?: number;
  max?: number;
  step?: string | number;
}) {
  const id = useId();
  const report = useContext(PendingNumbers);
  const [raw, setRaw] = useState(String(value));
  const [pending, setPending] = useState(false);
  useEffect(() => {
    setRaw(String(value));
    setPending(false);
  }, [value]);
  useEffect(() => {
    report(id, pending);
    return () => report(id, false);
  }, [id, pending, report]);
  return (
    <label>
      {label}
      <input
        type="text"
        inputMode="decimal"
        aria-label={label}
        aria-invalid={pending || undefined}
        value={raw}
        disabled={disabled}
        onChange={(e) => {
          const next = e.target.value;
          setRaw(next);
          const complete = next.trim() !== "" && Number.isFinite(Number(next));
          setPending(!complete);
          if (complete) onChange(Number(next));
        }}
      />
    </label>
  );
}
