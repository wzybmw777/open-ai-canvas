import { lazy, Suspense, useRef } from "react";
import { Button, Spin, Tabs } from "antd";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { Image, Video } from "lucide-react";

import { WorkspacePage, PageHeader } from "@/components/layout/workspace-page";
import { WorkspaceState } from "@/components/layout/workspace-state";
import { useLocaleText } from "@/lib/i18n";
import { refreshFeatureAvailability } from "@/lib/user-session";
import { useUserStore } from "@/stores/use-user-store";

const ImageWatermarkPanel = lazy(() => import("./image-watermark-page"));
const VideoWatermarkPanel = lazy(() => import("./video-watermark-page"));

export default function WatermarkRoute() {
    const userID = useUserStore((state) => state.user?.id);
    return <WatermarkPage key={userID} userID={userID || ""} />;
}

function WatermarkPage({ userID }: { userID: string }) {
    const { text } = useLocaleText();
    const features = useUserStore((state) => state.features);
    const [params, setParams] = useSearchParams();
    const panels = useRef<HTMLDivElement>(null);
    const availability = useQuery({ queryKey: ["watermark-features", userID], queryFn: refreshFeatureAvailability, enabled: Boolean(userID), refetchOnMount: "always", refetchOnWindowFocus: false });
    const mode = params.get("type") === "video" && features.videoWorkbenchEnabled ? "video" : features.imageWorkbenchEnabled ? "image" : "video";
    const loading = <p role="status" className="py-6 text-sm"><Spin size="small" /> {text("正在读取工作台…", "Loading workspace…")}</p>;

    return <WorkspacePage>
        <PageHeader title={text("AI 去水印", "AI watermark removal")} description={text("选择图片或视频，使用平台模型修复水印，原文件独立保留。", "Remove image or video watermarks with platform models while keeping the original file.")} />
        {availability.isPending ? loading : availability.error ? <div role="alert" className="mt-5 flex items-center gap-3 text-sm text-destructive"><span>{text("无法确认功能开放状态", "Could not check feature availability")}</span><Button onClick={() => void availability.refetch()}>{text("重试", "Retry")}</Button></div> : !features.imageWorkbenchEnabled && !features.videoWorkbenchEnabled ? <WorkspaceState icon="empty" title={text("AI 去水印暂未开放", "AI watermark removal is unavailable")} description={text("当前功能已由平台管理员关闭。", "This feature is currently disabled by the platform administrator.")} /> : <div ref={panels}><Tabs
            className="mt-4"
            activeKey={mode}
            destroyOnHidden={false}
            onChange={(value) => {
                panels.current?.querySelectorAll("video").forEach((video) => video.pause());
                setParams((current) => { const next = new URLSearchParams(current); next.set("type", value); return next; });
            }}
            items={[
                { key: "image", label: <span className="inline-flex items-center gap-2"><Image className="size-4" />{text("图片去水印", "Images")}</span>, disabled: !features.imageWorkbenchEnabled, children: features.imageWorkbenchEnabled ? <Suspense fallback={loading}><ImageWatermarkPanel userID={userID} /></Suspense> : null },
                { key: "video", label: <span className="inline-flex items-center gap-2"><Video className="size-4" />{text("视频去水印", "Videos")}</span>, disabled: !features.videoWorkbenchEnabled, children: features.videoWorkbenchEnabled ? <Suspense fallback={loading}><VideoWatermarkPanel userID={userID} /></Suspense> : null },
            ]}
        /></div>}
    </WorkspacePage>;
}
