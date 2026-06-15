import { NextRequest, NextResponse } from 'next/server';
import { resolveCompany } from '@/lib/ingest/companyResolver';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const name = String(body.name || '').trim();
  const careerPageUrl = body.career_page_url ? String(body.career_page_url) : null;

  if (!name) {
    return NextResponse.json({ error: 'name required' }, { status: 400 });
  }

  const result = await resolveCompany(name, careerPageUrl);
  return NextResponse.json(result);
}
