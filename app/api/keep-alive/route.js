import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

/**
 * 保活端點。
 *
 * Supabase 免費方案在 7 天內活動量過低就會暫停專案，
 * 由 vercel.json 的排程每天打一次，製造最低限度的資料庫活動。
 * 只做一次計數查詢，不讀取也不寫入任何個人資料。
 */
export async function GET(request) {
  // Vercel 排程會帶 CRON_SECRET；有設定就驗，沒設定就當公開端點
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }

  try {
    const admin = createAdminClient();
    const { count, error } = await admin
      .from('app_settings')
      .select('key', { count: 'exact', head: true });

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message, at: new Date().toISOString() },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      settings: count ?? 0,
      at: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err.message, at: new Date().toISOString() },
      { status: 500 }
    );
  }
}
