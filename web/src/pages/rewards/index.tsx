import { App, Button, Input, Skeleton } from "antd";
import { ArrowUpRight, Check, Gift, Share2, Sparkles, Star, TicketCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";

import { WorkspacePage, PageHeader } from "@/components/layout/workspace-page";
import { localizedErrorMessage, useLocaleText } from "@/lib/i18n";
import { openWorkspaceWallet } from "@/lib/workspace-wallet";
import { listTopupProducts, type TopupProduct } from "@/services/api/payments";
import { claimTaskReward, findMembershipProduct, getRewards, redeemMembershipCode, type GenerationTaskReward, type RewardsSummary } from "@/services/api/rewards";
import { useUserStore } from "@/stores/use-user-store";
import "./rewards.css";

export function formatRewardCredits(microcredits: number) {
    const value = microcredits / 1_000_000;
    return `${Number.isInteger(value) ? value : value.toFixed(6).replace(/0+$/, "")} 积分`;
}

export function membershipProductCopy(product: Pick<TopupProduct, "amountFen" | "bonusCreditsMicrocredits" | "membershipDays">) {
    return {
        price: `¥${(product.amountFen / 100).toFixed(0)}`,
        bonus: `送 ${formatRewardCredits(product.bonusCreditsMicrocredits ?? 0)}`,
        duration: `${product.membershipDays ?? 0} 天`,
    };
}

export default function RewardsPage() {
    const { message } = App.useApp();
    const { locale, text } = useLocaleText();
    const navigate = useNavigate();
    const taskCenterEnabled = useUserStore((state) => state.features.taskCenterEnabled);
    const [summary, setSummary] = useState<RewardsSummary | null>(null);
    const [product, setProduct] = useState<TopupProduct | null>(null);
    const [code, setCode] = useState("");
    const [loading, setLoading] = useState(true);
    const [actingId, setActingId] = useState("");
    const claiming = useRef(false);
    const [redeeming, setRedeeming] = useState(false);
    const membershipActive = Boolean(summary?.membership.expiresAt && new Date(summary.membership.expiresAt).getTime() > Date.now());

    const load = async () => {
        setLoading(true);
        try {
            const [rewardResult, products] = await Promise.all([getRewards(), listTopupProducts()]);
            setSummary(rewardResult);
            setProduct(findMembershipProduct(products.products) ?? null);
        } catch (error) {
            message.error(localizedErrorMessage(error, "成长计划加载失败", "Could not load the growth plan", locale));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void load();
    }, []);

    const successfulTasks = summary?.generationTasks ?? [];
    const pendingTaskCount = successfulTasks.filter((task) => !task.claimed).length;
    const copy = product ? membershipProductCopy(product) : null;

    const claimTask = async (task: GenerationTaskReward) => {
        if (task.claimed || claiming.current) return;
        claiming.current = true;
        setActingId(task.id);
        try {
            const result = await claimTaskReward(task.id);
            setSummary((current) => current ? {
                ...current,
                account: result.account,
                generationTasks: current.generationTasks.map((item) => item.id === task.id ? { ...item, claimed: true } : item),
            } : current);
            if (result.granted) message.success(text("1 积分已到账", "1 credit added"));
            else message.info(text("这个任务已经领取过奖励", "This task reward was already claimed"));
            window.dispatchEvent(new CustomEvent("wallet:updated"));
        } catch (error) {
            message.error(localizedErrorMessage(error, "领取任务奖励失败", "Could not claim task reward", locale));
        } finally {
            claiming.current = false;
            setActingId("");
        }
    };

    const redeem = async () => {
        const normalized = code.trim().replace(/\s/g, "");
        if (!normalized) return;
        setRedeeming(true);
        try {
            await redeemMembershipCode(normalized);
            setCode("");
            message.success(text("会员已兑换，赠送积分已到账", "Membership redeemed and bonus credits added"));
            await load();
            window.dispatchEvent(new CustomEvent("wallet:updated"));
        } catch (error) {
            message.error(localizedErrorMessage(error, "会员兑换失败", "Could not redeem membership", locale));
        } finally {
            setRedeeming(false);
        }
    };

    return (
        <WorkspacePage className="rewards-page">
            <PageHeader title={text("成长计划", "Growth plan")} description={text("完成创作、分享作品，持续获得积分和会员权益。", "Create, share, and keep earning credits and membership benefits.")} />
            {loading && !summary ? (
                <Skeleton active paragraph={{ rows: 12 }} />
            ) : summary ? (
                <div className="rewards-shell">
                    <section className="rewards-overview">
                        <div className="rewards-overview-copy">
                            <span className="rewards-eyebrow">
                                <Sparkles />
                                {text("WORKBENCH REWARDS", "WORKBENCH REWARDS")}
                            </span>
                            <h2>{text("让每一次创作都有回报", "Make every creation count")}</h2>
                            <p>{text("积分可用于抵扣模型生成费用，会员权益会在支付或兑换成功后立即生效。", "Credits offset generation costs. Membership starts as soon as payment or redemption is confirmed.")}</p>
                        </div>
                        <div className="rewards-balance">
                            <span>{text("可用积分", "Available credits")}</span>
                            <strong>{formatRewardCredits(summary.account.availableMicrocredits)}</strong>
                            <small>
                                {membershipActive
                                    ? text(`会员有效期至 ${new Date(summary.membership.expiresAt).toLocaleDateString(locale)}`, `Member until ${new Date(summary.membership.expiresAt).toLocaleDateString(locale)}`)
                                    : text("当前未开通会员", "No active membership")}
                            </small>
                        </div>
                    </section>

                    <section className="rewards-grid">
                        <article className="rewards-card rewards-card-task">
                            <div className="rewards-card-top">
                                <div className="rewards-card-icon">
                                    <Gift />
                                </div>
                                <Link className="rewards-create-link" to="/create">
                                    {successfulTasks.length && !pendingTaskCount ? text("继续创作", "Keep creating") : text("去创作", "Start creating")}
                                    <ArrowUpRight aria-hidden="true" />
                                </Link>
                            </div>
                            <div className="rewards-card-heading">
                                <div>
                                    <span className="rewards-card-kicker">{text("做任务赚积分", "CREATE TO EARN")}</span>
                                    <h3>{text("完成创作任务", "Complete a creation task")}</h3>
                                </div>
                                <strong>+1</strong>
                            </div>
                            <p>{text("每次成功生成可领取 1 积分，每条任务限领一次。", "Earn 1 credit for each successful generation. Each task can be claimed once.")}</p>
                            <small className="rewards-task-cost">{text("生成费用按所选模型计费。", "Generation is charged at the selected model's rates.")}</small>
                            <p className="rewards-task-status" role="status">
                                {pendingTaskCount
                                    ? text(`有 ${pendingTaskCount} 项奖励待领取`, pendingTaskCount === 1 ? "1 reward ready to claim" : `${pendingTaskCount} rewards ready to claim`)
                                    : successfulTasks.length
                                        ? text("当前奖励已全部领取", "All current rewards have been claimed")
                                        : text("完成第一次创作，成功后可领取 1 积分", "Complete your first creation to earn 1 credit after a successful generation")}
                            </p>
                            {successfulTasks.length ? (
                                <div className="rewards-task-list">
                                    {successfulTasks.map((task) => {
                                        const title = task.prompt?.trim() || text("已完成任务", "Completed task");
                                        return (
                                            <div className="rewards-task-row" key={task.id}>
                                                <Check aria-hidden="true" />
                                                {taskCenterEnabled ? (
                                                    <Link className="rewards-task-title" to={`/tasks?taskId=${encodeURIComponent(task.id)}`} title={title} aria-label={text(`查看任务：${title}`, `View task: ${title}`)}>
                                                        {title}
                                                    </Link>
                                                ) : <span className="rewards-task-title" title={title}>{title}</span>}
                                                <Button size="small" disabled={task.claimed || Boolean(actingId)} loading={actingId === task.id} onClick={() => void claimTask(task)}>
                                                    {task.claimed ? text("已领取", "Claimed") : text("领取 1 积分", "Claim 1 credit")}
                                                </Button>
                                            </div>
                                        );
                                    })}
                                </div>
                            ) : null}
                        </article>
                        <article className="rewards-card rewards-card-share">
                            <div className="rewards-card-icon">
                                <Share2 />
                            </div>
                            <div className="rewards-card-heading">
                                <div>
                                    <span className="rewards-card-kicker">{text("分享赚积分", "SHARE TO EARN")}</span>
                                    <h3>{text("分享公开作品", "Share a public work")}</h3>
                                </div>
                                <strong>+2</strong>
                            </div>
                            <p>{text("每天分享一个公开画布即可获得 2 积分，每个分享记录每天最多领取一次。", "Share a public canvas each day to earn 2 credits. Each share can be claimed once per day.")}</p>
                            <Button onClick={() => navigate("/canvas")}>{summary.shareClaimedToday ? text("继续分享作品", "Share another work") : text("去画布分享", "Share from canvas")}</Button>
                        </article>
                    </section>

                    <section className="rewards-membership">
                        <div className="rewards-membership-copy">
                            <span className="rewards-card-kicker">
                                <Star />
                                {text("年度会员", "ANNUAL MEMBERSHIP")}
                            </span>
                            <h2>{product?.name || text("年会员", "Annual membership")}</h2>
                            <p>{product?.description || text("会员权益由平台配置，支付后立即生效。", "Membership benefits are configured by the platform and start immediately after payment.")}</p>
                            {copy ? (
                                <div className="rewards-membership-facts">
                                    <strong>{copy.price}</strong>
                                    <span>{copy.duration}</span>
                                    <span>{copy.bonus}</span>
                                </div>
                            ) : (
                                <span className="rewards-muted">{text("当前暂无可购买的会员商品", "No membership product is available")}</span>
                            )}
                        </div>
                        <div className="rewards-membership-actions">
                            {product ? (
                                <Button type="primary" size="large" onClick={() => openWorkspaceWallet({ productId: product.id })}>
                                    {text("开通会员", "Get membership")}
                                </Button>
                            ) : null}
                            <div className="rewards-code-entry">
                                <Input value={code} onChange={(event) => setCode(event.target.value)} onPressEnter={() => void redeem()} prefix={<TicketCheck />} placeholder={text("输入会员兑换码", "Enter membership code")} />
                                <Button loading={redeeming} disabled={!code.trim()} onClick={() => void redeem()}>
                                    {text("兑换", "Redeem")}
                                </Button>
                            </div>
                        </div>
                    </section>
                </div>
            ) : null}
        </WorkspacePage>
    );
}
