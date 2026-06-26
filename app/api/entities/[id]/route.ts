import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/db/client';

const ALLOWED_UPDATE_FIELDS = new Set([
  'name',
  'aliases',
  'portal',
  'career_page_url',
  'ats_provider',
  'ats_board_id',
  'industry',
  'category',
  'is_active',
]);

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  try {
    const rows = await query(`SELECT * FROM entities WHERE id = $1`, [params.id]);
    if (!rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(rows[0]);
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const entries = Object.entries(body).filter(([field, value]) => ALLOWED_UPDATE_FIELDS.has(field) && value !== undefined);
    if (!entries.length) {
      return NextResponse.json({ error: 'No allowed fields provided' }, { status: 400 });
    }

    const sets = entries.map(([field], index) => `${field} = $${index + 2}`).join(', ');
    const values = entries.map(([field, value]) => field === 'aliases' && !Array.isArray(value) ? [] : value);
    const rows = await query(
      `UPDATE entities SET ${sets}, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [params.id, ...values]
    );

    if (!rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(rows[0]);
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  try {
    const rows = await query(`UPDATE entities SET is_active = false, updated_at = NOW() WHERE id = $1 RETURNING id`, [params.id]);
    if (!rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unexpected server error';
}
