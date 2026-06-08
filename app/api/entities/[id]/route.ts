import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/db/client';

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const rows = await query(`SELECT * FROM entities WHERE id = $1`, [params.id]);
  if (!rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(rows[0]);
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json();
  const fields = Object.keys(body);
  if (!fields.length) return NextResponse.json({ error: 'No fields' }, { status: 400 });
  const sets = fields.map((f, i) => `${f} = $${i + 2}`).join(', ');
  const values = fields.map(f => body[f]);
  const rows = await query(
    `UPDATE entities SET ${sets}, updated_at = NOW() WHERE id = $1 RETURNING *`,
    [params.id, ...values]
  );
  return NextResponse.json(rows[0]);
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  await query(`UPDATE entities SET is_active = false WHERE id = $1`, [params.id]);
  return NextResponse.json({ success: true });
}
