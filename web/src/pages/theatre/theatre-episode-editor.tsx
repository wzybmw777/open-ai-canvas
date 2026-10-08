import { useRef } from "react";
import { App, Button, Input } from "antd";
import { ArrowDown, ArrowUp, Files, Trash2 } from "lucide-react";
import { useLocaleText } from "@/lib/i18n";
import { episodeDraftsFromFiles, isTheatreVideoFile, moveEpisode, type TheatreEpisodeDraft } from "./theatre-episode-drafts";

export function TheatreEpisodeEditor({ episodes, disabled, onChange }: { episodes: TheatreEpisodeDraft[]; disabled: boolean; onChange: (episodes: TheatreEpisodeDraft[]) => void }) {
    const { text } = useLocaleText();
    const { message } = App.useApp();
    const input = useRef<HTMLInputElement>(null);
    const addFiles = (files: File[]) => {
        if (disabled || files.length === 0) return;
        if (episodes.length + files.length > 200) {
            message.warning(text("一部短剧最多支持 200 集", "A short drama can have up to 200 episodes"));
            return;
        }
        if (!files.every(isTheatreVideoFile)) {
            message.warning(text("请选择非空的视频文件", "Choose non-empty video files"));
            return;
        }
        onChange([...episodes, ...episodeDraftsFromFiles(files)]);
    };
    return (
        <section className="mb-5" aria-label={text("短剧集数", "Short drama episodes")}>
            <button
                type="button"
                disabled={disabled}
                className="flex w-full flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-surface p-5 text-muted-foreground hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
                onClick={() => input.current?.click()}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                    event.preventDefault();
                    addFiles(Array.from(event.dataTransfer.files));
                }}
            >
                <Files className="size-6" aria-hidden />
                <strong className="text-[var(--fs-body)] text-foreground">{text("批量选择或拖入各集视频", "Choose or drop episode videos")}</strong>
                <span className="text-[var(--fs-caption)]">{text("按文件名中的数字排序，发布前可调整顺序；支持继续补集", "Files are sorted by number. Reorder them before publishing and add more later.")}</span>
            </button>
            <input
                hidden
                ref={input}
                type="file"
                multiple
                accept="video/*,.mp4,.mov,.webm,.m4v,.mkv,.avi"
                disabled={disabled}
                onChange={(event) => {
                    addFiles(Array.from(event.target.files || []));
                    event.currentTarget.value = "";
                }}
            />
            <div className="mt-3 flex items-center justify-between text-[var(--fs-caption)] text-muted-foreground">
                <span>{text(`共 ${episodes.length} 集`, `${episodes.length} episodes`)}</span>
                <span>{text("列表顺序就是播放顺序", "List order is playback order")}</span>
            </div>
            <ol className="mt-2 flex max-h-72 flex-col gap-2 overflow-y-auto">
                {episodes.map((episode, index) => (
                    <li key={episode.key} className="flex items-center gap-2 rounded-lg border border-border bg-surface p-2">
                        <span className="w-12 shrink-0 text-[var(--fs-caption)] font-medium text-muted-foreground">{text(`第 ${index + 1} 集`, `Ep. ${index + 1}`)}</span>
                        <div className="min-w-0 flex-1">
                            <Input
                                aria-label={text(`第 ${index + 1} 集标题`, `Episode ${index + 1} title`)}
                                value={episode.title}
                                maxLength={120}
                                disabled={disabled}
                                onChange={(event) => onChange(episodes.map((item) => (item.key === episode.key ? { ...item, title: event.target.value } : item)))}
                            />
                            <p className="mt-1 truncate text-[var(--fs-caption)] text-muted-foreground">{episode.file?.name || text("已发布视频", "Published video")}</p>
                        </div>
                        <div className="flex shrink-0 gap-1">
                            <Button
                                size="small"
                                disabled={disabled || index === 0}
                                aria-label={text(`第 ${index + 1} 集上移`, `Move episode ${index + 1} up`)}
                                icon={<ArrowUp className="size-3.5" />}
                                onClick={() => onChange(moveEpisode(episodes, index, -1))}
                            />
                            <Button
                                size="small"
                                disabled={disabled || index === episodes.length - 1}
                                aria-label={text(`第 ${index + 1} 集下移`, `Move episode ${index + 1} down`)}
                                icon={<ArrowDown className="size-3.5" />}
                                onClick={() => onChange(moveEpisode(episodes, index, 1))}
                            />
                            <Button
                                size="small"
                                danger
                                disabled={disabled}
                                aria-label={text(`移除第 ${index + 1} 集`, `Remove episode ${index + 1}`)}
                                icon={<Trash2 className="size-3.5" />}
                                onClick={() => onChange(episodes.filter((item) => item.key !== episode.key))}
                            />
                        </div>
                    </li>
                ))}
            </ol>
        </section>
    );
}
