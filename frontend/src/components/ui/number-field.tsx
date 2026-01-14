import { type JSX, splitProps, createSignal, createEffect } from "solid-js";
import { cn } from "~/lib/utils";

export interface NumberFieldProps {
  value?: number;
  onChange?: (value: number | undefined) => void;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  disabled?: boolean;
  class?: string;
  id?: string;
  name?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  showButtons?: boolean;
}

export function NumberField(props: NumberFieldProps) {
  const [local, others] = splitProps(props, [
    "value",
    "onChange",
    "min",
    "max",
    "step",
    "placeholder",
    "disabled",
    "class",
    "id",
    "name",
    "aria-label",
    "aria-labelledby",
    "aria-describedby",
    "showButtons",
  ]);

  const [inputValue, setInputValue] = createSignal(
    local.value !== undefined ? String(local.value) : ""
  );

  // Sync internal state with external value prop
  createEffect(() => {
    const val = local.value;
    if (val !== undefined) {
      setInputValue(String(val));
    } else {
      setInputValue("");
    }
  });

  const step = () => local.step ?? 1;
  const min = () => local.min;
  const max = () => local.max;

  const clampValue = (val: number): number => {
    let clamped = val;
    const minVal = min();
    const maxVal = max();
    if (minVal !== undefined && clamped < minVal) clamped = minVal;
    if (maxVal !== undefined && clamped > maxVal) clamped = maxVal;
    return clamped;
  };

  const parseValue = (str: string): number | undefined => {
    if (str === "" || str === "-") return undefined;
    const num = parseFloat(str);
    return isNaN(num) ? undefined : num;
  };

  const handleInput: JSX.EventHandler<HTMLInputElement, InputEvent> = (e) => {
    const raw = e.currentTarget.value;
    // Allow typing negative numbers and decimals
    if (/^-?\d*\.?\d*$/.test(raw) || raw === "") {
      setInputValue(raw);
      const parsed = parseValue(raw);
      if (parsed !== undefined) {
        local.onChange?.(clampValue(parsed));
      } else {
        local.onChange?.(undefined);
      }
    }
  };

  const handleBlur = () => {
    const parsed = parseValue(inputValue());
    if (parsed !== undefined) {
      const clamped = clampValue(parsed);
      setInputValue(String(clamped));
      local.onChange?.(clamped);
    } else {
      setInputValue("");
      local.onChange?.(undefined);
    }
  };

  const increment = () => {
    const current = parseValue(inputValue()) ?? min() ?? 0;
    const newValue = clampValue(current + step());
    setInputValue(String(newValue));
    local.onChange?.(newValue);
  };

  const decrement = () => {
    const current = parseValue(inputValue()) ?? min() ?? 0;
    const newValue = clampValue(current - step());
    setInputValue(String(newValue));
    local.onChange?.(newValue);
  };

  const handleKeyDown: JSX.EventHandler<HTMLInputElement, KeyboardEvent> = (e) => {
    switch (e.key) {
      case "ArrowUp":
        e.preventDefault();
        increment();
        break;
      case "ArrowDown":
        e.preventDefault();
        decrement();
        break;
    }
  };

  const showButtons = () => local.showButtons ?? true;

  return (
    <div class={cn("relative flex", local.class)}>
      {showButtons() && (
        <button
          type="button"
          tabIndex={-1}
          disabled={local.disabled || (min() !== undefined && (parseValue(inputValue()) ?? 0) <= min()!)}
          class={cn(
            "flex h-10 w-10 items-center justify-center rounded-l-md border border-r-0 border-input bg-background text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
          )}
          onClick={decrement}
          aria-label="Decrease value"
        >
          <svg
            class="h-4 w-4"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      )}

      <input
        type="text"
        inputMode="decimal"
        id={local.id}
        name={local.name}
        value={inputValue()}
        placeholder={local.placeholder}
        disabled={local.disabled}
        aria-label={local["aria-label"]}
        aria-labelledby={local["aria-labelledby"]}
        aria-describedby={local["aria-describedby"]}
        aria-valuemin={local.min}
        aria-valuemax={local.max}
        aria-valuenow={parseValue(inputValue())}
        role="spinbutton"
        class={cn(
          "flex h-10 w-full bg-background px-3 py-2 text-sm text-center ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
          showButtons()
            ? "border-y border-input"
            : "rounded-md border border-input"
        )}
        onInput={handleInput}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
      />

      {showButtons() && (
        <button
          type="button"
          tabIndex={-1}
          disabled={local.disabled || (max() !== undefined && (parseValue(inputValue()) ?? 0) >= max()!)}
          class={cn(
            "flex h-10 w-10 items-center justify-center rounded-r-md border border-l-0 border-input bg-background text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
          )}
          onClick={increment}
          aria-label="Increase value"
        >
          <svg
            class="h-4 w-4"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      )}
    </div>
  );
}
