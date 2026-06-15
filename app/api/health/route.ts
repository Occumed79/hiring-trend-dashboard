export async function GET() {
  return Response.json({ ok: true, service: "hiring-trend-dashboard", awake: true });
}

export async function HEAD() {
  return new Response(null, { status: 200 });
}
