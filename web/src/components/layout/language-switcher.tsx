import { Dropdown } from "antd";
import { Check, Globe2 } from "lucide-react";

import { useLocaleStore, type AppLocale } from "@/lib/i18n";
import { SUPPORTED_LOCALES } from "@/i18n/locales";
import { switchLocale } from "@/i18n";

export function LanguageSwitcher({ className = "" }: { className?: string }) {
    const locale = useLocaleStore((state) => state.locale);
    const labels = Object.fromEntries(SUPPORTED_LOCALES.map((item) => [item.code, item.label])) as Record<AppLocale, string>;

    return (
        <Dropdown
            trigger={["click"]}
            menu={{
                selectedKeys: [locale],
                items: SUPPORTED_LOCALES.map(({ code: key }) => ({
                    key,
                    label: (
                        <span className="flex min-w-32 items-center justify-between gap-3">
                            {labels[key]}
                            {locale === key ? <Check className="size-3.5" aria-hidden /> : null}
                        </span>
                    ),
                })),
                onClick: ({ key }) => switchLocale(key as AppLocale),
            }}
        >
            <button type="button" className={className} aria-label={locale === "en-US" ? "Language" : "语言"} title={locale === "en-US" ? "Language" : "语言"}>
                <Globe2 className="size-4" aria-hidden />
                <span>{labels[locale]}</span>
            </button>
        </Dropdown>
    );
}
