import { WorkListShell } from '@/components/work/work-shell';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

export default function WorksPage() {
  return <WorkListShell />;
}
