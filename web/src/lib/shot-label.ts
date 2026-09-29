import type { AppLocale } from "@/lib/i18n";

const LEGACY_DEFAULT_SHOT_TITLE = /^SC\.\d+$/i;

export function formatShotOrdinal(index: number) {
    return `镜头${String(Math.max(0, index) + 1).padStart(2, "0")}`;
}

export function displayShotOrdinal(index: number, locale: AppLocale) {
    return locale === "en-US" ? `Shot ${String(Math.max(0, index) + 1).padStart(2, "0")}` : formatShotOrdinal(index);
}

export function normalizeDefaultShotTitle(title: string | undefined, index: number) {
    const value = (title || "").trim();
    return LEGACY_DEFAULT_SHOT_TITLE.test(value) ? formatShotOrdinal(index) : value;
}

export function customShotTitle(title: string | undefined, index: number) {
    const value = normalizeDefaultShotTitle(title, index);
    return value === formatShotOrdinal(index) || value === displayShotOrdinal(index, "en-US") ? "" : value;
}
