import { useEffect, useRef, useState, type ImgHTMLAttributes, type ReactNode } from "react";

import { getResourceAccess, resolveResourceAccessURL, resourceIdFromStorageKey, type ResourceAccessVariant } from "@/services/api/resources";
import { getActiveUserScope } from "@/lib/user-scope";
import { resolveImageUrl } from "@/services/image-storage";
import { prepareCanvasImage } from "@/services/canvas-image-loader";

type CachedResourceImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
    storageKey?: string;
    src?: string;
    fallback?: ReactNode;
    loadingFallback?: ReactNode;
    eager?: boolean;
    variant?: ResourceAccessVariant;
    retryable?: boolean;
};

/**
 * 远程资源图片统一使用 OSS/CDN 授权地址。
 * Blob 缓存仍可用于导出、抽帧等字节处理，但不作为媒体展示 src，避免把
 * `blob:http(s)://...` 泄露到节点、素材库和浏览器媒体链路中。
 */
export function CachedResourceImage({ storageKey, src = "", fallback, loadingFallback, eager = false, variant = "original", retryable = false, onError, ...props }: CachedResourceImageProps) {
    const resourceId = resourceIdFromStorageKey(storageKey);
    const remoteResource = Boolean(resourceId);
    const localImageResource = Boolean(storageKey && storageKey.startsWith("image:"));
    const scope = getActiveUserScope();
    const identity = `${scope}:${resourceId || storageKey || src}`;
    const targetRef = useRef<HTMLSpanElement>(null);
    const [nearViewport, setNearViewport] = useState(eager || !remoteResource);
    const [displayed, setDisplayed] = useState<{ identity: string; src: string } | null>(null);
    const displayedRef = useRef(displayed);
    displayedRef.current = displayed;
    const [failedIdentity, setFailedIdentity] = useState("");
    const [retry, setRetry] = useState(0);
    const cachedSrc = displayed?.identity === identity ? displayed.src : "";

    useEffect(() => {
        if (!remoteResource || eager) {
            setNearViewport(true);
            return;
        }
        const image = targetRef.current;
        if (!image || typeof IntersectionObserver === "undefined") {
            setNearViewport(true);
            return;
        }
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries.some((entry) => entry.isIntersecting)) {
                    setNearViewport(true);
                    observer.disconnect();
                }
            },
            { rootMargin: "240px" },
        );
        observer.observe(image);
        return () => observer.disconnect();
    }, [eager, remoteResource]);

    useEffect(() => {
        if (remoteResource && !nearViewport) return;
        const controller = new AbortController();
        let cancelled = false;
        let refreshTimer: ReturnType<typeof setTimeout> | undefined;
        let refreshAttempts = 0;
        let loadSequence = 0;
        const isCurrent = () => !cancelled && !controller.signal.aborted && getActiveUserScope() === scope;
        const load = async () => {
            const sequence = ++loadSequence;
            let candidate = src;
            if (remoteResource && resourceId) {
                try {
                    const access = await getResourceAccess(storageKey, "display", variant, "", { forceRefresh: retry > 0 });
                    candidate = resolveResourceAccessURL(access.url);
                    if (variant === "thumbnail" && access.actualVariant !== "thumbnail" && refreshAttempts < 3) {
                        refreshAttempts += 1;
                        refreshTimer = setTimeout(() => { if (isCurrent()) void load().catch(() => {}); }, 2_000);
                    }
                } catch (error) {
                    if (variant !== "thumbnail") throw error;
                    const access = await getResourceAccess(storageKey, "display", "original");
                    candidate = resolveResourceAccessURL(access.url);
                }
            } else if (localImageResource && storageKey) {
                candidate = (await resolveImageUrl(storageKey, src)) || src;
            }
            if (!candidate) throw new Error("图片地址为空");
            try {
                await prepareCanvasImage(candidate, controller.signal);
            } catch (error) {
                if (!remoteResource || variant !== "thumbnail") {
                    if (candidate !== src && src) { await prepareCanvasImage(src, controller.signal); candidate = src; }
                    else throw error;
                } else {
                    const access = await getResourceAccess(storageKey, "display", "original");
                    const originalURL = resolveResourceAccessURL(access.url);
                    if (!originalURL || originalURL === candidate) throw error;
                    await prepareCanvasImage(originalURL, controller.signal);
                    candidate = originalURL;
                }
            }
            if (isCurrent() && sequence === loadSequence) {
                setDisplayed({ identity, src: candidate });
                setFailedIdentity("");
            }
        };
        void load().catch(() => {
            if (isCurrent() && displayedRef.current?.identity !== identity) setFailedIdentity(identity);
        });
        return () => {
            cancelled = true;
            controller.abort();
            if (refreshTimer) clearTimeout(refreshTimer);
        };
    }, [identity, localImageResource, nearViewport, remoteResource, resourceId, scope, src, storageKey, variant, retry]);

    const handleImgError = (e: React.SyntheticEvent<HTMLImageElement, Event>) => {
        if (localImageResource && storageKey && cachedSrc.startsWith("blob:")) {
            void resolveImageUrl(storageKey)
                .then((url) => {
                    if (url && url !== cachedSrc) {
                        const controller = new AbortController();
                        void prepareCanvasImage(url, controller.signal)
                            .then(() => setDisplayed({ identity, src: url }))
                            .catch(() => {
                                setFailedIdentity(identity);
                                onError?.(e);
                            });
                        return;
                    }
                    setFailedIdentity(identity);
                    onError?.(e);
                })
                .catch(() => {
                    setFailedIdentity(identity);
                    onError?.(e);
                });
            return;
        }
        setFailedIdentity(identity);
        onError?.(e);
    };

    const loadingState = loadingFallback ?? <span className={`cached-resource-image-placeholder ${props.className || ""}`} style={props.style} role="status" aria-label="图片加载中" />;
    const errorState = <span className="cached-resource-image-error">{fallback ?? <span role="status">图片暂不可用</span>}{retryable ? <button type="button" data-canvas-no-zoom onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); setFailedIdentity(""); setRetry((value) => value + 1); }} aria-label="重新加载图片">重试</button> : null}</span>;
    if (failedIdentity === identity) return errorState;
    if (!remoteResource && cachedSrc) return <img {...props} src={cachedSrc} onError={handleImgError} />;
    return (
        <span ref={targetRef} className="cached-resource-image-shell">
            {cachedSrc ? <img {...props} src={cachedSrc} onError={handleImgError} /> : loadingState}
        </span>
    );
}
