import { afterEach, expect, spyOn, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EmbeddedTopupShop } from "../src/components/layout/workspace-wallet-modal";
import { http } from "../src/services/api/request";
import { getAdminExternalTopupShop, getExternalTopupShop, updateAdminExternalTopupShop } from "../src/services/api/payments";

const get = spyOn(http, "get");
const put = spyOn(http, "put");

afterEach(() => {
    get.mockReset();
    put.mockReset();
});

test("external shop reads public status and persists admin configuration through payment API", async () => {
    const shop = { enabled: true, url: "https://wzyp.cn/shop/69G55K8Q" };
    get.mockResolvedValue({ shop } as never);
    put.mockResolvedValue({ shop } as never);

    expect(await getExternalTopupShop()).toEqual({ shop });
    expect(get.mock.calls[0][0]).toBe("/payments/external-shop");
    expect(await getAdminExternalTopupShop()).toEqual({ shop });
    expect(get.mock.calls[1][0]).toBe("/admin/payments/external-shop");
    expect(await updateAdminExternalTopupShop(shop)).toEqual({ shop });
    expect(put.mock.calls[0]).toEqual(["/admin/payments/external-shop", shop]);
});

test("storefront renders inside the wallet without a top-level redirect", () => {
    const html = renderToStaticMarkup(createElement(EmbeddedTopupShop, { url: "https://wzyp.cn/shop/69G55K8Q" }));
    expect(html).toContain('<iframe title="链动小铺" src="https://wzyp.cn/shop/69G55K8Q"');
    expect(html).toContain('sandbox="allow-forms allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"');
    expect(html).toContain('referrerPolicy="no-referrer"');
    expect(html).not.toContain('target="_blank"');
});

test("external shop appears as a distinct row in the payment channels table", async () => {
    const admin = await Bun.file(new URL("../src/pages/admin/payments/payments-page.tsx", import.meta.url)).text();
    const wallet = await Bun.file(new URL("../src/components/layout/workspace-wallet-modal.tsx", import.meta.url)).text();
    expect(admin).toContain('dataSource: providerRows');
    expect(admin).toContain('checkoutMode: "embedded"');
    expect(admin).toContain('isExternalShopChannel(provider) ? "不适用"');
    expect(admin).not.toContain('title={provider.url}');
    expect(wallet).toContain('tab === "shop" && externalShop');
    expect(wallet).toContain('"is-shop-open"');
    expect(wallet).not.toContain('href={externalShop.url}');
});
