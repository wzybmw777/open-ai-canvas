import { App, Button, Input, Skeleton } from "antd";
import { Check, ChevronLeft, ChevronRight, CircleAlert, Coins, CreditCard, History, RefreshCw, Store, TicketCheck, WalletCards } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";

import { PaymentCheckoutCode } from "@/components/payment-checkout-code";
import { AppModal } from "@/components/ui/product/app-modal";
import { formatCredits } from "@/constant/credits";
import { closePaymentOrder, createPaymentOrder, getExternalTopupShop, getPaymentOrder, listPaymentProviders, listTopupProducts, queryPaymentOrder, refreshPaymentCheckout, type ExternalTopupShop, type PaymentOrder, type PaymentProvider, type TopupProduct } from "@/services/api/payments";
import { getWallet, redeemCredits, type CreditLedgerEntry, type WalletSummary } from "@/services/api/wallet";
import { cn } from "@/lib/utils";
import { openWorkspaceWallet, WORKSPACE_WALLET_OPEN_EVENT, type WorkspaceWalletOpenDetail } from "@/lib/workspace-wallet";
import { useUserStore } from "@/stores/use-user-store";
import { localizedErrorMessage, useLocaleText } from "@/lib/i18n";

type WalletModalTab = "topup" | "redeem" | "shop" | "history";

export function WorkspaceWalletHost() {
    const creditsEnabled = useUserStore((state) => state.features.creditsEnabled);
    const { pathname, search } = useLocation();
    const navigate = useNavigate();
    const [open, setOpen] = useState(false);
    const [pendingPaymentOrderId, setPendingPaymentOrderId] = useState("");
    const [paymentInvalid, setPaymentInvalid] = useState(false);

    const applyOpen = (detail: WorkspaceWalletOpenDetail = {}) => {
        if (!useUserStore.getState().features.creditsEnabled) return;
        setPendingPaymentOrderId(detail.paymentOrderId || "");
        setPaymentInvalid(Boolean(detail.paymentInvalid));
        setOpen(true);
    };

    useEffect(() => {
        const handleOpen = (raw: Event) => {
            applyOpen((raw as CustomEvent<WorkspaceWalletOpenDetail>).detail || {});
        };
        window.addEventListener(WORKSPACE_WALLET_OPEN_EVENT, handleOpen);
        return () => window.removeEventListener(WORKSPACE_WALLET_OPEN_EVENT, handleOpen);
    }, []);

    useEffect(() => {
        if (pathname !== "/wallet") return;
        const params = new URLSearchParams(search);
        openWorkspaceWallet({
            paymentOrderId: params.get("paymentOrder") || undefined,
            paymentInvalid: params.get("payment") === "invalid",
        });
        navigate("/", { replace: true });
    }, [navigate, pathname, search]);

    if (!creditsEnabled) return null;
    return (
        <WorkspaceWalletModal
            open={open}
            pendingPaymentOrderId={pendingPaymentOrderId}
            paymentInvalid={paymentInvalid}
            onClose={() => {
                setOpen(false);
                setPendingPaymentOrderId("");
                setPaymentInvalid(false);
            }}
        />
    );
}

export function WorkspaceWalletModal({ open, onClose, pendingPaymentOrderId, paymentInvalid }: { open: boolean; onClose: () => void; pendingPaymentOrderId?: string; paymentInvalid?: boolean }) {
    const { message } = App.useApp();
    const { locale, text } = useLocaleText();
    const [tab, setTab] = useState<WalletModalTab>("topup");
    const [wallet, setWallet] = useState<WalletSummary | null>(null);
    const [walletLoading, setWalletLoading] = useState(false);
    const [walletError, setWalletError] = useState("");
    const [page, setPage] = useState(1);
    const [products, setProducts] = useState<TopupProduct[]>([]);
    const [providers, setProviders] = useState<PaymentProvider[]>([]);
    const [externalShop, setExternalShop] = useState<ExternalTopupShop | null>(null);
    const [paymentsLoading, setPaymentsLoading] = useState(false);
    const [selectedProductId, setSelectedProductId] = useState("");
    const [selectedProviderId, setSelectedProviderId] = useState("");
    const [code, setCode] = useState("");
    const [redeeming, setRedeeming] = useState(false);
    const [paymentCreating, setPaymentCreating] = useState(false);
    const [paymentQuerying, setPaymentQuerying] = useState(false);
    const [paymentOrder, setPaymentOrder] = useState<PaymentOrder | null>(null);
    const [paymentOpen, setPaymentOpen] = useState(false);
    const [clock, setClock] = useState(Date.now());
    const idempotencyKey = useRef("");
    const completedOrderId = useRef("");
    const requestSequence = useRef(0);

    const selectedProduct = useMemo(() => products.find((item) => item.id === selectedProductId), [products, selectedProductId]);
    const selectedProvider = useMemo(() => providers.find((item) => item.id === selectedProviderId), [providers, selectedProviderId]);

    const reloadWallet = async (targetPage = page) => {
        const sequence = ++requestSequence.current;
        setWalletLoading(true);
        setWalletError("");
        try {
            const result = await getWallet(targetPage, 20, "all");
            if (sequence === requestSequence.current) setWallet(result);
        } catch (error) {
            if (sequence === requestSequence.current) setWalletError(localizedErrorMessage(error, "读取积分账户失败", "Could not load your credits", locale));
        } finally {
            if (sequence === requestSequence.current) setWalletLoading(false);
        }
    };

    useEffect(() => {
        if (!open) return;
        setTab("topup");
        setPage(1);
        setExternalShop(null);
        void reloadWallet(1);
        setPaymentsLoading(true);
        Promise.all([listTopupProducts(), listPaymentProviders(), getExternalTopupShop()])
            .then(([productResult, providerResult, shopResult]) => {
                setProducts(productResult.products.filter((item) => item.enabled));
                setProviders(providerResult.providers.filter((item) => item.enabled && item.pluginEnabled && item.configured));
                setExternalShop(shopResult.shop);
                setTab((current) => current === "topup" && shopResult.shop && (!productResult.products.some((item) => item.enabled) || !providerResult.providers.some((item) => item.enabled && item.pluginEnabled && item.configured)) ? "shop" : current === "shop" && !shopResult.shop ? "topup" : current);
                setSelectedProductId((current) => current || productResult.products.find((item) => item.canPurchase)?.id || productResult.products.find((item) => item.enabled)?.id || "");
                setSelectedProviderId((current) => current || providerResult.providers.find((item) => item.enabled && item.pluginEnabled && item.configured)?.id || "");
            })
            .catch((error) => message.error(localizedErrorMessage(error, "读取充值配置失败", "Could not load top-up options", locale)))
            .finally(() => setPaymentsLoading(false));
    }, [open]);

    useEffect(() => {
        if (!open || !paymentInvalid) return;
        message.error(text("支付结果无效，未产生积分充值", "Invalid payment result. No credits were added."));
    }, [open, paymentInvalid]);

    useEffect(() => {
        idempotencyKey.current = "";
    }, [selectedProductId, selectedProviderId]);

    useEffect(() => {
        if (!paymentOpen || !paymentOrder || !["created", "pending", "closing"].includes(paymentOrder.status)) return;
        const interval = window.setInterval(() => {
            void refreshPaymentStatus(paymentOrder.id, true);
        }, 4_000);
        return () => window.clearInterval(interval);
    }, [paymentOpen, paymentOrder?.id, paymentOrder?.status]);

    useEffect(() => {
        if (!paymentOpen) return;
        const interval = window.setInterval(() => setClock(Date.now()), 1_000);
        return () => window.clearInterval(interval);
    }, [paymentOpen]);

    const announceWalletUpdated = async (orderId?: string) => {
        if (orderId && completedOrderId.current === orderId) return;
        if (orderId) completedOrderId.current = orderId;
        setPage(1);
        await reloadWallet(1);
        window.dispatchEvent(new CustomEvent("wallet:updated"));
    };

    useEffect(() => {
        if (!open || !pendingPaymentOrderId) return;
        getPaymentOrder(pendingPaymentOrderId)
            .then(async ({ order }) => {
                setPaymentOrder(order);
                setPaymentOpen(true);
                if (order.status === "credited") await announceWalletUpdated(order.id);
            })
            .catch((error) => message.error(localizedErrorMessage(error, "读取支付结果失败", "Could not load payment result", locale)));
    }, [open, pendingPaymentOrderId]);

    const redeem = async () => {
        const normalized = code.trim().toLowerCase();
        if (normalized.length !== 32) {
            message.error(text("请输入完整的 32 位兑换码", "Enter the full 32-character redemption code"));
            return;
        }
        setRedeeming(true);
        try {
            await redeemCredits(normalized);
            setCode("");
            await announceWalletUpdated();
            message.success(text("兑换成功，积分已到账", "Code redeemed. Credits have been added."));
        } catch (error) {
            message.error(localizedErrorMessage(error, "兑换失败", "Could not redeem code", locale));
        } finally {
            setRedeeming(false);
        }
    };

    const startPayment = async () => {
        if (!selectedProduct || !selectedProvider) {
            message.error(text("请选择充值商品和支付方式", "Select a credit package and payment method"));
            return;
        }
        if (!selectedProduct.canPurchase) {
            message.error(text("该充值商品当前不可购买，请刷新后重试", "This package is unavailable. Refresh and try again."));
            return;
        }
        setPaymentCreating(true);
        try {
            if (!idempotencyKey.current) idempotencyKey.current = crypto.randomUUID();
            const result = await createPaymentOrder({ productId: selectedProduct.id, providerId: selectedProvider.id, idempotencyKey: idempotencyKey.current });
            idempotencyKey.current = "";
            setPaymentOrder(result.order);
            if (result.order.status === "credited") await announceWalletUpdated(result.order.id);
            if (result.order.checkout.mode === "redirect" && result.order.checkout.url) {
                window.location.assign(result.order.checkout.url);
                return;
            }
            setPaymentOpen(true);
        } catch (error) {
            message.error(localizedErrorMessage(error, "创建支付订单失败", "Could not create payment order", locale));
        } finally {
            setPaymentCreating(false);
        }
    };

    async function refreshPaymentStatus(orderId = paymentOrder?.id, silent = false) {
        if (!orderId || paymentQuerying) return;
        setPaymentQuerying(true);
        try {
            const result = await queryPaymentOrder(orderId);
            setPaymentOrder(result.order);
            if (result.order.status === "credited") {
                await announceWalletUpdated(result.order.id);
                if (!silent) message.success(text("支付已确认，积分已到账", "Payment confirmed. Credits have been added."));
            } else if (!silent && result.order.status === "closed") message.warning(text("订单已关闭，未产生积分充值", "Order closed. No credits were added."));
            else if (!silent) message.info(text("渠道尚未确认支付，请稍后再试", "Payment is not confirmed yet. Try again shortly."));
        } catch (error) {
            if (!silent) message.error(localizedErrorMessage(error, "查询支付结果失败", "Could not check payment status", locale));
        } finally {
            setPaymentQuerying(false);
        }
    }

    const cancelPayment = async () => {
        if (!paymentOrder) return;
        setPaymentQuerying(true);
        try {
            const result = await closePaymentOrder(paymentOrder.id);
            setPaymentOrder(result.order);
            if (result.order.status === "credited") await announceWalletUpdated(result.order.id);
            else message.success(text("未支付订单已关闭", "Unpaid order closed"));
        } catch (error) {
            message.error(localizedErrorMessage(error, "关闭订单失败", "Could not close order", locale));
        } finally {
            setPaymentQuerying(false);
        }
    };

    const retryCheckout = async () => {
        if (!paymentOrder) return;
        setPaymentQuerying(true);
        try {
            const result = await refreshPaymentCheckout(paymentOrder.id);
            setPaymentOrder(result.order);
            if (result.order.checkout.mode === "redirect" && result.order.checkout.url) window.location.assign(result.order.checkout.url);
        } catch (error) {
            message.error(localizedErrorMessage(error, "刷新支付入口失败", "Could not refresh checkout", locale));
        } finally {
            setPaymentQuerying(false);
        }
    };

    const available = wallet?.account.availableMicrocredits ?? 0;
    const totalPages = Math.max(1, Math.ceil((wallet?.total || 0) / 20));

    return (
        <>
            <AppModal flush open={open} title={null} footer={null} centered width={tab === "shop" && externalShop ? "min(1280px, calc(100vw - 12px))" : "min(880px, calc(100vw - 28px))"} onCancel={onClose} rootClassName={cn("workspace-wallet-modal", tab === "shop" && externalShop && "is-shop-open")}>
                <div className="workspace-wallet-shell">
                    <header className="workspace-wallet-header">
                        <div>
                            <span className="workspace-wallet-kicker"><Coins />{text("积分中心", "Credits")}</span>
                            <h2>{text("充值、兑换与消费记录", "Top up, redeem, and review activity")}</h2>
                            <p>{text("为下一次创作补充积分，随时查看每一笔收支。", "Add credits for your next project and track every transaction.")}</p>
                        </div>
                        <div className="workspace-wallet-balance">
                            <span>{text("可用积分", "Available credits")}</span>
                            <strong>{wallet ? formatCredits(available, 6) : "--"}</strong>
                            <small>{text("冻结", "Reserved")} {wallet ? formatCredits(wallet.account.reservedMicrocredits, 6) : "--"}</small>
                        </div>
                    </header>

                    <div className="workspace-wallet-tabs" role="tablist" aria-label={text("积分中心", "Credits")}>
                        <button type="button" role="tab" aria-selected={tab === "topup"} onClick={() => setTab("topup")}><WalletCards />{text("充值", "Top up")}</button>
                        <button type="button" role="tab" aria-selected={tab === "redeem"} onClick={() => setTab("redeem")}><TicketCheck />{text("兑换", "Redeem")}</button>
                        {externalShop ? <button type="button" role="tab" aria-selected={tab === "shop"} onClick={() => setTab("shop")}><Store />{text("链动小铺", "Store")}</button> : null}
                        <button type="button" role="tab" aria-selected={tab === "history"} onClick={() => setTab("history")}><History />{text("收支记录", "Activity")}</button>
                    </div>

                    {tab === "topup" ? (
                        <div className="workspace-wallet-content is-topup">
                            <section className="workspace-wallet-section">
                                <div className="workspace-wallet-section-heading">
                                    <div>
                                        <h3>{text("在线充值", "Online top-up")}</h3>
                                        <p>{text("选择积分套餐和支付方式。", "Choose a credit package and payment method.")}</p>
                                    </div>
                                    <CreditCard />
                                </div>
                                {paymentsLoading ? (
                                    <Skeleton active paragraph={{ rows: 4 }} />
                                ) : products.length && providers.length ? (
                                    <>
                                        <div className="workspace-wallet-products">
                                            {products.map((product) => {
                                                const unavailableLabel =
                                                    product.saleStatus === "upcoming"
                                                        ? `${text("发售时间", "Available from")}: ${product.saleStartAt ? new Date(product.saleStartAt).toLocaleString(locale, { hour12: false }) : text("待定", "TBD")}`
                                                        : product.saleStatus === "ended"
                                                          ? text("已结束", "Ended")
                                                          : product.saleStatus === "sold_out"
                                                            ? text(`已售罄（库存 ${product.stockRemaining ?? 0}）`, `Sold out (${product.stockRemaining ?? 0} left)`)
                                                            : product.saleStrategy === "inventory"
                                                              ? text(`库存 ${product.stockRemaining ?? 0}`, `${product.stockRemaining ?? 0} left`)
                                                              : product.saleStrategy === "periodic"
                                                                ? text(`每 ${product.periodDays} 天限购 ${product.periodPurchaseLimit} 次`, `Limit ${product.periodPurchaseLimit} per ${product.periodDays} days`)
                                                                : text("不限量", "Unlimited");
                                                return (
                                                    <button
                                                        key={product.id}
                                                        type="button"
                                                        className={cn("workspace-wallet-product", selectedProductId === product.id && "is-selected")}
                                                        aria-pressed={selectedProductId === product.id}
                                                        disabled={!product.canPurchase}
                                                        onClick={() => setSelectedProductId(product.id)}
                                                    >
                                                        <span>{product.name}</span>
                                                        <strong>{formatCredits(product.creditsMicrocredits, 6)} {text("积分", "credits")}</strong>
                                                        <small>
                                                            ¥ {(product.amountFen / 100).toFixed(2)} · {unavailableLabel}
                                                            {product.description ? ` · ${product.description}` : ""}
                                                        </small>
                                                        {selectedProductId === product.id ? <Check /> : null}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                        <div className="workspace-wallet-provider-row">
                                            <div className="workspace-wallet-providers" role="radiogroup" aria-label={text("支付方式", "Payment method")}>
                                                {providers.map((provider) => (
                                                    <button
                                                        key={provider.id}
                                                        type="button"
                                                        role="radio"
                                                        aria-checked={selectedProviderId === provider.id}
                                                        className={selectedProviderId === provider.id ? "is-selected" : ""}
                                                        onClick={() => setSelectedProviderId(provider.id)}
                                                    >
                                                        <CreditCard />
                                                        {provider.name}
                                                    </button>
                                                ))}
                                            </div>
                                            <Button type="primary" size="large" loading={paymentCreating} disabled={!selectedProduct?.canPurchase || !selectedProvider} onClick={() => void startPayment()}>
                                                {text("立即充值", "Top up now")}
                                            </Button>
                                        </div>
                                    </>
                                ) : (
                                    <div className="workspace-wallet-inline-state">
                                        <CircleAlert />
                                        <div>
                                            <strong>{text("在线充值暂不可用", "Online top-up is unavailable")}</strong>
                                            <span>{text("当前没有已启用的充值商品或支付渠道，请使用兑换码或联系管理员。", "No packages or payment methods are available. Use a redemption code or contact an administrator.")}</span>
                                        </div>
                                    </div>
                                )}
                            </section>
                        </div>
                    ) : tab === "redeem" ? (
                        <div className="workspace-wallet-content is-redeem">
                            <section className="workspace-wallet-section is-redeem">
                                <div className="workspace-wallet-section-heading"><div><h3>{text("兑换码", "Redemption code")}</h3><p>{text("输入兑换码，将积分存入当前账户。", "Enter a code to add credits to your account.")}</p></div><TicketCheck /></div>
                                <div className="workspace-wallet-redeem-row">
                                    <Input size="large" value={code} maxLength={32} placeholder={text("输入 32 位兑换码", "Enter 32-character code")} onChange={(event) => setCode(event.target.value.replace(/\s/g, ""))} onPressEnter={() => void redeem()} />
                                    <Button size="large" loading={redeeming} disabled={code.trim().length !== 32} onClick={() => void redeem()}>{text("确认兑换", "Redeem")}</Button>
                                </div>
                            </section>
                        </div>
                    ) : tab === "shop" && externalShop ? (
                        <div className="workspace-wallet-content is-shop">
                            <div className="workspace-wallet-shop-heading"><h3>{text("链动小铺", "Store")}</h3><span>{text("店铺付款不会自动入账积分，请与管理员确认兑换方式。", "Store payments do not add credits automatically. Confirm redemption with an administrator.")}</span></div>
                            <EmbeddedTopupShop url={externalShop.url} />
                        </div>
                    ) : (
                        <div className="workspace-wallet-content is-history">
                            <div className="workspace-wallet-history-toolbar"><div><h3>{text("积分消耗历史", "Credit activity")}</h3><p>{text("包含充值、兑换、生成消费、冻结与退款。", "Top-ups, redemptions, generation charges, reservations, and refunds.")}</p></div><Button type="text" icon={<RefreshCw />} loading={walletLoading} onClick={() => void reloadWallet(page)}>{text("刷新", "Refresh")}</Button></div>
                            <div className="workspace-wallet-history-scroll">
                                {walletError ? <div className="workspace-wallet-inline-state is-error"><CircleAlert /><div><strong>{text("记录加载失败", "Could not load activity")}</strong><span>{walletError}</span></div><Button onClick={() => void reloadWallet(page)}>{text("重试", "Retry")}</Button></div> : walletLoading && !wallet ? <Skeleton active paragraph={{ rows: 6 }} /> : wallet?.entries.length ? <div className="workspace-wallet-ledger">
                                    {wallet.entries.map((entry) => <WalletLedgerRow key={entry.id} entry={entry} />)}
                                </div> : <div className="workspace-wallet-empty"><History /><strong>{text("还没有积分记录", "No credit activity yet")}</strong><span>{text("完成充值、兑换或生成任务后，记录会显示在这里。", "Top-ups, redemptions, and generation charges will appear here.")}</span></div>}
                            </div>
                            <div className="workspace-wallet-pagination">
                                <span>{locale === "en-US" ? `Page ${page} of ${totalPages}` : `第 ${page} / ${totalPages} 页`}</span>
                                <button type="button" disabled={page <= 1 || walletLoading} aria-label={text("上一页", "Previous page")} onClick={() => { const next = page - 1; setPage(next); void reloadWallet(next); }}><ChevronLeft /></button>
                                <button type="button" disabled={page >= totalPages || walletLoading} aria-label={text("下一页", "Next page")} onClick={() => { const next = page + 1; setPage(next); void reloadWallet(next); }}><ChevronRight /></button>
                            </div>
                        </div>
                    )}
                </div>
            </AppModal>

            <AppModal open={paymentOpen} title={paymentOrder?.status === "credited" ? text("充值完成", "Top-up complete") : paymentOrder?.checkout.mode === "qr_code" ? text("扫码支付", "Scan to pay") : text("确认支付结果", "Confirm payment")} centered width={430} onCancel={() => setPaymentOpen(false)} footer={paymentFooter(paymentOrder, paymentQuerying, () => setPaymentOpen(false), cancelPayment, refreshPaymentStatus, retryCheckout, text)}>
                {paymentOrder ? <div className="workspace-wallet-payment">
                    <span className="workspace-wallet-payment-icon"><CreditCard /></span>
                    <strong>¥ {(paymentOrder.amountFen / 100).toFixed(2)}</strong>
                    <p>{paymentOrder.productName} · {formatCredits(paymentOrder.creditsMicrocredits, 6)} {text("积分", "credits")}</p>
                    {paymentOrder.status === "pending" && paymentOrder.checkout.mode === "qr_code" && paymentOrder.checkout.value ? <><PaymentCheckoutCode value={paymentOrder.checkout.value} /><span>{text("请使用支付应用扫码完成支付", "Scan with your payment app to complete the payment")}</span></> : null}
                    <PaymentStatus order={paymentOrder} now={clock} />
                </div> : null}
            </AppModal>
        </>
    );
}

export function EmbeddedTopupShop({ url }: { url: string }) {
    const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");
    const { text } = useLocaleText();

    return <div className="workspace-wallet-shop-frame">
        {status === "error" ? <div className="workspace-wallet-inline-state is-error" role="alert"><CircleAlert /><div><strong>{text("店铺暂时无法加载", "Store is unavailable")}</strong><span>{text("请联系管理员检查店铺链接及嵌入权限。", "Ask an administrator to check the store URL and embed permissions.")}</span></div></div> : <iframe
            title={text("链动小铺", "Store")}
            src={url}
            sandbox="allow-forms allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
            allow="payment"
            referrerPolicy="no-referrer"
            onLoad={() => setStatus("loaded")}
            onError={() => setStatus("error")}
        />}
        {status === "loading" ? <span className="workspace-wallet-shop-loading" role="status">{text("店铺加载中...", "Loading store...")}</span> : null}
    </div>;
}

function WalletLedgerRow({ entry }: { entry: CreditLedgerEntry }) {
    const { locale, text } = useLocaleText();
    const positive = entry.amountMicrocredits > 0;
    const title = entry.type === "consume" ? text("模型调用", "Model usage") : entry.type === "refund" ? text("消费退款", "Refund") : entry.type === "payment_topup" ? text("在线充值", "Online top-up") : entry.type === "redeem" ? text("兑换码充值", "Code redemption") : entry.note || text("积分调整", "Credit adjustment");
    return <article className="workspace-wallet-ledger-row"><span className={cn("workspace-wallet-ledger-icon", positive ? "is-income" : "is-consume")}>{positive ? <Coins /> : <CreditCard />}</span><div><strong>{title}</strong><span>{[entry.scene, entry.model, entry.note].filter(Boolean).join(" · ") || text("积分账户变动", "Credit balance changed")}</span></div><time>{new Date(entry.createdAt).toLocaleString(locale, { hour12: false })}</time><b className={positive ? "is-income" : "is-consume"}>{positive ? "+" : ""}{formatCredits(entry.amountMicrocredits, 6)}</b></article>;
}

function PaymentStatus({ order, now }: { order: PaymentOrder; now: number }) {
    const { locale, text } = useLocaleText();
    if (order.status === "credited") return <div className="workspace-wallet-payment-status is-success">{text("支付已确认，积分已经到账", "Payment confirmed. Credits have been added.")}</div>;
    if (order.status === "closed") return <div className="workspace-wallet-payment-status">{text("订单已关闭，未产生积分充值", "Order closed. No credits were added.")}</div>;
    if (order.status === "create_failed") return <div className="workspace-wallet-payment-status is-error">{text("支付入口创建失败，请重新生成支付入口。", "Could not open checkout. Generate a new payment link.")}</div>;
    const remaining = Math.max(0, Math.floor((new Date(order.expiresAt).getTime() - now) / 1000));
    const hours = Math.floor(remaining / 3600);
    const minutes = Math.floor((remaining % 3600) / 60);
    const seconds = remaining % 60;
    const countdown = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    return <div className="workspace-wallet-payment-status">{locale === "en-US" ? `${countdown} left. Payment status updates automatically.` : `订单剩余 ${countdown}，将自动确认支付结果`}</div>;
}

function paymentFooter(order: PaymentOrder | null, loading: boolean, close: () => void, cancel: () => Promise<void>, query: (id?: string, silent?: boolean) => Promise<void>, retry: () => Promise<void>, text: (chinese: string, english: string) => string) {
    if (order?.status === "pending") return [<Button key="cancel" danger disabled={loading} onClick={() => void cancel()}>{text("关闭订单", "Close order")}</Button>, <Button key="query" type="primary" loading={loading} onClick={() => void query()}>{text("我已完成支付", "I've paid")}</Button>];
    if (order?.status === "create_failed") return [<Button key="close" onClick={close}>{text("稍后处理", "Later")}</Button>, <Button key="retry" type="primary" loading={loading} onClick={() => void retry()}>{text("重新生成支付入口", "Retry checkout")}</Button>];
    return [<Button key="done" type="primary" onClick={close}>{text("完成", "Done")}</Button>];
}
