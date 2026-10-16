// 创作页空态的纵深图片画廊：卡片沿 Z 轴前后排队，当前一张在最前、最大，
// 其余依次后退缩小，像展厅里一排挂在纵深上的画。
// 拖动、滚轮、方向键或按钮切换，切换靠 CSS transition 平滑过渡。
// 卡片是带玻璃质感边框的实体面板，不做弧形、也不压成薄片。
// 展示内容跟随下方输入框的创作类型：选视频就只排队视频灵感，选图片就只排队图片灵感。
//
// 队列是「随机取样」而不是固定切片：每次进场、每次换创作类型都会重新抽一批，
// 并且记住最近出现过哪些，避免用户反复看到同样那几张。
//
// 池子不打包，走 public/inspirations/gallery-pool.json：几百条连提示词正文一起
// 就是几百 KB，压进首屏 JS 是白背的，而这份数据只服务这一处。
//
// 先保留画廊和卡片位置，再让封面淡入；首屏直接加载中心及左右三张，共七张，
// 更远的两张在短暂延迟后补齐，切换时不会出现空白。

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { ArrowUp } from "lucide-react";

import { catalogIdOf, curatedInspirations, type CreationInspiration } from "@/lib/inspirations/catalog";
import { fillablePrompt } from "@/lib/inspirations/resolve";
import { loadGalleryPool } from "@/services/inspiration-catalog";
import type { CreationMode } from "./creation-types";
import { createGalleryWheelGesture } from "./creation-gallery-gesture";
import "./creation-inspiration-tunnel.css";

/** 画廊里排队展示的照片数，取奇数，两侧层数才对得齐。 */
const GALLERY_SIZE = 11;
/** 每后退一层的纵深（px）。 */
const STEP_Z = 150;
/** 虚拟焦距，只用来算出"后退一层缩多少"，不再是 CSS perspective。 */
const PERSPECTIVE = 1200;
/** 最多同时可见的层数，再远就隐掉。 */
const MAX_DEPTH = 3;
/** 每一层的透明度，越靠后越淡，做出空气透视。 */
const DEPTH_OPACITY = [1, 0.98, 0.95, 0.91, 0.86];
/** 记住最近展示过的条目数，换页/刷新时不会又抽到同一批。 */
const RECENT_MEMORY = 66;
const RECENT_KEY = "yingce:creation-gallery-recent";
const GALLERY_DRAG_AXIS_THRESHOLD = 10;
const GALLERY_SWIPE_THRESHOLD = 52;
/**
 * 等封面的兜底时长。正常情况下封面几百毫秒就回来了，这条不会生效；
 * 万一某张请求挂住不回，也不能让队列永远缺一块，超时就先放行。
 */
const COVER_FALLBACK_MS = 8000;

/**
 * 把"离眼睛多远"换算成这一层的等比缩放。
 * 原先交给 CSS perspective 做，但每帧的投影光栅化太贵；
 * 平面卡片在固定 z 上做投影变换，结果恰好就是等比缩放加向中轴平移，所以自己算更省。
 */
function depthScale(depth: number): number {
    return PERSPECTIVE / (PERSPECTIVE + STEP_Z * depth);
}

function shuffled<T>(list: T[]): T[] {
    const next = [...list];
    for (let index = next.length - 1; index > 0; index -= 1) {
        const swap = Math.floor(Math.random() * (index + 1));
        [next[index], next[swap]] = [next[swap], next[index]];
    }
    return next;
}

function readRecent(mode: CreationMode): string[] {
    try {
        const raw = window.sessionStorage.getItem(`${RECENT_KEY}:${mode}`);
        const parsed = raw ? (JSON.parse(raw) as unknown) : null;
        return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
    } catch {
        return [];
    }
}

function writeRecent(mode: CreationMode, ids: string[]) {
    try {
        window.sessionStorage.setItem(`${RECENT_KEY}:${mode}`, JSON.stringify(ids.slice(-RECENT_MEMORY)));
    } catch {
        // 隐私模式下 sessionStorage 可能不可用；退化成每次纯随机，不影响功能。
    }
}

/** 随机抽一批：先挑没在最近出现过的，不够再用出现过的补齐，抽完把结果记进"最近"。 */
function pickBatch(pool: CreationInspiration[], size: number, mode: CreationMode): CreationInspiration[] {
    if (pool.length <= size) return shuffled(pool);
    const recent = new Set(readRecent(mode));
    const byFreshness = [...shuffled(pool.filter((item) => !recent.has(catalogIdOf(item)))), ...shuffled(pool.filter((item) => recent.has(catalogIdOf(item))))];
    const picked = byFreshness.slice(0, size);
    writeRecent(mode, [...recent, ...picked.map(catalogIdOf)]);
    return picked;
}

/**
 * 画廊只服务鼠标氛围：读屏与键盘用户走输入框和快捷入口创作，
 * 所以卡片整体对辅助技术隐藏、也不进 Tab 顺序；左右切换按钮仍可聚焦，
 * 当前展示的是哪一张由下面那条 aria-live 文本播报。
 */
export function CreationInspirationTunnel({ mode, onStartPrompt, composing = false }: { mode: CreationMode; onStartPrompt: (mode: CreationMode, prompt: string) => void; composing?: boolean }) {
    /**
     * 外部 gallery-pool.json 是单独一份静态 JSON，不打包；首屏先使用打包的本地精选图，
     * 等浏览器空闲后再扩充随机池，避免 JSON 请求挡住第一张图片。
     */
    const [pool, setPool] = useState<CreationInspiration[]>(() => curatedInspirations);
    const poolReady = true;
    const [shots, setShots] = useState<CreationInspiration[]>([]);
    const [active, setActive] = useState(0);
    const [readyIds, setReadyIds] = useState<ReadonlySet<string>>(() => new Set());
    const [failedIds, setFailedIds] = useState<ReadonlySet<string>>(() => new Set());
    // 首屏直接准备中心及左右各三张，共七张，避免先显示三张空壳再延迟补图。
    const [loadDepth, setLoadDepth] = useState(3);
    const stageRef = useRef<HTMLDivElement>(null);
    const dragRef = useRef<{ pointerId: number; startX: number; startY: number; axis: "horizontal" | "vertical" | null; moved: boolean } | null>(null);
    const suppressClickRef = useRef(false);

    const modePool = useMemo(() => pool.filter((item) => item.mode === mode), [pool, mode]);
    useEffect(() => {
        if (composing) return;
        let alive = true;
        // 加载器不会 reject：拉不到就保留打包的原创条目，画廊宁可少几张也不该空着。
        const load = () => {
            void loadGalleryPool().then((entries) => {
                if (!alive) return;
                setPool(entries);
            });
        };
        let timer: number | undefined;
        let idleHandle: number | undefined;
        if (typeof window.requestIdleCallback === "function") {
            idleHandle = window.requestIdleCallback(load, { timeout: 1200 });
        } else {
            timer = window.setTimeout(load, 350);
        }
        return () => {
            alive = false;
            if (idleHandle !== undefined && typeof window.cancelIdleCallback === "function") window.cancelIdleCallback(idleHandle);
            if (timer !== undefined) window.clearTimeout(timer);
        };
    }, [composing]);

    // 抽一批的时机只有两个：池子到货（含进场），以及换创作类型。
    useEffect(() => {
        if (!poolReady) return;
        setShots(pickBatch(modePool, GALLERY_SIZE, mode));
        setActive(0);
        setLoadDepth(3);
    }, [mode, modePool, poolReady]);

    /** 封面就绪（含加载失败）后放行这张卡。失败的也要放行，否则卡片永远不出现。 */
    const markReady = useCallback((id: string) => {
        setReadyIds((current) => (current.has(id) ? current : new Set(current).add(id)));
    }, []);

    // 兜底放行：请求挂住不返回时，到点把这一批全部放出来，宁可露出空面板也不留缺口。
    useEffect(() => {
        if (!shots.length) return;
        const timer = window.setTimeout(() => {
            setReadyIds((current) => new Set([...current, ...shots.map(catalogIdOf)]));
        }, COVER_FALLBACK_MS);
        return () => window.clearTimeout(timer);
    }, [shots]);

    const step = useCallback(
        (delta: number) => {
            if (!shots.length) return;
            setActive((current) => (current + delta + shots.length) % shots.length);
        },
        [shots.length],
    );

    /** 横向拖拽切换，纵向手势交还给页面滚动。 */
    const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
        if (event.pointerType === "mouse" && event.button !== 0) return;
        suppressClickRef.current = false;
        dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, axis: null, moved: false };
    }, []);

    const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        const deltaX = event.clientX - drag.startX;
        const deltaY = event.clientY - drag.startY;
        if (!drag.axis && Math.max(Math.abs(deltaX), Math.abs(deltaY)) >= GALLERY_DRAG_AXIS_THRESHOLD) {
            drag.axis = Math.abs(deltaX) > Math.abs(deltaY) ? "horizontal" : "vertical";
        }
        if (drag.axis === "horizontal") {
            // 普通点击保留卡片作为目标，确认拖拽后才由舞台接管指针。
            if (!event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.setPointerCapture(event.pointerId);
            drag.moved = true;
            event.preventDefault();
        }
    }, []);

    const finishPointerDrag = useCallback(
        (event: ReactPointerEvent<HTMLDivElement>) => {
            const drag = dragRef.current;
            if (!drag || drag.pointerId !== event.pointerId) return;
            const deltaX = event.clientX - drag.startX;
            const shouldAdvance = event.type !== "pointercancel" && drag.axis === "horizontal" && Math.abs(deltaX) >= GALLERY_SWIPE_THRESHOLD;
            if (drag.moved) suppressClickRef.current = true;
            dragRef.current = null;
            if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
            if (shouldAdvance) step(deltaX < 0 ? 1 : -1);
        },
        [step],
    );

    // 只在画廊区域消费滚轮，缩放手势仍由浏览器处理。
    useEffect(() => {
        const node = stageRef.current;
        if (!node) return;
        const gesture = createGalleryWheelGesture();
        const handleWheel = (event: WheelEvent) => {
            if (event.ctrlKey || shots.length < 2) return;
            const rawDelta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
            const delta = rawDelta * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? node.clientHeight : 1);
            if (Math.abs(delta) < 0.5) return;
            event.preventDefault();
            const direction = gesture(delta, performance.now());
            if (direction) step(direction);
        };
        node.addEventListener("wheel", handleWheel, { passive: false });
        return () => node.removeEventListener("wheel", handleWheel);
    }, [step, shots.length]);

    const current = shots[active];

    if (!shots.length) return <div className="creation-inspiration-tunnel is-loading" aria-busy="true"><div className="creation-gallery-stage"><span className="creation-gallery-placeholder" aria-hidden /></div></div>;

    return (
        <div className="creation-inspiration-tunnel" role="region" aria-label="灵感轮播，左右滑动或使用方向键切换，回车使用当前创意" tabIndex={0}
            onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return;
                if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                    event.preventDefault();
                    step(event.key === "ArrowLeft" ? -1 : 1);
                } else if (event.key === "Enter" && current) {
                    event.preventDefault();
                    onStartPrompt(current.mode, fillablePrompt(current));
                }
            }}
            >
            <div
                ref={stageRef}
                className="creation-gallery-stage"
                aria-hidden="true"
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={finishPointerDrag}
                onPointerCancel={finishPointerDrag}
            >
                {shots.map((inspiration, index) => {
                    const id = catalogIdOf(inspiration);
                    // 相对当前卡片的距离，绕成最短路径，形成首尾相接的队列。
                    const half = Math.floor(shots.length / 2);
                    const relative = ((index - active + half + shots.length) % shots.length) - half;

                    const depth = Math.abs(relative);
                    // 超出可见层数就靠透明度淡出，不切 visibility——
                    // 硬切会让最远那张在过渡中途"啪"地消失。
                    const style = {
                        "--card-x": `calc(${relative} * var(--gallery-step))`,
                        "--card-scale": depthScale(depth).toFixed(4),
                        "--card-depth-opacity": depth > MAX_DEPTH ? "0" : `${DEPTH_OPACITY[depth]}`,
                        zIndex: `${100 - depth}`,
                    } as CSSProperties;

                    return (
                        <button
                            key={id}
                            type="button"
                            tabIndex={-1}
                            className={`creation-tunnel-card ${depth === 0 ? "is-active" : ""} ${readyIds.has(id) ? "is-ready" : "is-loading"}`}
                            style={style}
                            onClick={() => {
                                if (suppressClickRef.current) {
                                    suppressClickRef.current = false;
                                    return;
                                }
                                onStartPrompt(inspiration.mode, fillablePrompt(inspiration));
                            }}
                        >
                            {depth <= loadDepth && !failedIds.has(id) ? <img
                                src={inspiration.image}
                                alt=""
                                draggable={false}
                                decoding="async"
                                loading={depth === 0 ? "eager" : "lazy"}
                                fetchPriority={depth === 0 ? "high" : "low"}
                                onLoad={() => markReady(id)}
                                onError={() => { setFailedIds((current) => new Set(current).add(id)); markReady(id); }}
                                // 命中浏览器缓存的图可能在挂监听之前就 complete 了，onLoad 不会再触发，这里补一次。
                                ref={(node) => {
                                    if (node?.complete && node.naturalWidth > 0) markReady(id);
                                }}
                            /> : <span className="creation-gallery-placeholder" aria-hidden />}
                            {failedIds.has(id) ? <span className="creation-gallery-image-error">封面暂不可用，仍可使用这个创意</span> : null}
                            {/* 三段式提示词信息：行动点、标题、描述，只有最前那张露出来。 */}
                            <span className="creation-tunnel-card-info">
                                <span className="creation-tunnel-card-cta">
                                    <ArrowUp aria-hidden="true" />
                                    使用这个创意
                                </span>
                                <span className="creation-tunnel-card-title">{inspiration.title}</span>
                                <span className="creation-tunnel-card-desc">{inspiration.description}</span>
                            </span>
                        </button>
                    );
                })}
            </div>

            {/* 卡片本身对辅助技术隐藏，切换结果靠这条播报传达。 */}
            <p className="creation-gallery-announce" aria-live="polite">
                {current ? `${current.title}：${current.description}` : ""}
            </p>
        </div>
    );
}
