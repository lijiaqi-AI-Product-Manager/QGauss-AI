import { isPool, Pool } from './ledger.service';

/** Shared by the public catalog and the actual chat preflight; token prices are usage-cost references. */
export function chatCharge(model: { countPool?: string; countCost?: number }, commerceEnabled: boolean, demoMode: boolean): { pool: Pool; amount: number } | null {
  const pool = model?.countPool;
  const amount = Number(model?.countCost);
  if (!commerceEnabled || demoMode || !pool || !isPool(pool) || !Number.isSafeInteger(amount) || amount <= 0 || amount > 2147483647) return null;
  return { pool, amount };
}

export function chatBilling(model: { countPool?: string; countCost?: number }, commerceEnabled: boolean, demoMode: boolean) {
  const charge = chatCharge(model, commerceEnabled, demoMode);
  return charge ? { mode: 'count', ...charge, reason: 'configured' } : { mode: 'none', pool: null, amount: 0, reason: demoMode ? 'demo' : !commerceEnabled ? 'commerce-disabled' : 'no-count-config' };
}
