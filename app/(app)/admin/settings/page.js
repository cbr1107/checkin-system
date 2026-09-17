import { requireRole, getSettings } from '@/lib/auth';
import SettingsForm from './SettingsForm';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  await requireRole('admin');
  const settings = await getSettings();

  return (
    <main className="page">
      <div className="page-head">
        <h1>系統設定</h1>
        <p>這些設定會套用到所有子活動；個別活動另有覆寫時以活動設定為準。</p>
      </div>

      <SettingsForm
        displayFields={settings.display_fields || { fields: [] }}
        offlineCheckin={settings.offline_checkin || { enabled: true }}
      />
    </main>
  );
}
