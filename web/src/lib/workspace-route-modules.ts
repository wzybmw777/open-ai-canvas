const workspaceRouteLoaders = {
    assets: () => import("@/pages/assets"),
    inspirations: () => import("@/pages/inspirations"),
    theatre: () => import("@/pages/theatre"),
    canvas: () => import("@/pages/canvas"),
    create: () => import("@/pages/create"),
    projects: () => import("@/pages/projects"),
    projectDetail: () => import("@/pages/projects/detail"),
};

export const loadAssetsPage = workspaceRouteLoaders.assets;
export const loadTheatrePage = workspaceRouteLoaders.theatre;
export const loadCanvasPage = workspaceRouteLoaders.canvas;
export const loadCanvasProjectPage = () => import("@/pages/canvas/project");
export const loadCreatePage = workspaceRouteLoaders.create;
export const loadProjectDetailPage = workspaceRouteLoaders.projectDetail;
export const loadProjectsPage = workspaceRouteLoaders.projects;

export function preloadWorkspaceRoute(pathnameOrSlug: string) {
    // 根路径就是创作页，预加载时仍映射到其内部模块名。
    const segments = pathnameOrSlug.replace(/^\//, "").split("/").filter(Boolean);
    const slug = segments[0] || "create";
    // 具体画布项目由 /canvas/:id 自己加载；不要在认证恢复阶段额外预加载画布列表。
    if (slug === "canvas" && segments.length > 1) return;
    const load = slug === "projects" && segments.length > 1
        ? workspaceRouteLoaders.projectDetail
        : workspaceRouteLoaders[slug as keyof typeof workspaceRouteLoaders];
    if (!load) return;

    // 路由组件本身会在渲染时加载；预热只应利用空闲时间，不能和首屏 CSS、认证及图片争抢带宽。
    const start = () => void load();
    if (typeof window === "undefined") {
        start();
    } else if (typeof window.requestIdleCallback === "function") {
        window.requestIdleCallback(start, { timeout: 1500 });
    } else {
        window.setTimeout(start, 800);
    }
}
