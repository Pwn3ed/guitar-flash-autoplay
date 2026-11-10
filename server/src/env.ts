export interface Env {
  DB: D1Database;
  BACKUP: R2Bucket;
  LIMITE?: RateLimit;
  PAINEL_SENHA?: string;
}
