import { CollectionToolbar } from "@/components/layout/collection-toolbar";
import { AppModal } from "@/components/ui/product/app-modal";
import { App, Button, Dropdown, Input } from "antd";
import { Tooltip } from "@/components/ui/base/tooltip";

import { Boxes, Check, Clapperboard, FolderInput, FolderPlus, Globe2, Heart, Library, LoaderCircle, Megaphone, MoreHorizontal, Palette, Plus, Puzzle, Search, ShoppingBag, Sparkles, Trash2, UserRound } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import { PageHeader, PaginationBar, WorkspacePage } from "@/components/layout/workspace-page";
import { WorkspaceErrorState, WorkspaceState } from "@/components/layout/workspace-state";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { fallbackSkillCategories, formatSkillCount, groupSkills, skillCategoryLabel } from "@/pages/skills/skill-catalog";
import { SkillDetailModal } from "@/pages/skills/skill-detail-drawer";
import { SkillEditorDrawer } from "@/pages/skills/skill-editor-drawer";
import { SkillInstallModal } from "@/pages/skills/skill-install-modal";
import { addSkill, createSkillLibraryCategory, deleteSkill, deleteSkillLibraryCategory, getSkill, likeSkill, listSkillLibraryCategories, listSkills, removeSkill, setSkillLibraryCategory, syncSkill, unlikeSkill, type Skill, type SkillCategory, type SkillLibraryCategory, type SkillLibraryCategoryList, type SkillScope, type SkillSort } from "@/services/api/skills";
import { useUserStore } from "@/stores/use-user-store";
import { Select } from "@/components/ui/base/select";
import { localizedErrorMessage, useLocaleText } from "@/lib/i18n";

const scopeOptions = [
    { label: "技能广场", value: "public", icon: Sparkles },
    { label: "我的技能", value: "mine", icon: Library },
    { label: "我创建的", value: "created", icon: UserRound },
    { label: "我的收藏", value: "favorites", icon: Heart },
];

/* 分类图标映射：画廊卡片顶部的图标块，未知分类回退 Boxes。 */
const categoryIcons: Record<string, LucideIcon> = {
    drama: Clapperboard,
    ecommerce: ShoppingBag,
    creative: Palette,
    social: Megaphone,
    others: Puzzle,
};
const categoryIconOf = (value: string) => categoryIcons[value] ?? Boxes;

const sortOptions: { label: string; value: SkillSort }[] = [
    { label: "最多加入", value: "popular" },
    { label: "最新发布", value: "new" },
    { label: "最近更新", value: "updated" },
];

export default function SkillsPage() {
    const { locale, text } = useLocaleText();
    const { message, modal } = App.useApp();
    const [scope, setScope] = useState<SkillScope>("public");
    const [sort, setSort] = useState<SkillSort>("popular");
    const [search, setSearch] = useState("");
    const debouncedSearch = useDebouncedValue(search, 250);
    const [tag, setTag] = useState("all");
    const [libraryCategoryId, setLibraryCategoryId] = useState("all");
    const [libraryCategoryList, setLibraryCategoryList] = useState<SkillLibraryCategoryList | null>(null);
    const [libraryCategoryError, setLibraryCategoryError] = useState("");
    const [categoryEditorOpen, setCategoryEditorOpen] = useState(false);
    const [categoryName, setCategoryName] = useState("");
    const [categoryScope, setCategoryScope] = useState<"personal" | "platform">("personal");
    const [categorySaving, setCategorySaving] = useState(false);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(20);
    const [skills, setSkills] = useState<Skill[]>([]);
    const [categories, setCategories] = useState<SkillCategory[]>(fallbackSkillCategories);
    const [total, setTotal] = useState(0);
    const [counts, setCounts] = useState<Partial<Record<SkillScope, number>>>({});
    const tabsRef = useRef<HTMLDivElement>(null);
    const indicatorRef = useRef<HTMLSpanElement>(null);
    useLayoutEffect(() => {
        const tabs = tabsRef.current;
        const indicator = indicatorRef.current;
        const active = tabs?.querySelector<HTMLButtonElement>('[aria-selected="true"]');
        if (!tabs || !indicator || !active) return;
        indicator.style.left = `${active.offsetLeft}px`;
        indicator.style.width = `${active.offsetWidth}px`;
    }, [scope, counts]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState("");
    const [reloadKey, setReloadKey] = useState(0);
    const [activeSkill, setActiveSkill] = useState<Skill | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [mutatingID, setMutatingID] = useState("");
    const [editorOpen, setEditorOpen] = useState(false);
    const [installOpen, setInstallOpen] = useState(false);
    const [editingSkill, setEditingSkill] = useState<Skill | null>(null);
    const isAdmin = useUserStore((state) => state.user?.role === "admin");
    const isLibraryScope = scope === "mine" || scope === "created";
    const libraryCategoryScope = scope === "created" ? "created" : "mine";

    const reload = useCallback(() => setReloadKey((value) => value + 1), []);
    const selectMarketplaceCategory = (categoryId: string) => {
        setScope("public");
        setTag(categoryId);
        setLibraryCategoryId("all");
        setPage(1);
    };
    const selectLibraryCategory = (categoryId: string) => {
        setScope((current) => current === "created" ? "created" : "mine");
        setLibraryCategoryId(categoryId);
        setPage(1);
    };

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setLoadError("");
        const libraryFilter = isLibraryScope
            ? libraryCategoryId === "__uncategorized__"
                ? { libraryUncategorized: true }
                : libraryCategoryId !== "all" ? { libraryCategoryId } : {}
            : {};
        listSkills({ page, pageSize, scope, sort, search: debouncedSearch || undefined, tag: !isLibraryScope && tag !== "all" ? tag : undefined, ...libraryFilter })
            .then((result) => {
                if (cancelled) return;
                setSkills(result.skills);
                setTotal(result.totalCount);
                setCounts((prev) => ({ ...prev, [scope]: result.totalCount }));
                if (result.categories.length) setCategories(result.categories);
            })
            .catch((error) => {
                if (cancelled) return;
                setSkills([]);
                setTotal(0);
                setLoadError(localizedErrorMessage(error, "技能加载失败", "Could not load skills", locale));
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [debouncedSearch, isLibraryScope, libraryCategoryId, locale, page, pageSize, reloadKey, scope, sort, tag]);

    useEffect(() => {
        let cancelled = false;
        setLibraryCategoryError("");
        listSkillLibraryCategories(libraryCategoryScope)
            .then((result) => { if (!cancelled) setLibraryCategoryList(result); })
            .catch((error) => {
                if (!cancelled) {
                    setLibraryCategoryList(null);
                    setLibraryCategoryError(localizedErrorMessage(error, "技能库分类加载失败", "Could not load skill categories", locale));
                }
            });
        return () => { cancelled = true; };
    }, [libraryCategoryScope, locale, reloadKey]);

    const groupedSkills = useMemo(() => groupSkills(skills, categories), [categories, skills]);
    const filtersActive = Boolean(search || (!isLibraryScope && tag !== "all") || (isLibraryScope && libraryCategoryId !== "all") || sort !== "popular");
    const resetFilters = useCallback(() => { setSearch(""); setTag("all"); setLibraryCategoryId("all"); setSort("popular"); setPage(1); }, []);

    const openSkill = async (skill: Skill) => {
        setActiveSkill(skill);
        setDetailLoading(true);
        try {
            const result = await getSkill(skill.skillId);
            setActiveSkill(result.skill);
            patchSkill(result.skill);
        } catch (error) {
            message.error(localizedErrorMessage(error, "技能详情加载失败", "Could not load skill details", locale));
            setActiveSkill(null);
        } finally {
            setDetailLoading(false);
        }
    };

    const openEditor = async (skill?: Skill) => {
        if (!skill) {
            setEditingSkill(null);
            setEditorOpen(true);
            return;
        }
        try {
            const result = skill.instruction ? { skill } : await getSkill(skill.skillId);
            setActiveSkill(null);
            setEditingSkill(result.skill);
            setEditorOpen(true);
        } catch (error) {
            message.error(localizedErrorMessage(error, "技能读取失败", "Could not load skill", locale));
        }
    };

    const patchSkill = (next: Skill) => {
        setSkills((items) => items.map((item) => item.skillId === next.skillId ? { ...item, ...next, instruction: next.instruction || item.instruction } : item));
        setActiveSkill((current) => current?.skillId === next.skillId ? { ...current, ...next, instruction: next.instruction || current.instruction } : current);
    };

    const toggleAdded = async (skill: Skill) => {
        if (skill.isOwner) return;
        setMutatingID(skill.skillId);
        try {
            const result = skill.isAdded ? await removeSkill(skill.skillId) : await addSkill(skill.skillId);
            patchSkill(result.skill);
            message.success(result.skill.isAdded ? text("已加入我的技能", "Added to My Skills") : text("已从我的技能移除", "Removed from My Skills"));
            if (scope === "mine") reload();
        } catch (error) {
            message.error(localizedErrorMessage(error, "技能状态更新失败", "Could not update skill", locale));
        } finally {
            setMutatingID("");
        }
    };

    const toggleLiked = async (skill: Skill) => {
        setMutatingID(skill.skillId);
        try {
            const result = skill.isLike ? await unlikeSkill(skill.skillId) : await likeSkill(skill.skillId);
            patchSkill(result.skill);
            message.success(result.skill.isLike ? text("已收藏", "Added to favorites") : text("已取消收藏", "Removed from favorites"));
            if (scope === "favorites" && !result.skill.isLike) reload();
        } catch (error) {
            message.error(localizedErrorMessage(error, "收藏状态更新失败", "Could not update favorite", locale));
        } finally {
            setMutatingID("");
        }
    };

    const synchronizeSkill = async (skill: Skill) => {
        setMutatingID(skill.skillId);
        try {
            const result = await syncSkill(skill.skillId);
            patchSkill(result.skill);
            message.success(result.skill.versionId === skill.versionId ? text("已是最新版本", "Already up to date") : text("已同步最新版本", "Updated to latest version"));
            reload();
        } catch (error) {
            message.error(localizedErrorMessage(error, "GitHub 技能同步失败", "Could not sync GitHub skill", locale));
        } finally {
            setMutatingID("");
        }
    };

    const confirmDelete = (skill: Skill) => {
        modal.confirm({
            title: locale === "en-US" ? `Delete "${skill.skillName}"?` : `删除“${skill.skillName}”？`,
            content: text("删除后，其他用户将无法继续使用该技能，已有加入和收藏关系也会一并移除。", "Other users will lose access to this skill, including existing saves and favorites."),
            okText: text("删除技能", "Delete skill"),
            okButtonProps: { danger: true },
            cancelText: text("取消", "Cancel"),
            onOk: async () => {
                try {
                    await deleteSkill(skill.skillId);
                    setActiveSkill(null);
                    message.success(text("技能已删除", "Skill deleted"));
                    reload();
                } catch (error) {
                    message.error(localizedErrorMessage(error, "技能删除失败", "Could not delete skill", locale));
                    throw error;
                }
            },
        });
    };

    const saveLibraryCategory = async () => {
        const name = categoryName.trim();
        if (!name) {
            message.error(text("请输入分类名称", "Enter a category name"));
            return;
        }
        setCategorySaving(true);
        try {
            await createSkillLibraryCategory({ name, scope: isAdmin ? categoryScope : "personal" });
            message.success(text("技能库分类已创建", "Skill category created"));
            setCategoryEditorOpen(false);
            setCategoryName("");
            setLibraryCategoryId("all");
            setPage(1);
            reload();
        } catch (error) {
            message.error(localizedErrorMessage(error, "分类创建失败", "Could not create category", locale));
        } finally {
            setCategorySaving(false);
        }
    };

    const confirmDeleteLibraryCategory = (category: SkillLibraryCategory) => {
        modal.confirm({
            title: locale === "en-US" ? `Delete category "${category.name}"?` : `删除分类“${category.name}”？`,
            content: text("删除分类只会解除技能与该分类的关联，不会删除技能本身。", "Skills will be uncategorized, but they will not be deleted."),
            okText: text("删除分类", "Delete category"),
            okButtonProps: { danger: true },
            cancelText: text("取消", "Cancel"),
            onOk: async () => {
                try {
                    await deleteSkillLibraryCategory(category.id);
                    if (libraryCategoryId === category.id) setLibraryCategoryId("all");
                    message.success(text("分类已删除，技能仍保留在技能库中", "Category deleted. Skills remain in your library."));
                    reload();
                } catch (error) {
                    message.error(localizedErrorMessage(error, "分类删除失败", "Could not delete category", locale));
                    throw error;
                }
            },
        });
    };

    const assignLibraryCategory = async (skill: Skill, categoryId: string) => {
        setMutatingID(skill.skillId);
        try {
            const result = await setSkillLibraryCategory(skill.skillId, categoryId);
            patchSkill(result.skill);
            message.success(categoryId ? text("技能已归类", "Skill categorized") : text("已取消技能归类", "Skill uncategorized"));
            reload();
        } catch (error) {
            message.error(localizedErrorMessage(error, "技能归类失败", "Could not categorize skill", locale));
        } finally {
            setMutatingID("");
        }
    };

    const libraryCategories = libraryCategoryList?.categories ?? [];
    const marketplaceCategoryTotal = categories.every((category) => category.count !== undefined)
        ? categories.reduce((count, category) => count + (category.count ?? 0), 0)
        : "—";
    const renderSkillCard = (skill: Skill, index: number) => (
        <SkillCard
            key={skill.skillId}
            skill={skill}
            categories={categories}
            libraryCategories={libraryCategories}
            canCategorize={isLibraryScope}
            loading={mutatingID === skill.skillId}
            style={{ animationDelay: `${Math.min(index, 5) * 30}ms` }}
            onOpen={() => void openSkill(skill)}
            onAdd={() => void toggleAdded(skill)}
            onLike={() => void toggleLiked(skill)}
            onEdit={() => void openEditor(skill)}
            onDelete={() => confirmDelete(skill)}
            onSetLibraryCategory={(categoryId) => void assignLibraryCategory(skill, categoryId)}
        />
    );

    const skillContent = loading && !skills.length ? <SkillSkeleton /> : loadError ? <WorkspaceErrorState compact description={loadError} onRetry={reload} /> : isLibraryScope && skills.length ? (
        <div className="library-grid skill-library-grid">
            {skills.map(renderSkillCard)}
        </div>
    ) : !isLibraryScope && groupedSkills.length ? (
        <div key={`${scope}-${page}`} className="skills-scope-panel">
            {groupedSkills.map((group) => {
                const GroupIcon = categoryIconOf(group.value);
                return (
                    <section key={group.value} data-category={group.value} aria-labelledby={`skill-category-${group.value}`}>
                        <div className="skill-section-heading">
                            <h2 id={`skill-category-${group.value}`} className="flex items-center gap-2 text-base font-semibold text-foreground/75">
                                <span className="skill-group-icon"><GroupIcon /></span>
                                {skillCategoryLabel(group.value, categories, locale)}
                            </h2>
                            <span className="text-[var(--fs-label)] text-foreground/32">{locale === "en-US" ? `${group.skills.length} skills` : `${group.skills.length} 个`}</span>
                        </div>
                        <div className="library-grid skill-library-grid">
                            {group.skills.map(renderSkillCard)}
                        </div>
                    </section>
                );
            })}
        </div>
    ) : (
        <WorkspaceState
            compact
            className="min-h-[188px]"
            icon="skills"
            title={filtersActive ? text("没有找到匹配技能", "No matching skills") : scope === "created" ? text("还没有创建技能", "No skills created yet") : scope === "public" ? text("技能广场还是空的", "No public skills yet") : text("这里还没有技能", "No skills here yet")}
            description={filtersActive ? text("换个关键词或分类试试。", "Try another keyword or category.") : scope === "favorites" ? text("收藏的公开技能会显示在这里。", "Public skills you favorite will appear here.") : scope === "mine" ? text("从技能广场加入后会显示在这里。", "Skills you add from the marketplace will appear here.") : text("创建并公开第一个技能，其他用户就能直接加入使用。", "Create and publish a skill for others to use.")}
            action={filtersActive
                ? <Button onClick={resetFilters}>{text("清除筛选", "Clear filters")}</Button>
                : (scope === "created" || scope === "public")
                  ? <Button type="primary" icon={<Plus className="size-4" />} onClick={() => setInstallOpen(true)}>{text("安装技能", "Install skill")}</Button>
                  : undefined}
        />
    );

    return (
        <>
            <WorkspacePage className="library-page skills-library-page" grid>
                <PageHeader title={text("技能库", "Skill library")} description={text("把提示词、角色设定和创作方法，变成随时可用的能力。", "Keep prompts, character concepts, and creative methods ready to use.")} actions={<Button type="primary" icon={<Plus className="size-4" />} onClick={() => setInstallOpen(true)}>{text("安装技能", "Install skill")}</Button>} />

                <div className="skills-browse-bar">
                <div className="skills-navigation">
                    <div className="skills-tabs" ref={tabsRef} role="tablist" aria-label={text("技能库范围", "Skill library views")} onKeyDown={(event) => {
                        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                        event.preventDefault();
                        const current = scopeOptions.findIndex((option) => option.value === scope);
                        const next = event.key === "Home" ? 0 : event.key === "End" ? scopeOptions.length - 1 : (current + (event.key === "ArrowRight" ? 1 : -1) + scopeOptions.length) % scopeOptions.length;
                        setScope(scopeOptions[next].value as SkillScope);
                        setLibraryCategoryId("all");
                        setPage(1);
                        tabsRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
                    }}>
                        <span className="skills-tabs-indicator" ref={indicatorRef} aria-hidden="true" />
                        {scopeOptions.map((option) => {
                            const Icon = option.icon;
                            const active = scope === option.value;
                            const count = counts[option.value as SkillScope];
                            return (
                                <button
                                    key={option.value}
                                    type="button"
                                    role="tab"
                                    tabIndex={active ? 0 : -1}
                                    aria-selected={active}
                                    className={`skills-tab${active ? " is-active" : ""}`}
                                    onClick={() => { setScope(option.value as SkillScope); setLibraryCategoryId("all"); setPage(1); }}
                                >
                                    <Icon className="size-4" />
                                    <span>{locale === "en-US" ? ({ public: "Marketplace", mine: "My skills", created: "Created", favorites: "Favorites" } as Record<string, string>)[option.value] : option.label}</span>
                                    {count !== undefined ? <span className="skills-tab-count">{count}</span> : null}
                                </button>
                            );
                        })}
                    </div>
                </div>
                <CollectionToolbar active={filtersActive} onReset={resetFilters}>
                        <Input className="min-w-0 sm:!w-56" prefix={<Search className="size-4 text-foreground/38" />} value={search} allowClear placeholder={text("搜索技能或作者", "Search skills or creators")} onChange={(event) => { setSearch(event.target.value); setPage(1); }} />
                        <Select aria-label={text("技能排序", "Sort skills")} className="w-24" value={sort} options={sortOptions.map((option) => ({ ...option, label: locale === "en-US" ? ({ popular: "Most added", new: "Newest", updated: "Recently updated" } as Record<string, string>)[option.value] : option.label }))} onChange={(value) => { setSort(value); setPage(1); }} />
                </CollectionToolbar>
                </div>

                <div className="skills-library-layout">
                    <aside className="skills-library-sidebar" aria-label={text("技能分类筛选", "Skill category filters")}>
                        <section className="skills-category-section">
                            <div className="skills-library-sidebar-heading">
                                <div>
                                    <strong>{text("技能广场分类", "Marketplace categories")}</strong>
                                    <span>{text("筛选广场公开技能", "Filter public skills")}</span>
                                </div>
                            </div>
                            <nav className="skills-library-category-list" aria-label={text("技能广场分类", "Marketplace categories")}>
                                <button type="button" className={`skills-library-category-item${scope === "public" && tag === "all" ? " is-active" : ""}`} aria-pressed={scope === "public" && tag === "all"} onClick={() => selectMarketplaceCategory("all")}>
                                    <span><Sparkles className="size-4" aria-hidden="true" />{text("全部技能", "All skills")}</span>
                                    <span>{marketplaceCategoryTotal}</span>
                                </button>
                                {categories.map((category) => {
                                    const Icon = categoryIconOf(category.value);
                                    const active = scope === "public" && tag === category.value;
                                    return (
                                        <button key={category.value} type="button" className={`skills-library-category-item${active ? " is-active" : ""}`} aria-pressed={active} onClick={() => selectMarketplaceCategory(category.value)}>
                                            <span><Icon className="size-4" aria-hidden="true" />{skillCategoryLabel(category.value, categories, locale)}</span>
                                            <span>{category.count ?? "—"}</span>
                                        </button>
                                    );
                                })}
                            </nav>
                        </section>

                        <section className="skills-category-section">
                            <div className="skills-library-sidebar-heading">
                                <div>
                                    <strong>{text("我的技能分类", "My skill categories")}</strong>
                                </div>
                                <Button size="small" icon={<FolderPlus className="size-3.5" />} onClick={() => { setCategoryName(""); setCategoryScope("personal"); setCategoryEditorOpen(true); }}>{text("新建", "New")}</Button>
                            </div>
                            {libraryCategoryError ? <div className="skills-library-category-error" role="alert">{libraryCategoryError}<Button type="link" size="small" onClick={reload}>{text("重试", "Retry")}</Button></div> : null}
                            <nav className="skills-library-category-list" aria-label={text("我的技能分类", "My skill categories")}>
                                <button type="button" className={`skills-library-category-item${isLibraryScope && libraryCategoryId === "all" ? " is-active" : ""}`} aria-pressed={isLibraryScope && libraryCategoryId === "all"} onClick={() => selectLibraryCategory("all")}>
                                    <span><Library className="size-4" aria-hidden="true" />{text("全部技能", "All skills")}</span>
                                    <span>{libraryCategoryList?.totalCount ?? "—"}</span>
                                </button>
                                <button type="button" className={`skills-library-category-item${isLibraryScope && libraryCategoryId === "__uncategorized__" ? " is-active" : ""}`} aria-pressed={isLibraryScope && libraryCategoryId === "__uncategorized__"} onClick={() => selectLibraryCategory("__uncategorized__")}>
                                    <span><FolderInput className="size-4" aria-hidden="true" />{text("未分类", "Uncategorized")}</span>
                                    <span>{libraryCategoryList?.uncategorizedCount ?? "—"}</span>
                                </button>
                                {libraryCategories.map((category) => (
                                    <div key={category.id} className={`skills-library-category-row${isLibraryScope && libraryCategoryId === category.id ? " is-active" : ""}`}>
                                        <button type="button" className={`skills-library-category-item${isLibraryScope && libraryCategoryId === category.id ? " is-active" : ""}`} aria-pressed={isLibraryScope && libraryCategoryId === category.id} onClick={() => selectLibraryCategory(category.id)}>
                                            <span><FolderInput className="size-4" aria-hidden="true" />{category.name}</span>
                                            <span>{category.count}</span>
                                        </button>
                                        {category.scope === "personal" || isAdmin ? (
                                            <button type="button" className="skills-library-category-delete" aria-label={locale === "en-US" ? `Delete category ${category.name}` : `删除分类${category.name}`} title={text("删除分类", "Delete category")} onClick={() => confirmDeleteLibraryCategory(category)}>
                                                <Trash2 className="size-3.5" aria-hidden="true" />
                                            </button>
                                        ) : null}
                                    </div>
                                ))}
                            </nav>
                        </section>
                    </aside>
                    <div className="skills-library-results">{skillContent}</div>
                </div>

                <PaginationBar current={page} pageSize={pageSize} total={total} pageSizeOptions={[20, 40, 80]} onChange={(nextPage, nextPageSize) => { setPage(nextPageSize !== pageSize ? 1 : nextPage); setPageSize(nextPageSize); }} />
            </WorkspacePage>

            <AppModal
                open={categoryEditorOpen}
                title={(
                    <div className="skills-library-category-title">
                        <span className="skills-library-category-title-icon"><FolderPlus className="size-4" aria-hidden="true" /></span>
                        <span>
                            <small>{text("技能库整理", "Organize skills")}</small>
                            <strong>{text("新建分类", "New category")}</strong>
                        </span>
                    </div>
                )}
                className="library-modal skills-library-category-modal"
                width="min(480px, calc(100vw - 32px))"
                centered
                okText={text("创建分类", "Create category")}
                cancelText={text("取消", "Cancel")}
                okButtonProps={{ disabled: !categoryName.trim() }}
                confirmLoading={categorySaving}
                onOk={() => void saveLibraryCategory()}
                onCancel={() => setCategoryEditorOpen(false)}
                destroyOnHidden
            >
                <div className="skills-library-category-editor">
                    <div className="skills-library-category-field">
                        <label htmlFor="skills-library-category-name">{text("分类名称", "Category name")}</label>
                        <Input id="skills-library-category-name" autoFocus maxLength={64} showCount value={categoryName} onChange={(event) => setCategoryName(event.target.value)} onPressEnter={() => void saveLibraryCategory()} placeholder={text("例如：角色设定、分镜、宣发", "For example: Characters, Storyboards, Promotion")} />
                        <span className="skills-library-category-field-hint">{text("最多 64 个字符；名称不能与当前可用分类重名。", "Up to 64 characters. Use a unique name.")}</span>
                    </div>
                    {isAdmin ? (
                        <div className="skills-library-category-scope">
                            <span className="skills-library-category-field-label">{text("分类范围", "Category scope")}</span>
                            <div className="skills-library-category-scope-options" role="group" aria-label={text("分类范围", "Category scope")}>
                                <button type="button" className={`skills-library-category-scope-option${categoryScope === "personal" ? " is-active" : ""}`} aria-pressed={categoryScope === "personal"} onClick={() => setCategoryScope("personal")}>
                                    <span className="skills-library-category-scope-icon"><UserRound className="size-4" aria-hidden="true" /></span>
                                    <span className="skills-library-category-scope-copy"><strong>{text("个人分类", "Personal category")}</strong><small>{text("仅你自己可见和使用", "Only visible to you")}</small></span>
                                    {categoryScope === "personal" ? <Check className="skills-library-category-scope-check size-4" aria-hidden="true" /> : null}
                                </button>
                                <button type="button" className={`skills-library-category-scope-option${categoryScope === "platform" ? " is-active" : ""}`} aria-pressed={categoryScope === "platform"} onClick={() => setCategoryScope("platform")}>
                                    <span className="skills-library-category-scope-icon"><Globe2 className="size-4" aria-hidden="true" /></span>
                                    <span className="skills-library-category-scope-copy"><strong>{text("平台分类", "Platform category")}</strong><small>{text("所有用户可见、可分配", "Available to all users")}</small></span>
                                    {categoryScope === "platform" ? <Check className="skills-library-category-scope-check size-4" aria-hidden="true" /> : null}
                                </button>
                            </div>
                        </div>
                    ) : null}
                    <div className={`skills-library-category-note${categoryScope === "platform" && isAdmin ? " is-platform" : ""}`}>
                        <Sparkles className="size-4" aria-hidden="true" />
                        <p>{categoryScope === "platform" && isAdmin
                            ? text("平台分类对所有用户可见、可分配，并可用于各自的技能库和画布 Agent；不会替换技能广场分类。", "Platform categories are available in everyone's skill library and canvas Agent. Marketplace categories stay separate.")
                            : text("个人分类只影响你的技能库和画布 Agent。短剧影视、电商营销是技能广场的共享分类，可在左侧“技能广场分类”中筛选。", "Personal categories organize your library and canvas Agent. Shared marketplace categories remain in the left sidebar.")}</p>
                    </div>
                </div>
            </AppModal>
            <SkillDetailModal skill={activeSkill} loading={detailLoading} mutating={Boolean(activeSkill && mutatingID === activeSkill.skillId)} categories={categories} onClose={() => setActiveSkill(null)} onAdd={(skill) => void toggleAdded(skill)} onLike={(skill) => void toggleLiked(skill)} onEdit={(skill) => void openEditor(skill)} onSync={(skill) => void synchronizeSkill(skill)} />
            <SkillInstallModal open={installOpen} onClose={() => setInstallOpen(false)} onInstalled={(skill) => { setInstallOpen(false); setActiveSkill(skill); reload(); }} onManualCreate={() => { setInstallOpen(false); void openEditor(); }} />
            <SkillEditorDrawer open={editorOpen} skill={editingSkill} onClose={() => setEditorOpen(false)} onSaved={(skill) => { setEditorOpen(false); setEditingSkill(null); setActiveSkill(skill); reload(); }} />
        </>
    );
}

function SkillCard({ skill, categories, libraryCategories, canCategorize, loading, style, onOpen, onAdd, onLike, onEdit, onDelete, onSetLibraryCategory }: { skill: Skill; categories: SkillCategory[]; libraryCategories: SkillLibraryCategory[]; canCategorize: boolean; loading: boolean; style?: CSSProperties; onOpen: () => void; onAdd: () => void; onLike: () => void; onEdit: () => void; onDelete: () => void; onSetLibraryCategory: (categoryId: string) => void }) {
    const { locale, text } = useLocaleText();
    const CategoryIcon = categoryIconOf(skill.tag);
    const currentLibraryCategory = libraryCategories.find((category) => category.id === skill.libraryCategoryId);
    const libraryCategoryLabel = currentLibraryCategory?.name || (skill.libraryCategoryId ? text("已归类", "Categorized") : text("未分类", "Uncategorized"));
    return (
        <article style={style} className={`product-collection-card library-card library-card-surface skill-library-card group${skill.isAdded ? " is-added" : ""}`}>
            <div className="skill-card-top">
                <span className="library-icon-tile skill-card-icon" aria-hidden="true"><CategoryIcon /></span>
                <button type="button" className="skill-card-title-button" onClick={onOpen}>
                    <h3>{skill.skillName}</h3>
                </button>
                {canCategorize ? (
                    <Tooltip title={locale === "en-US" ? `Skill category: ${libraryCategoryLabel}` : `技能库分类：${libraryCategoryLabel}`}>
                        <Dropdown
                            trigger={["click"]}
                            menu={{
                                items: [
                                    { key: "__uncategorized__", label: text("未分类", "Uncategorized") },
                                    ...libraryCategories.map((category) => ({ key: category.id, label: category.name })),
                                ],
                                onClick: ({ key }) => onSetLibraryCategory(key === "__uncategorized__" ? "" : key),
                            }}
                        >
                            <button type="button" aria-label={locale === "en-US" ? `Set skill category, currently ${libraryCategoryLabel}` : `设置技能分类，当前为${libraryCategoryLabel}`} className="skill-card-category-picker" disabled={loading}>
                                <FolderInput className="size-4" aria-hidden="true" />
                                <span>{libraryCategoryLabel}</span>
                            </button>
                        </Dropdown>
                    </Tooltip>
                ) : null}
                {skill.isOwner ? (
                    <Dropdown
                        trigger={["click"]}
                        menu={{
                            items: [
                                { key: "edit", label: text("编辑技能", "Edit skill") },
                                { key: "delete", label: text("删除技能", "Delete skill"), danger: true },
                            ],
                            onClick: ({ key }) => key === "edit" ? onEdit() : onDelete(),
                        }}
                    >
                        <button type="button" aria-label={text("技能操作", "Skill actions")} className="skill-card-more">
                            <MoreHorizontal className="size-4" />
                        </button>
                    </Dropdown>
                ) : null}
            </div>
            <button type="button" className="skill-card-description" onClick={onOpen}>
                <p>{skill.description || text("暂无技能简介", "No description")}</p>
            </button>
            <div className="skill-card-footer">
                <button type="button" disabled={loading} className="skill-card-like" aria-label={skill.isLike ? text("取消收藏", "Remove from favorites") : text("收藏", "Add to favorites")} onClick={onLike}>
                    <Heart className={`size-3.5 ${skill.isLike ? "fill-current text-rose-500" : ""}`} />
                    <span>{formatSkillCount(skill.likeCount, locale)}</span>
                </button>
                <span className="skill-card-author">{skill.effectiveUser.name || text("未知用户", "Unknown user")}</span>
                <span className="skill-card-tag">{skillCategoryLabel(skill.tag, categories, locale)}</span>
                {skill.isPrivate ? <span className="skill-card-flag">{text("仅自己", "Private")}</span> : null}
            </div>
            {/* 加入是这个页面的主行为，给它完整的按钮 + 文案 + 已加入人数，不再藏在角落的加号里。 */}
            {skill.isOwner
                ? <div className="skill-card-action"><span className="skill-card-owner-flag">{text("我创建的", "Created by me")}</span><span className="skill-card-added-count">{locale === "en-US" ? `${formatSkillCount(skill.addedCount, locale)} added` : `${formatSkillCount(skill.addedCount, locale)} 人已加入`}</span></div>
                : (
                    <div className="skill-card-action">
                        <Button loading={loading} aria-pressed={skill.isAdded} icon={skill.isAdded ? <Check /> : <Plus />} onClick={onAdd}>
                            {skill.isAdded ? text("已加入", "Added") : text("加入技能库", "Add to library")}
                        </Button>
                        <Tooltip title={locale === "en-US" ? `${formatSkillCount(skill.addedCount, locale)} added` : `${formatSkillCount(skill.addedCount, locale)} 人已加入`}><span className="skill-card-added-count">{formatSkillCount(skill.addedCount, locale)}</span></Tooltip>
                    </div>
                )}
        </article>
    );
}

function SkillSkeleton() {
    return <div className="library-grid skill-library-grid py-6">{Array.from({ length: 8 }, (_, index) => <div key={index} className="h-[260px] animate-pulse rounded-[var(--r-xl)] bg-foreground/[.035]" />)}</div>;
}
