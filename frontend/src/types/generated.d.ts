/**
 * Type declarations for generated Aztec contract artifacts
 *
 * The actual generated files are outside the frontend src directory
 * and have dependencies on @aztec/* sub-paths that TypeScript can't resolve.
 * This declaration provides the necessary types for the frontend.
 */

declare module "@generated/AaveWrapper" {
  import type { AztecAddress as AztecAddressType } from "@aztec/aztec.js";

  export interface AaveWrapperContract {
    readonly address: AztecAddressType;
    methods: {
      request_deposit(
        assetId: unknown,
        amount: bigint,
        deadline: bigint
      ): { send: (options?: { from?: AztecAddressType }) => Promise<unknown> };

      finalize_deposit(
        intentId: unknown,
        shares: bigint
      ): { send: (options?: { from?: AztecAddressType }) => Promise<unknown> };

      request_withdraw(
        intentId: unknown,
        deadline: bigint
      ): { send: (options?: { from?: AztecAddressType }) => Promise<unknown> };

      finalize_withdraw(
        intentId: unknown,
        amount: bigint
      ): { send: (options?: { from?: AztecAddressType }) => Promise<unknown> };

      get_intent_status(intentId: unknown): { view: () => Promise<number> };
    };
  }

  interface DeploymentResult {
    send: (options?: { from?: AztecAddressType }) => DeploymentResult;
    deployed: () => Promise<AaveWrapperContract>;
  }

  export const AaveWrapperContract: {
    deploy(
      wallet: unknown,
      admin: AztecAddressType,
      portalAddress: unknown,
      bridgedTokenAddress: AztecAddressType,
      feeTreasuryAddress: AztecAddressType
    ): DeploymentResult;
    at(address: AztecAddressType, wallet: unknown): AaveWrapperContract;
  };

  export const AaveWrapperContractArtifact: unknown;
}
