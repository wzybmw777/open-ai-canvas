import { HardDrive } from "lucide-react";

import { useAccountFileStorageUsage } from "@/hooks/use-account-file-storage-usage";
import { accountFileStorageUsageQueryKey, accountStorageMeter, formatStorageBytes } from "@/lib/account-storage-usage";
import { useLocaleText } from "@/lib/i18n";

export const assetStorageUsageQueryKey = accountFileStorageUsageQueryKey;

export function AssetStorageUsage() {
    const { locale, text } = useLocaleText();
    const query = useAccountFileStorageUsage();
    const usage = query.data;
    const meter = accountStorageMeter(usage);

    return (
        <section
            className={`assets-storage-usage${meter.full ? " is-full" : ""}${usage?.usedBytes ? " has-usage" : ""}`}
            aria-label={text("账号文件容量", "Account file storage")}
            aria-busy={query.isPending}
            title={text("包含素材文件和 Agent 会话附件", "Includes asset files and Agent conversation attachments")}
        >
            <span className="assets-storage-usage-icon" aria-hidden="true">
                <HardDrive />
            </span>
            <span className="assets-storage-usage-title">{text("账号容量", "Storage")}</span>
            {usage ? (
                <>
                    <span className="assets-storage-usage-value">
                        {formatStorageBytes(usage.usedBytes)} / {formatStorageBytes(usage.totalBytes)}
                    </span>
                    <span
                        className="assets-storage-usage-track"
                        role="progressbar"
                        aria-label={text("账号文件容量使用进度", "Account storage usage")}
                        aria-valuemin={0}
                        aria-valuemax={usage.totalBytes}
                        aria-valuenow={Math.min(usage.usedBytes, usage.totalBytes)}
                        aria-valuetext={locale === "en-US" ? `${formatStorageBytes(usage.usedBytes)} used of ${formatStorageBytes(usage.totalBytes)}` : `已使用 ${formatStorageBytes(usage.usedBytes)}，总容量 ${formatStorageBytes(usage.totalBytes)}`}
                    >
                        <span style={{ width: `${meter.percent}%` }} />
                    </span>
                    <span className="assets-storage-usage-percent">{meter.percentLabel}</span>
                </>
            ) : query.isError ? (
                <span className="assets-storage-usage-status">
                    {text("容量统计暂时不可用。", "Storage usage is temporarily unavailable.")}
                    <button type="button" onClick={() => void query.refetch()}>
                        {text("重试", "Retry")}
                    </button>
                </span>
            ) : (
                <span className="assets-storage-usage-status">{text("正在统计已用容量…", "Calculating storage usage…")}</span>
            )}
        </section>
    );
}
