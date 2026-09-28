import { Dropdown } from "antd";
import { Check, Globe2 } from "lucide-react";

import { useLocaleStore, type AppLocale } from "@/lib/i18n";

export function LanguageSwitcher({ className = "" }: { className?: string }) {
    const locale = useLocaleStore((state) => state.locale);
    const setLocale = useLocaleStore((state) => state.setLocale);
    const labels: Record<AppLocale, string> = { "zh-CN": "简体中文", "en-US": "English" };

    return (
        <Dropdown
            trigger={["click"]}
            menu={{
                selectedKeys: [locale],
                items: (["zh-CN", "en-US"] as const).map((key) => ({
                    key,
                    label: (
                        <span className="flex min-w-32 items-center justify-between gap-3">
                            {labels[key]}
                            {locale === key ? <Check className="size-3.5" aria-hidden /> : null}
                        </span>
                    ),
                })),
                onClick: ({ key }) => setLocale(key as AppLocale),
            }}
        >
            <button type="button" className={className} aria-label={locale === "en-US" ? "Language" : "语言"} title={locale === "en-US" ? "Language" : "语言"}>
                <Globe2 className="size-4" aria-hidden />
                <span>{labels[locale]}</span>
            </button>
        </Dropdown>
    );
}
