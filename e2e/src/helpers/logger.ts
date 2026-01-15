/**
 * E2E Test Logger
 *
 * Provides clear, structured logging for e2e tests so product managers
 * and non-developers can understand the cross-chain flow.
 *
 * Flow: Aztec L2 → Ethereum L1 (Portal + Aave) → L2
 */

const COLORS = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  white: "\x1b[37m",
};

const CHAIN_LABELS = {
  L2: `${COLORS.magenta}[Aztec L2]${COLORS.reset}`,
  L1: `${COLORS.blue}[Ethereum L1]${COLORS.reset}`,
  TARGET: `${COLORS.cyan}[Target Chain]${COLORS.reset}`,
  BRIDGE: `${COLORS.yellow}[Bridge]${COLORS.reset}`,
};

/**
 * Format a value for display (truncate long hex strings)
 */
function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "null";
  const str = String(value);
  if (str.length > 24 && str.startsWith("0x")) {
    return `${str.slice(0, 10)}...${str.slice(-8)}`;
  }
  if (str.length > 24) {
    return `${str.slice(0, 16)}...`;
  }
  return str;
}

/**
 * Format an amount with proper decimals for display
 */
function formatAmount(amount: bigint, decimals: number = 6): string {
  const divisor = BigInt(10 ** decimals);
  const whole = amount / divisor;
  const fraction = amount % divisor;
  const fractionStr = fraction.toString().padStart(decimals, "0").slice(0, 2);
  return `${whole}.${fractionStr}`;
}

/**
 * Test Logger for e2e flows
 */
export const logger = {
  /**
   * Log suite setup information
   */
  suiteSetup(services: { pxe: boolean; l1: boolean; accounts: boolean; contracts: boolean }) {
    console.log();
    console.log(`${COLORS.bright}${"=".repeat(70)}${COLORS.reset}`);
    console.log(`${COLORS.bright}  Aztec Aave Wrapper - E2E Test Suite${COLORS.reset}`);
    console.log(`${COLORS.dim}  Privacy-preserving DeFi: Aztec L2 -> Aave on L1${COLORS.reset}`);
    console.log(`${"=".repeat(70)}`);
    console.log();
    console.log(`${COLORS.bright}Services:${COLORS.reset}`);
    console.log(`  ${services.pxe ? "✓" : "✗"} Aztec PXE (Private Execution Environment)`);
    console.log(`  ${services.l1 ? "✓" : "✗"} Ethereum L1 (Portal + Aave)`);
    console.log(`  ${services.accounts ? "✓" : "✗"} Test accounts created`);
    console.log(`  ${services.contracts ? "✓" : "✗"} Contracts deployed`);
    console.log();
  },

  /**
   * Log a section header
   */
  section(title: string) {
    console.log();
    console.log(`${COLORS.bright}--- ${title} ---${COLORS.reset}`);
  },

  /**
   * Log a step in the cross-chain flow
   */
  step(stepNum: number, description: string) {
    console.log(`  ${COLORS.dim}Step ${stepNum}:${COLORS.reset} ${description}`);
  },

  /**
   * Log L2 (Aztec) operation
   */
  l2(action: string, details?: Record<string, unknown>) {
    console.log(`${CHAIN_LABELS.L2} ${action}`);
    if (details) {
      Object.entries(details).forEach(([key, value]) => {
        console.log(`  ${COLORS.dim}${key}:${COLORS.reset} ${formatValue(value)}`);
      });
    }
  },

  /**
   * Log L1 (Ethereum) operation
   */
  l1(action: string, details?: Record<string, unknown>) {
    console.log(`${CHAIN_LABELS.L1} ${action}`);
    if (details) {
      Object.entries(details).forEach(([key, value]) => {
        console.log(`  ${COLORS.dim}${key}:${COLORS.reset} ${formatValue(value)}`);
      });
    }
  },

  /**
   * Log Target chain operation (used by mock tests)
   */
  target(action: string, details?: Record<string, unknown>) {
    console.log(`${CHAIN_LABELS.TARGET} ${action}`);
    if (details) {
      Object.entries(details).forEach(([key, value]) => {
        console.log(`  ${COLORS.dim}${key}:${COLORS.reset} ${formatValue(value)}`);
      });
    }
  },

  /**
   * Log bridge operation (used by mock tests)
   */
  bridge(action: string, direction: "L1->Target" | "Target->L1") {
    const arrow = direction === "L1->Target" ? "→" : "←";
    console.log(`${CHAIN_LABELS.BRIDGE} ${arrow} ${action}`);
  },

  /**
   * Log a privacy note
   */
  privacy(note: string) {
    console.log(`  ${COLORS.green}🔒 Privacy:${COLORS.reset} ${note}`);
  },

  /**
   * Log deposit flow start
   */
  depositStart(params: { amount: bigint; asset: string; deadline: bigint }) {
    console.log();
    console.log(`${COLORS.bright}${COLORS.green}▶ DEPOSIT FLOW${COLORS.reset}`);
    console.log(
      `  ${COLORS.dim}User deposits assets on Aztec L2, receives yield-bearing position${COLORS.reset}`
    );
    console.log(`  Amount: ${formatAmount(params.amount)} ${params.asset}`);
    console.log(`  Deadline: ${new Date(Number(params.deadline) * 1000).toISOString()}`);
    console.log();
  },

  /**
   * Log deposit flow completion
   */
  depositComplete(intentId: string, shares?: bigint) {
    console.log();
    console.log(`${COLORS.green}✓ Deposit flow completed${COLORS.reset}`);
    console.log(`  Intent ID: ${formatValue(intentId)}`);
    if (shares) {
      console.log(`  Shares received: ${formatAmount(shares)}`);
    }
  },

  /**
   * Log withdrawal flow start
   */
  withdrawStart(params: { amount: bigint; nonce: string; deadline: bigint }) {
    console.log();
    console.log(`${COLORS.bright}${COLORS.yellow}▶ WITHDRAW FLOW${COLORS.reset}`);
    console.log(
      `  ${COLORS.dim}User redeems position on Aztec L2, receives underlying assets${COLORS.reset}`
    );
    console.log(`  Amount: ${formatAmount(params.amount)}`);
    console.log(`  Position nonce: ${formatValue(params.nonce)}`);
    console.log(`  Deadline: ${new Date(Number(params.deadline) * 1000).toISOString()}`);
    console.log();
  },

  /**
   * Log withdrawal flow completion
   */
  withdrawComplete(intentId: string, amount?: bigint) {
    console.log();
    console.log(`${COLORS.green}✓ Withdraw flow completed${COLORS.reset}`);
    console.log(`  Intent ID: ${formatValue(intentId)}`);
    if (amount) {
      console.log(`  Amount received: ${formatAmount(amount)}`);
    }
  },

  /**
   * Log test skip reason
   */
  skip(reason: string) {
    console.log(`${COLORS.dim}⊘ Skipped: ${reason}${COLORS.reset}`);
  },

  /**
   * Log a mock mode notice
   */
  mockMode(note: string) {
    console.log(`  ${COLORS.yellow}[Mock Mode]${COLORS.reset} ${note}`);
  },

  /**
   * Log multi-user operation
   */
  multiUser(userCount: number, action: string) {
    console.log();
    console.log(`${COLORS.bright}👥 Multi-User: ${userCount} users${COLORS.reset} - ${action}`);
  },

  /**
   * Log intent ID generation
   */
  intentIds(ids: string[], allUnique: boolean) {
    console.log(`  Intent IDs generated: ${ids.length}`);
    ids.forEach((id, i) => {
      console.log(`    ${i + 1}. ${formatValue(id)}`);
    });
    console.log(`  ${allUnique ? "✓" : "✗"} All unique: ${allUnique}`);
  },

  /**
   * Log error or expected failure
   */
  expectedFailure(reason: string) {
    console.log(`  ${COLORS.dim}Expected: ${reason}${COLORS.reset}`);
  },

  /**
   * Simple info log
   */
  info(message: string) {
    console.log(`  ${message}`);
  },
};

export default logger;
