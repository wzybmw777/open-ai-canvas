import { create } from "zustand";

export type AppLocale = "zh-CN" | "en-US";

export function localeText(chinese: string, english: string, locale: AppLocale) {
    return locale === "en-US" ? english : chinese;
}

const STORAGE_KEY = "infinite-canvas:locale";

export function preferredLocale(storage?: Pick<Storage, "getItem">, languages?: readonly string[]): AppLocale {
    let saved: string | null = null;
    try {
        saved = (storage ?? (typeof window === "undefined" ? undefined : window.localStorage))?.getItem(STORAGE_KEY) ?? null;
    } catch {
        // Language selection remains available when browser storage is blocked.
    }
    if (saved === "zh-CN" || saved === "en-US") return saved;
    const browserLanguages = languages ?? (typeof navigator === "undefined" ? [] : navigator.languages?.length ? navigator.languages : [navigator.language]);
    return browserLanguages[0]?.toLowerCase().startsWith("zh") ? "zh-CN" : "en-US";
}

type LocaleState = { locale: AppLocale; setLocale: (locale: AppLocale) => void };

export const useLocaleStore = create<LocaleState>((set) => ({
    locale: preferredLocale(),
    setLocale: (locale) => {
        try {
            window.localStorage.setItem(STORAGE_KEY, locale);
        } catch {
            // Keep the selection for this session.
        }
        set({ locale });
    },
}));

export function formatLocalizedDate(value: Date | number | string, options: Intl.DateTimeFormatOptions, locale = useLocaleStore.getState().locale) {
    const date = value instanceof Date ? value : new Date(value);
    return new Intl.DateTimeFormat(locale, options).format(date);
}

const englishErrorReasons: Record<string, string> = {
    invalid_argument: "Check the information you entered and try again.",
    unauthorized: "Your sign-in has expired or your credentials are incorrect.",
    forbidden: "You do not have permission to do this.",
    not_found: "The requested item was not found.",
    conflict: "This item already exists or was changed elsewhere.",
    failed_precondition: "This action is not available yet.",
    quota_exceeded: "Your available quota has been reached.",
    rate_limited: "Too many requests. Try again later.",
    unavailable: "The service is temporarily unavailable.",
    timeout: "The request timed out. Try again.",
    internal: "Something went wrong. Try again later.",
    bad_gateway: "The upstream service is unavailable.",
    upstream_dns_failed: "The upstream service could not be reached.",
};

export function localizedErrorMessage(error: unknown, chineseFallback: string, englishFallback: string, locale = useLocaleStore.getState().locale) {
    if (locale === "en-US") {
        const reason = error && typeof error === "object" && "reason" in error ? error.reason : undefined;
        return typeof reason === "string" ? englishErrorReasons[reason] || englishFallback : englishFallback;
    }
    return error instanceof Error ? error.message : chineseFallback;
}

export function useLocaleText() {
    const locale = useLocaleStore((state) => state.locale);
    return { locale, text: (chinese: string, english: string) => localeText(chinese, english, locale) };
}
