import { describe, expect, test } from "bun:test";
import { formatCredits } from "../src/constant/credits";
import { topupProductValue } from "../src/components/layout/workspace-wallet-topup";
import { formatPaymentAmount, type TopupProduct } from "../src/services/api/payments";

const product: TopupProduct = {
    id: "credits",
    name: "积分包",
    kind: "credits",
    amountFen: 9900,
    currency: "CNY",
    creditsMicrocredits: 50_000_000,
    storageBytes: 0,
    storageDurationDays: 0,
    enabled: true,
    sortOrder: 0,
    saleStrategy: "unlimited",
    canPurchase: true,
    createdBy: "admin",
    updatedBy: "admin",
    createdAt: "2026-10-01",
    updatedAt: "2026-10-01",
};

describe("wallet credit and product display", () => {
    test.each([
        [5_000_000, "5"],
        [2_500_000, "2.5"],
        [1, "0.000001"],
        [0, "0"],
        [-1_250_000, "-1.25"],
    ])("formats %i microcredits without losing billing precision", (value, expected) => {
        expect(formatCredits(value as number)).toBe(expected as string);
    });

    test("displays server configured purchase price and credited amount independently", () => {
        expect(formatPaymentAmount(product.amountFen, product.currency)).toBe("¥99.00");
        expect(topupProductValue(product)).toBe("50 积分");
        expect(formatPaymentAmount(1250, "USD")).toBe("$12.50");
        expect(topupProductValue({ ...product, creditsMicrocredits: 2_500_001 })).toBe("2.500001 积分");
    });
});
