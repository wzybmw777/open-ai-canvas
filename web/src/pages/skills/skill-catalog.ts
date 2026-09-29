import type { Skill, SkillCategory } from "@/services/api/skills";
import type { AppLocale } from "@/lib/i18n";

export const fallbackSkillCategories: SkillCategory[] = [
    { value: "drama", label: "短剧影视" },
    { value: "ecommerce", label: "电商营销" },
    { value: "creative", label: "创意设计" },
    { value: "social", label: "社媒内容" },
    { value: "others", label: "其他" },
];

export function skillCategoryLabel(value: string, categories: SkillCategory[] = fallbackSkillCategories, locale: AppLocale = "zh-CN") {
    if (locale === "en-US") return ({ drama: "Film & drama", ecommerce: "Commerce", creative: "Creative design", social: "Social media", others: "Other" } as Record<string, string>)[value] || categories.find((item) => item.value === value)?.label || "Other";
    return categories.find((item) => item.value === value)?.label || "其他";
}

export function groupSkills(skills: Skill[], categories: SkillCategory[]) {
    const ordered = categories.length ? categories : fallbackSkillCategories;
    return ordered
        .map((category) => ({ ...category, skills: skills.filter((skill) => skill.tag === category.value) }))
        .filter((group) => group.skills.length > 0);
}

export function formatSkillCount(value: number, locale: AppLocale = "zh-CN") {
    return new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

export function formatSkillDate(value: string, locale: AppLocale = "zh-CN") {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return locale === "en-US" ? "Unknown date" : "未知时间";
    return new Intl.DateTimeFormat(locale, { year: "numeric", month: "short", day: "numeric" }).format(date);
}
