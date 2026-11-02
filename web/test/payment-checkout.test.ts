import { afterEach, expect, test } from "bun:test";
import { apiClient, ApiError } from "../src/services/api/request";
import { closePaymentOrder, createPaymentOrder, getPaymentOrder, listTopupProducts, queryPaymentOrder, refreshPaymentCheckout, type PaymentOrder, type TopupProduct } from "../src/services/api/payments";

const originalAdapter = apiClient.defaults.adapter;
afterEach(() => {
    apiClient.defaults.adapter = originalAdapter;
});

const product: TopupProduct = {
    id: "product-1",
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
const order: PaymentOrder = {
    id: "order/a b",
    merchantOrderNo: "merchant-1",
    productId: product.id,
    productName: product.name,
    productKind: product.kind,
    providerId: "provider-1",
    amountFen: 9900,
    currency: "CNY",
    creditsMicrocredits: 50_000_000,
    status: "pending",
    checkout: { mode: "qr_code", value: "fixture-checkout" },
    expiresAt: "2026-10-02",
    createdAt: "2026-10-01",
    updatedAt: "2026-10-01",
};

test("checkout uses server product pricing and sends only product, provider and idempotency identity", async () => {
    const requests: Array<{ method: string | undefined; url: string | undefined; data: unknown }> = [];
    apiClient.defaults.adapter = async (config) => {
        requests.push({ method: config.method, url: config.url, data: config.data ? JSON.parse(config.data) : undefined });
        return { config, status: 200, statusText: "OK", headers: {}, data: { code: 0, data: config.url === "/payments/products" ? { products: [product] } : { order }, msg: "" } };
    };
    const catalog = await listTopupProducts();
    expect(catalog.products[0]).toMatchObject({ id: "product-1", amountFen: 9900, creditsMicrocredits: 50_000_000 });
    const created = await createPaymentOrder({ productId: "product-1", providerId: "provider-1", idempotencyKey: "checkout-operation" });
    expect(created.order).toMatchObject({ status: "pending", amountFen: 9900, creditsMicrocredits: 50_000_000, checkout: { mode: "qr_code", value: "fixture-checkout" } });
    expect(requests).toEqual([
        { method: "get", url: "/payments/products", data: undefined },
        { method: "post", url: "/payments/orders", data: { productId: "product-1", providerId: "provider-1", idempotencyKey: "checkout-operation" } },
    ]);
});

test("payment follow-up actions encode and retain the same order identity", async () => {
    const requests: string[] = [];
    apiClient.defaults.adapter = async (config) => {
        requests.push(`${config.method} ${config.url}`);
        return { config, status: 200, statusText: "OK", headers: {}, data: { code: 0, data: { order }, msg: "" } };
    };
    for (const action of [getPaymentOrder, queryPaymentOrder, closePaymentOrder, refreshPaymentCheckout]) {
        expect((await action("order/a b")).order.id).toBe("order/a b");
    }
    expect(requests).toEqual(["get /payments/orders/order%2Fa%20b", "post /payments/orders/order%2Fa%20b/query", "post /payments/orders/order%2Fa%20b/close", "post /payments/orders/order%2Fa%20b/checkout/refresh"]);
});

test("HTTP success with a failed payment envelope remains a rejected write with its reason", async () => {
    apiClient.defaults.adapter = async (config) => ({ config, status: 200, statusText: "OK", headers: {}, data: { code: 9, data: null, msg: "商品不可购买", reason: "product_unavailable" } });
    const error = await createPaymentOrder({ productId: "product-1", providerId: "provider-1", idempotencyKey: "checkout-operation" }).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: 9, reason: "product_unavailable" });
});
