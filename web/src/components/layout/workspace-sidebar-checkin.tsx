import { App } from "antd";
import { useState } from "react";

import { formatCredits } from "@/constant/credits";
import { useWalletBalance } from "@/hooks/use-wallet-balance";
import { sidebarCheckinTitle, shouldShowSidebarCheckin } from "@/lib/sidebar-checkin";
import { cn } from "@/lib/utils";
import { ApiError } from "@/services/api/request";
import { checkinCredits } from "@/services/api/wallet";
import { useAppearanceStore } from "@/stores/use-appearance-store";
import { useUserStore } from "@/stores/use-user-store";
import { localizedErrorMessage, useLocaleText } from "@/lib/i18n";
import { Coins } from "lucide-react";

export function WorkspaceSidebarCheckin({ collapsed }: { collapsed: boolean }) {
    const { locale, text } = useLocaleText();
    const user = useUserStore((state) => state.user);
    const creditsEnabled = useUserStore((state) => state.features.creditsEnabled);
    const brandName = useAppearanceStore((state) => state.appearance.brandName);
    const { policy, refresh } = useWalletBalance(user?.id, Boolean(user) && creditsEnabled);
    const { message } = App.useApp();
    const [claiming, setClaiming] = useState(false);

    const visible = shouldShowSidebarCheckin({
        creditsEnabled,
        checkinBonusMicrocredits: policy?.checkinBonusMicrocredits,
        checkedInToday: policy?.checkedInToday,
    });
    if (!user || !visible || !policy) return null;

    const amount = formatCredits(policy.checkinBonusMicrocredits, 2);
    const title = locale === "en-US" ? `${brandName} daily bonus` : sidebarCheckinTitle(brandName);
    const summary = text(`${title}，今日可领 ${amount} 积分`, `${title}, claim ${amount} credits today`);

    const claim = async () => {
        if (claiming) return;
        setClaiming(true);
        try {
            await checkinCredits();
            window.dispatchEvent(new CustomEvent("wallet:updated"));
            await refresh();
            message.success(text("签到成功，积分已到账", "Daily credits claimed"));
        } catch (error) {
            const alreadyClaimed = error instanceof ApiError && error.status === 409;
            window.dispatchEvent(new CustomEvent("wallet:updated"));
            await refresh();
            if (alreadyClaimed) return;
            message.error(localizedErrorMessage(error, "领取失败", "Could not claim credits"));
        } finally {
            setClaiming(false);
        }
    };

    if (collapsed) {
        return (
            <button type="button" className="app-workspace-sidebar-checkin is-collapsed" title={summary} aria-label={text(`立即领取今日 ${amount} 积分`, `Claim ${amount} daily credits`)} disabled={claiming} onClick={() => void claim()}>
                {claiming ? "…" : locale === "en-US" ? <Coins className="size-4" /> : "领"}
            </button>
        );
    }

    return (
        <aside className="app-workspace-sidebar-checkin" aria-label={summary}>
            <div className="app-workspace-sidebar-checkin-copy">
                <strong className="app-workspace-sidebar-checkin-title">{title}</strong>
                <span className="app-workspace-sidebar-checkin-offer">
                    {text("今日可领", "Today ")}
                    <em>{amount}</em>
                    {text("积分", " credits")}
                </span>
            </div>
            <button type="button" className={cn("app-workspace-sidebar-checkin-claim", claiming && "is-loading")} disabled={claiming} aria-label={text(`立即领取 ${amount} 积分`, `Claim ${amount} credits`)} onClick={() => void claim()}>
                {claiming ? text("领取中", "Claiming") : text("立即领取", "Claim")}
            </button>
        </aside>
    );
}
