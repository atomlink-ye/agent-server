import { WorkDetailShell } from '@/components/work/work-shell';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

export default async function WorkDetailPage({
  params,
}: {
  readonly params: Promise<{ work_id: string }>;
}) {
  const { work_id: workId } = await params;
  return <WorkDetailShell workId={workId} />;
}
