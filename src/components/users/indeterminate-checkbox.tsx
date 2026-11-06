"use client";

import { useEffect, useRef, type ComponentProps } from "react";

/**
 * A native checkbox that shows the browser's dash (partial) state. React has no
 * `indeterminate` attribute, so it is set on the DOM node whenever it changes.
 * `checked` stays true only when everything is selected.
 */
export function IndeterminateCheckbox({
  indeterminate,
  checked,
  ...props
}: Omit<ComponentProps<"input">, "type" | "checked"> & {
  indeterminate: boolean;
  checked: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate && !checked;
  }, [indeterminate, checked]);

  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      aria-checked={indeterminate && !checked ? "mixed" : checked}
      {...props}
    />
  );
}
