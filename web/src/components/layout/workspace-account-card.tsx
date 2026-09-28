import { Button } from "antd";
import { ArrowUpRight, Coins, LogOut, RefreshCw, Settings, ShieldCheck } from "lucide-react";
import { Link } from "react-router";
import { useWalletBalance } from "@/hooks/use-wallet-balance";
import { useWorkspaceLogout } from "@/hooks/use-workspace-logout";
import { useUserStore } from "@/stores/use-user-store";
import { UserAvatar } from "./user-avatar";
import { LanguageSwitcher } from "./language-switcher";
import { useLocaleText } from "@/lib/i18n";
import "./workspace-account-card.css";

/** 同一账户卡片用于顶部和侧栏；余额与退出均复用真实服务。 */
export function WorkspaceAccountCard({ onWallet, onNavigate }: { onWallet: () => void; onNavigate: () => void }) {
    const { locale, text } = useLocaleText();
    const user = useUserStore((state) => state.user);
    const creditsEnabled = useUserStore((state) => state.features.creditsEnabled);
    const { availableMicrocredits, refreshing, refresh } = useWalletBalance(user?.id, creditsEnabled);
    const { handleLogout, loggingOut } = useWorkspaceLogout();
    if (!user) return null;
    return <section className="workspace-account-card" aria-label={text("我的账户", "My account")}>
        <header className="workspace-account-card-identity">
            <UserAvatar user={user} className="workspace-account-card-avatar" />
            <div><strong>{user.displayName || user.username}</strong><span>@{user.username}</span></div>
            <em>{user.role === "admin" ? text("管理员", "Admin") : text("创作者", "Creator")}</em>
        </header>
        {creditsEnabled ? <div className="workspace-account-card-wallet">
            <div className="workspace-account-card-balance"><span><Coins />{text("可用积分", "Available credits")}</span><strong>{availableMicrocredits === null ? "—" : (availableMicrocredits / 1_000_000).toLocaleString(locale, { maximumFractionDigits: 2 })}</strong></div>
            {availableMicrocredits === null ? <Button size="small" loading={refreshing} icon={<RefreshCw />} onClick={() => void refresh()}>{text("刷新余额", "Refresh")}</Button> : <button type="button" onClick={onWallet}>{text("充值 / 兑换", "Top up / redeem")}<ArrowUpRight /></button>}
        </div> : null}
        <nav className="workspace-account-card-actions" aria-label={text("账户操作", "Account actions")}>
            <Link to="/settings" onClick={onNavigate}><Settings /><span>{text("账户与设置", "Account & settings")}</span><ArrowUpRight /></Link>
            {user.role === "admin" ? <Link to="/admin" onClick={onNavigate}><ShieldCheck /><span>{text("管理员后台", "Admin console")}</span><ArrowUpRight /></Link> : null}
            <LanguageSwitcher className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm text-foreground/70 hover:text-foreground" />
            <Button danger type="text" icon={<LogOut />} loading={loggingOut} onClick={() => void handleLogout()}>{text("退出登录", "Sign out")}</Button>
        </nav>
    </section>;
}
