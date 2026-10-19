import { describe, expect, test } from "bun:test";

import { formatRewardCredits, membershipProductCopy } from "@/pages/rewards";

describe("成长计划展示", () => {
    test("formats reward credits without exposing microcredit units", () => {
        expect(formatRewardCredits(5_000_000)).toBe("5 积分");
        expect(formatRewardCredits(2_500_000)).toBe("2.5 积分");
    });

    test("uses server configured membership price and benefits", () => {
        expect(membershipProductCopy({ amountFen: 9900, bonusCreditsMicrocredits: 50_000_000, membershipDays: 365 })).toEqual({ price: "¥99", bonus: "送 50 积分", duration: "365 天" });
    });
});
