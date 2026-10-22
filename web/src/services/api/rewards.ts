import { http } from "@/services/api/request";
import type { CreditAccount } from "@/services/api/wallet";
import type { TopupProduct } from "@/services/api/payments";

export type RewardTask = {
    id: string;
    name: string;
    description: string;
    amountMicrocredits: number;
};

export type Membership = {
    userId: string;
    plan: string;
    startsAt: string;
    expiresAt: string;
    sourceType?: string;
};

export type GenerationTaskReward = {
    id: string;
    prompt: string;
    category: "image" | "video" | "text" | "canvas";
    claimed: boolean;
};

export type RewardsSummary = {
    account: CreditAccount;
    membership: Membership;
    tasks: RewardTask[];
    generationTasks: GenerationTaskReward[];
    shareRewardMicrocredits: number;
    shareClaimedToday: boolean;
};

export function getRewards() {
    return http.get<RewardsSummary>("/rewards");
}

export function claimTaskReward(taskId: string) {
    return http.post<{ account: CreditAccount; granted: boolean }>(`/rewards/tasks/${encodeURIComponent(taskId)}/claim`);
}

export function claimShareReward(shareId: string) {
    return http.post<{ account: CreditAccount; granted: boolean }>(`/rewards/shares/${encodeURIComponent(shareId)}/claim`);
}

export function getMembership() {
    return http.get<{ membership: Membership }>("/membership");
}

export function redeemMembershipCode(code: string) {
    return http.post<{ account: CreditAccount; membership: Membership; redeemed: boolean }>("/membership/redeem", { code });
}

export function findMembershipProduct(products: TopupProduct[]) {
    return products.find((product) => product.productType === "membership" && product.enabled && product.canPurchase);
}
