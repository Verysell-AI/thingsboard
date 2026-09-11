import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import type { AdminJob } from '@platform/shared/dto';
import { useAdminJob } from '~/lib/admin';

/** Live log of a provisioning task; calls `onDone` once when it finishes. */
export function JobProgress({
  jobId,
  onDone,
}: {
  jobId: string;
  onDone?: (job: AdminJob) => void;
}) {
  const { t } = useTranslation();
  const job = useAdminJob(jobId);
  const notified = useRef(false);
  const status = job.data?.status;

  useEffect(() => {
    if (!job.data || status === 'running' || notified.current) return;
    notified.current = true;
    onDone?.(job.data);
  }, [job.data, status, onDone]);

  const icon =
    status === 'succeeded' ? (
      <CheckCircle2 className="size-4 text-emerald-600" />
    ) : status === 'failed' ? (
      <XCircle className="size-4 text-destructive" />
    ) : (
      <Loader2 className="size-4 animate-spin text-muted-foreground" />
    );

  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-card p-4">
      <div className="flex items-center gap-2 text-sm font-medium">
        {icon}
        <span>{t(`admin.job.${status ?? 'running'}`)}</span>
      </div>
      {job.data?.error && <p className="text-sm text-destructive">{job.data.error}</p>}
      <pre className="max-h-64 overflow-auto rounded-md bg-muted/50 p-3 text-xs leading-5 whitespace-pre-wrap">
        {(job.data?.log ?? []).join('\n') || t('admin.job.starting')}
      </pre>
    </div>
  );
}
