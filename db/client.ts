import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);
export default sql;

export async function query(text: string, params?: any[]) {
  if (params) {
    return await sql(text, params);
  }
  return await sql(text);
}
