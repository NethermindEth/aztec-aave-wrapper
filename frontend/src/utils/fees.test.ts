import { describe, expect, it } from "vitest";
import {
  calculateFee,
  calculateGrossFromNet,
  calculateNetAmount,
  formatTokenAmount,
  getFeePercentage,
  parseTokenAmount,
  validateMinDeposit,
} from "./fees.js";

describe("calculateFee", () => {
  it("calculates 0.1% fee correctly", () => {
    // 1000 USDC = 1_000_000_000 base units (6 decimals)
    const amount = 1_000_000_000n;
    const fee = calculateFee(amount);
    // 0.1% of 1000 USDC = 1 USDC = 1_000_000 base units
    expect(fee).toBe(1_000_000n);
  });

  it("returns zero fee for zero amount", () => {
    expect(calculateFee(0n)).toBe(0n);
  });

  it("handles small amounts correctly", () => {
    // 1 USDC = 1_000_000 base units
    const amount = 1_000_000n;
    const fee = calculateFee(amount);
    // 0.1% of 1 USDC = 0.001 USDC = 1000 base units
    expect(fee).toBe(1000n);
  });

  it("handles amounts that result in truncated fees", () => {
    // 100 base units -> 0.1% = 0.1 base units, truncates to 0
    expect(calculateFee(100n)).toBe(0n);

    // 10000 base units -> 0.1% = 10 base units
    expect(calculateFee(10000n)).toBe(10n);
  });

  it("handles very large amounts (max uint128 range)", () => {
    // Large amount within uint128 range
    const maxUint128 = 2n ** 128n - 1n;
    const fee = calculateFee(maxUint128);
    // Fee should be 0.1% = amount * 10 / 10000
    expect(fee).toBe((maxUint128 * 10n) / 10000n);
  });

  it("throws error for negative amount", () => {
    expect(() => calculateFee(-1n)).toThrow("Amount cannot be negative");
  });
});

describe("calculateNetAmount", () => {
  it("calculates net amount after fee deduction", () => {
    // 1000 USDC, 0.1% fee = 1 USDC fee
    const amount = 1_000_000_000n;
    const net = calculateNetAmount(amount);
    // Net = 1000 - 1 = 999 USDC = 999_000_000 base units
    expect(net).toBe(999_000_000n);
  });

  it("returns zero for zero amount", () => {
    expect(calculateNetAmount(0n)).toBe(0n);
  });

  it("returns full amount when fee truncates to zero", () => {
    // Very small amount where fee rounds down to 0
    expect(calculateNetAmount(100n)).toBe(100n);
  });

  it("throws error for negative amount", () => {
    expect(() => calculateNetAmount(-1n)).toThrow("Amount cannot be negative");
  });
});

describe("validateMinDeposit", () => {
  it("validates amount above minimum", () => {
    // 2 USDC = 2_000_000 base units (min is 1 USDC = 1_000_000)
    const result = validateMinDeposit(2_000_000n, 6);
    expect(result.isValid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("validates amount equal to minimum", () => {
    // Exactly 1 USDC = 1_000_000 base units
    const result = validateMinDeposit(1_000_000n, 6);
    expect(result.isValid).toBe(true);
  });

  it("rejects amount below minimum", () => {
    // 0.5 USDC = 500_000 base units (below 1 USDC minimum)
    const result = validateMinDeposit(500_000n, 6);
    expect(result.isValid).toBe(false);
    expect(result.error).toBe("Minimum deposit is 1 tokens");
  });

  it("rejects zero amount", () => {
    const result = validateMinDeposit(0n, 6);
    expect(result.isValid).toBe(false);
    expect(result.error).toBe("Minimum deposit is 1 tokens");
  });

  it("rejects negative amount", () => {
    const result = validateMinDeposit(-1n, 6);
    expect(result.isValid).toBe(false);
    expect(result.error).toBe("Amount cannot be negative");
  });

  it("works with different decimal configurations", () => {
    // 18 decimals (like ETH) - minimum is 1 token = 10^18 base units
    const result18 = validateMinDeposit(1n * 10n ** 18n, 18);
    expect(result18.isValid).toBe(true);

    // Below minimum with 18 decimals (0.5 tokens)
    const result18Below = validateMinDeposit(5n * 10n ** 17n, 18);
    expect(result18Below.isValid).toBe(false);
  });

  it("uses default 6 decimals when not specified", () => {
    // 1 USDC = 1_000_000 base units with default 6 decimals
    const result = validateMinDeposit(1_000_000n);
    expect(result.isValid).toBe(true);
  });
});

describe("calculateGrossFromNet", () => {
  it("calculates gross amount to achieve desired net", () => {
    // Want 999 USDC net, need slightly more gross
    const net = 999_000_000n;
    const gross = calculateGrossFromNet(net);

    // Verify: calculateNetAmount(gross) should be >= net
    const actualNet = calculateNetAmount(gross);
    expect(actualNet).toBeGreaterThanOrEqual(net);
  });

  it("returns zero for zero net amount", () => {
    expect(calculateGrossFromNet(0n)).toBe(0n);
  });

  it("rounds up to ensure net amount is achieved", () => {
    // Test that we always get at least the requested net amount
    const testAmounts = [1_000_000n, 999_999n, 1_234_567n, 100_000_000n];

    for (const net of testAmounts) {
      const gross = calculateGrossFromNet(net);
      const actualNet = calculateNetAmount(gross);
      expect(actualNet).toBeGreaterThanOrEqual(net);
    }
  });

  it("throws error for negative amount", () => {
    expect(() => calculateGrossFromNet(-1n)).toThrow("Amount cannot be negative");
  });
});

describe("getFeePercentage", () => {
  it("returns formatted fee percentage", () => {
    const percentage = getFeePercentage();
    expect(percentage).toBe("0.1%");
  });
});

describe("formatTokenAmount", () => {
  it("formats whole numbers without decimals", () => {
    // 100 USDC = 100_000_000 base units
    expect(formatTokenAmount(100_000_000n, 6)).toBe("100");
  });

  it("formats amounts with fractional parts", () => {
    // 100.5 USDC
    expect(formatTokenAmount(100_500_000n, 6)).toBe("100.5");

    // 100.25 USDC
    expect(formatTokenAmount(100_250_000n, 6)).toBe("100.25");
  });

  it("trims trailing zeros in fractional part", () => {
    // 100.10 USDC -> should display as 100.1
    expect(formatTokenAmount(100_100_000n, 6)).toBe("100.1");
  });

  it("respects maxDisplayDecimals parameter", () => {
    // 100.123456 USDC with max 2 decimals -> 100.12
    expect(formatTokenAmount(100_123_456n, 6, 2)).toBe("100.12");

    // With max 4 decimals -> 100.1234
    expect(formatTokenAmount(100_123_456n, 6, 4)).toBe("100.1234");
  });

  it("handles zero amount", () => {
    expect(formatTokenAmount(0n, 6)).toBe("0");
  });

  it("handles very small amounts", () => {
    // 0.01 USDC
    expect(formatTokenAmount(10_000n, 6)).toBe("0.01");

    // 0.000001 USDC (1 base unit)
    expect(formatTokenAmount(1n, 6, 6)).toBe("0.000001");
  });

  it("handles different decimal configurations", () => {
    // 1 ETH with 18 decimals
    expect(formatTokenAmount(10n ** 18n, 18)).toBe("1");

    // 1.5 ETH
    expect(formatTokenAmount(15n * 10n ** 17n, 18)).toBe("1.5");
  });

  it("returns whole number when maxDisplayDecimals is 0", () => {
    expect(formatTokenAmount(100_500_000n, 6, 0)).toBe("100");
  });
});

describe("parseTokenAmount", () => {
  it("parses whole numbers", () => {
    expect(parseTokenAmount("100", 6)).toBe(100_000_000n);
  });

  it("parses decimal amounts", () => {
    expect(parseTokenAmount("100.5", 6)).toBe(100_500_000n);
    expect(parseTokenAmount("100.25", 6)).toBe(100_250_000n);
  });

  it("handles leading/trailing whitespace", () => {
    expect(parseTokenAmount("  100  ", 6)).toBe(100_000_000n);
  });

  it("returns zero for empty string", () => {
    expect(parseTokenAmount("", 6)).toBe(0n);
  });

  it("returns zero for just a dot", () => {
    expect(parseTokenAmount(".", 6)).toBe(0n);
  });

  it("truncates excess decimal places", () => {
    // 100.1234567 with 6 decimals -> truncates to 100.123456
    expect(parseTokenAmount("100.1234567", 6)).toBe(100_123_456n);
  });

  it("pads insufficient decimal places", () => {
    // 100.1 with 6 decimals -> pads to 100.100000
    expect(parseTokenAmount("100.1", 6)).toBe(100_100_000n);
  });

  it("handles negative amounts", () => {
    expect(parseTokenAmount("-100", 6)).toBe(-100_000_000n);
    expect(parseTokenAmount("-100.5", 6)).toBe(-100_500_000n);
  });

  it("throws error for invalid format", () => {
    expect(() => parseTokenAmount("abc", 6)).toThrow("Invalid amount format");
    expect(() => parseTokenAmount("100.5.5", 6)).toThrow("Invalid amount format");
    expect(() => parseTokenAmount("$100", 6)).toThrow("Invalid amount format");
  });

  it("handles amounts with leading zeros", () => {
    expect(parseTokenAmount("0.01", 6)).toBe(10_000n);
    expect(parseTokenAmount("00100", 6)).toBe(100_000_000n);
  });

  it("handles different decimal configurations", () => {
    // 18 decimals (ETH)
    expect(parseTokenAmount("1", 18)).toBe(10n ** 18n);
    expect(parseTokenAmount("1.5", 18)).toBe(15n * 10n ** 17n);
  });

  it("uses default 6 decimals when not specified", () => {
    expect(parseTokenAmount("100")).toBe(100_000_000n);
  });
});

describe("edge cases", () => {
  it("handles maximum uint128 value in calculations", () => {
    const maxUint128 = 2n ** 128n - 1n;

    // These should not throw or overflow
    const fee = calculateFee(maxUint128);
    expect(fee).toBeGreaterThan(0n);

    const net = calculateNetAmount(maxUint128);
    expect(net).toBeLessThan(maxUint128);
    expect(net).toBe(maxUint128 - fee);
  });

  it("maintains mathematical consistency between fee functions", () => {
    const testAmounts = [1_000_000n, 100_000_000n, 1_000_000_000n, 999_999_999n];

    for (const amount of testAmounts) {
      const fee = calculateFee(amount);
      const net = calculateNetAmount(amount);

      // Net + Fee should equal original amount
      expect(net + fee).toBe(amount);
    }
  });

  it("parseTokenAmount and formatTokenAmount are inverse operations", () => {
    const testAmounts = ["100", "100.5", "0.01", "1234.56"];

    for (const amountStr of testAmounts) {
      const parsed = parseTokenAmount(amountStr, 6);
      const formatted = formatTokenAmount(parsed, 6, 2);
      const reparsed = parseTokenAmount(formatted, 6);
      expect(reparsed).toBe(parsed);
    }
  });
});
