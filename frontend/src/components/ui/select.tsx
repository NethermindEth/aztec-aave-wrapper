import { createEffect, createSignal, For, type JSX, onCleanup, Show, splitProps } from "solid-js";
import { cn } from "~/lib/utils";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps {
  options: SelectOption[];
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  class?: string;
  id?: string;
  name?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
}

export function Select(props: SelectProps) {
  const [local] = splitProps(props, [
    "options",
    "value",
    "onChange",
    "placeholder",
    "disabled",
    "class",
    "id",
    "name",
    "aria-label",
    "aria-labelledby",
  ]);

  const [isOpen, setIsOpen] = createSignal(false);
  const [highlightedIndex, setHighlightedIndex] = createSignal(-1);
  let triggerRef: HTMLButtonElement | undefined;
  let listboxRef: HTMLUListElement | undefined;

  const selectedOption = () => local.options.find((opt) => opt.value === local.value);

  const handleSelect = (value: string) => {
    local.onChange?.(value);
    setIsOpen(false);
    triggerRef?.focus();
  };

  const handleKeyDown: JSX.EventHandler<HTMLButtonElement, KeyboardEvent> = (e) => {
    switch (e.key) {
      case "Enter":
      case " ":
        e.preventDefault();
        if (isOpen()) {
          const highlighted = local.options[highlightedIndex()];
          if (highlighted && !highlighted.disabled) {
            handleSelect(highlighted.value);
          }
        } else {
          setIsOpen(true);
        }
        break;
      case "ArrowDown":
        e.preventDefault();
        if (!isOpen()) {
          setIsOpen(true);
        } else {
          setHighlightedIndex((prev) => {
            const next = prev + 1;
            return next >= local.options.length ? 0 : next;
          });
        }
        break;
      case "ArrowUp":
        e.preventDefault();
        if (!isOpen()) {
          setIsOpen(true);
        } else {
          setHighlightedIndex((prev) => {
            const next = prev - 1;
            return next < 0 ? local.options.length - 1 : next;
          });
        }
        break;
      case "Escape":
        e.preventDefault();
        setIsOpen(false);
        break;
      case "Tab":
        setIsOpen(false);
        break;
    }
  };

  // Close on outside click
  createEffect(() => {
    if (isOpen()) {
      const handleClickOutside = (e: MouseEvent) => {
        if (
          triggerRef &&
          !triggerRef.contains(e.target as Node) &&
          listboxRef &&
          !listboxRef.contains(e.target as Node)
        ) {
          setIsOpen(false);
        }
      };
      document.addEventListener("mousedown", handleClickOutside);
      onCleanup(() => document.removeEventListener("mousedown", handleClickOutside));
    }
  });

  // Reset highlighted index when opening
  createEffect(() => {
    if (isOpen()) {
      const currentIndex = local.options.findIndex((opt) => opt.value === local.value);
      setHighlightedIndex(currentIndex >= 0 ? currentIndex : 0);
    }
  });

  return (
    <div class={cn("relative", local.class)}>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-expanded={isOpen()}
        aria-haspopup="listbox"
        aria-controls={local.id ? `${local.id}-listbox` : undefined}
        aria-label={local["aria-label"]}
        aria-labelledby={local["aria-labelledby"]}
        disabled={local.disabled}
        id={local.id}
        class={cn(
          "flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
          isOpen() && "ring-2 ring-ring ring-offset-2"
        )}
        onClick={() => !local.disabled && setIsOpen(!isOpen())}
        onKeyDown={handleKeyDown}
      >
        <span class={cn(!selectedOption() && "text-muted-foreground")}>
          {selectedOption()?.label ?? local.placeholder ?? "Select..."}
        </span>
        <svg
          class={cn("h-4 w-4 opacity-50 transition-transform", isOpen() && "rotate-180")}
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      <Show when={isOpen()}>
        <ul
          ref={listboxRef}
          role="listbox"
          id={local.id ? `${local.id}-listbox` : undefined}
          aria-activedescendant={
            highlightedIndex() >= 0
              ? `${local.id ?? "select"}-option-${highlightedIndex()}`
              : undefined
          }
          class="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
        >
          <For each={local.options}>
            {(option, index) => (
              <li
                id={`${local.id ?? "select"}-option-${index()}`}
                role="option"
                aria-selected={option.value === local.value}
                aria-disabled={option.disabled}
                class={cn(
                  "relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 px-2 text-sm outline-none",
                  option.value === local.value && "bg-accent text-accent-foreground",
                  highlightedIndex() === index() && "bg-accent text-accent-foreground",
                  option.disabled && "pointer-events-none opacity-50",
                  !option.disabled && "cursor-pointer hover:bg-accent hover:text-accent-foreground"
                )}
                onClick={() => !option.disabled && handleSelect(option.value)}
                onMouseEnter={() => setHighlightedIndex(index())}
              >
                {option.label}
                <Show when={option.value === local.value}>
                  <svg
                    class="ml-auto h-4 w-4"
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </Show>
              </li>
            )}
          </For>
        </ul>
      </Show>

      {/* Hidden native select for form submission */}
      <Show when={local.name}>
        <select
          name={local.name}
          value={local.value}
          class="sr-only"
          tabIndex={-1}
          aria-hidden="true"
        >
          <For each={local.options}>
            {(option) => <option value={option.value}>{option.label}</option>}
          </For>
        </select>
      </Show>
    </div>
  );
}
