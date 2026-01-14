/**
 * Address List Component
 *
 * Displays a list of contract addresses with labels and copy functionality.
 * Addresses are truncated for display with hover tooltip showing full address.
 */

import { For, Show, createSignal } from "solid-js";

/**
 * Address entry with label and address string
 */
export interface AddressEntry {
  label: string;
  address: string;
}

/**
 * Props for the AddressList component
 */
export interface AddressListProps {
  /** List of address entries to display */
  addresses: AddressEntry[];
  /** Optional title for the list */
  title?: string;
}

/**
 * Truncate an address for display
 * Shows first 6 and last 4 characters: 0x1234...abcd
 */
function truncateAddress(address: string): string {
  if (address.length <= 13) {
    return address;
  }
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/**
 * Copy text to clipboard with fallback for non-HTTPS contexts
 * Returns true if copy succeeded, false otherwise
 */
async function copyToClipboard(text: string): Promise<boolean> {
  // Modern clipboard API (requires HTTPS or localhost)
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to fallback
    }
  }

  // Fallback for non-secure contexts (e.g., HTTP in development)
  try {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.position = "fixed";
    textArea.style.left = "-999999px";
    textArea.style.top = "-999999px";
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    const success = document.execCommand("copy");
    document.body.removeChild(textArea);
    return success;
  } catch {
    return false;
  }
}

/**
 * Single address row with copy functionality
 */
function AddressRow(props: { entry: AddressEntry }) {
  const [copied, setCopied] = createSignal(false);

  const handleCopy = async () => {
    const success = await copyToClipboard(props.entry.address);
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div class="flex justify-between items-center text-sm group">
      <span class="text-muted-foreground">{props.entry.label}</span>
      <div class="flex items-center gap-2">
        <span
          class="font-mono cursor-pointer hover:text-primary transition-colors"
          title={props.entry.address}
          onClick={handleCopy}
        >
          {truncateAddress(props.entry.address)}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          class="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-muted rounded text-muted-foreground hover:text-foreground"
          title="Copy address"
        >
          <Show when={copied()} fallback={<CopyIcon />}>
            <CheckIcon />
          </Show>
        </button>
      </div>
    </div>
  );
}

/**
 * Copy icon (clipboard)
 */
function CopyIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </svg>
  );
}

/**
 * Check icon (success indicator)
 */
function CheckIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      class="text-green-500"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

/**
 * AddressList displays a list of contract addresses with copy functionality.
 *
 * Features:
 * - Displays addresses with labels
 * - Truncates long addresses (shows first 6 and last 4 chars)
 * - Hover tooltip shows full address
 * - Click to copy with visual feedback
 * - Copy button appears on hover
 * - Fallback for non-HTTPS contexts (clipboard API limitation)
 *
 * @example
 * ```tsx
 * <AddressList
 *   title="Deployed Contracts"
 *   addresses={[
 *     { label: "Portal (L1)", address: "0x1234...abcd" },
 *     { label: "USDC (L1)", address: "0x5678...efgh" },
 *   ]}
 * />
 * ```
 */
export function AddressList(props: AddressListProps) {
  return (
    <div class="space-y-2">
      <Show when={props.title}>
        <p class="text-sm text-muted-foreground mb-3">{props.title}</p>
      </Show>
      <Show
        when={props.addresses.length > 0}
        fallback={
          <p class="text-sm text-muted-foreground">No addresses to display</p>
        }
      >
        <div class="space-y-2">
          <For each={props.addresses}>
            {(entry) => <AddressRow entry={entry} />}
          </For>
        </div>
      </Show>
    </div>
  );
}
