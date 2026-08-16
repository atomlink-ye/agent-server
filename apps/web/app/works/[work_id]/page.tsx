import { WorkDetailShell } from '@/components/work/work-shell';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

export default async function WorkDetailPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ work_id: string }>;
  readonly searchParams: Promise<
    Record<string, string | string[] | undefined>
  >;
}) {
  const [{ work_id: workId }, query] = await Promise.all([params, searchParams]);
  return (
    <WorkDetailShell
      workId={workId}
      tab={firstQueryValue(query.tab)}
      selectedRunId={firstQueryValue(query.run)}
    />
  );
}

function firstQueryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
