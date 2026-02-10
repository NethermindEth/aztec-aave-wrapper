/**
 * Network Selector Component
 *
 * Dropdown to switch between local and devnet networks.
 * Network change triggers a page reload to reconnect with new configuration.
 */

import { createSignal, For, Show } from "solid-js";
import {
  getAvailableNetworks,
  getCurrentNetworkId,
  type NetworkId,
  setCurrentNetwork,
} from "../services/network.js";

/**
 * Network icon based on network type
 */
function NetworkIcon(props: { networkId: NetworkId }) {
  return (
    <Show
      when={props.networkId === "local"}
      fallback={
        // Globe icon for devnet
        <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10" />
          <path d="M2 12h20" />
          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
        </svg>
      }
    >
      {/* Laptop icon for local */}
      <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
        <path d="M2 20h20" />
      </svg>
    </Show>
  );
}

/**
 * NetworkSelector dropdown component
 */
export function NetworkSelector() {
  const [isOpen, setIsOpen] = createSignal(false);
  const [currentId, setCurrentId] = createSignal<NetworkId>(getCurrentNetworkId());
  const networks = getAvailableNetworks();

  const currentNetwork = () => networks.find((n) => n.id === currentId());

  const handleSelect = (networkId: NetworkId) => {
    if (networkId === currentId()) {
      setIsOpen(false);
      return;
    }

    setCurrentNetwork(networkId);
    setCurrentId(networkId);
    setIsOpen(false);

    // Reload page to reconnect with new network configuration
    window.location.reload();
  };

  return (
    <div
      class="network-selector relative"
      onClick={(e) => e.stopPropagation()}
      onMouseLeave={() => setIsOpen(false)}
    >
      {/* Current network button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen())}
        class="flex items-center gap-1.5 px-2 py-1 rounded text-[10px] bg-zinc-800/50 hover:bg-zinc-700/50 border border-zinc-700/50 transition-colors"
        title="Switch network"
      >
        <NetworkIcon networkId={currentId()} />
        <span class="text-zinc-300 uppercase tracking-wider">{currentNetwork()?.name}</span>
        <svg
          class={`w-2.5 h-2.5 text-zinc-500 transition-transform ${isOpen() ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          stroke-width="2"
        >
          <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown menu */}
      <Show when={isOpen()}>
        <div class="absolute top-full left-0 mt-1 z-50 min-w-[140px] bg-zinc-900 border border-zinc-700 rounded shadow-lg overflow-hidden">
          <For each={networks}>
            {(network) => (
              <button
                type="button"
                onClick={() => handleSelect(network.id)}
                class={`w-full flex items-center gap-2 px-3 py-2 text-[11px] text-left hover:bg-zinc-800 transition-colors ${
                  network.id === currentId() ? "bg-zinc-800/50 text-emerald-400" : "text-zinc-300"
                }`}
              >
                <NetworkIcon networkId={network.id} />
                <div class="flex flex-col">
                  <span class="font-medium">{network.name}</span>
                  <span class="text-[9px] text-zinc-500">{network.l1.chainName}</span>
                </div>
                <Show when={network.id === currentId()}>
                  <svg
                    class="w-3 h-3 ml-auto text-emerald-400"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    stroke-width="2"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </Show>
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
