import { Blocks, CircleDollarSign, Clapperboard, Film, GalleryVerticalEnd, Images, LibraryBig, ListTodo, PanelsTopLeft, Settings, WandSparkles } from "lucide-react";

export const navigationTools = [
    {
        slug: "create",
        label: "创作",
        icon: WandSparkles,
        section: "创作空间",
    },
    {
        slug: "inspirations",
        label: "灵感库",
        icon: GalleryVerticalEnd,
    },
    {
        slug: "projects",
        label: "项目",
        icon: Clapperboard,
        section: "创作空间",
    },
    {
        slug: "canvas",
        label: "画布",
        icon: PanelsTopLeft,
        section: "创作空间",
    },
    {
        slug: "tasks",
        label: "生成任务",
        icon: ListTodo,
        section: "创作空间",
    },
    {
        slug: "theatre",
        label: "作品与发布",
        icon: Film,
        section: "创作空间",
    },
    {
        slug: "assets",
        label: "素材库",
        icon: Images,
        section: "创作空间",
    },
    {
        slug: "skills",
        label: "技能库",
        icon: LibraryBig,
        section: "工作台管理",
    },
    {
        slug: "plugins",
        label: "插件中心",
        icon: Blocks,
        section: "工作台管理",
    },
    {
        slug: "wallet",
        label: "积分中心",
        icon: CircleDollarSign,
        section: "工作台管理",
    },
    {
        slug: "rewards",
        label: "成长计划",
        icon: WandSparkles,
        section: "工作台管理",
    },
    {
        slug: "settings",
        label: "设置",
        icon: Settings,
        section: "工作台管理",
    },
] as const;

export type NavigationToolSlug = (typeof navigationTools)[number]["slug"];
