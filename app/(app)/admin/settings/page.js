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
      </div>

      <SettingsForm
        displayFields={settings.display_fields || { fields: [] }}
        offlineCheckin={settings.offline_checkin || { enabled: true }}
      />
    </main>
  );
}
