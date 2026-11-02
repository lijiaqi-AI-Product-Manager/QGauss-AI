import { AsyncLocalStorage } from 'node:async_hooks';
import { PrismaClient } from '@prisma/client';

let transactionTail: Promise<void> = Promise.resolve();
const transactionScope = new AsyncLocalStorage<boolean>();

/** One SQLite writer per process; database locks still protect other processes. */
export class SqliteClient extends PrismaClient {
  async drainTransactions() { await transactionTail; }

  override $transaction: PrismaClient['$transaction'] = ((input: any, options: any) => {
    if (transactionScope.getStore()) return Promise.reject(new Error('Nested transactions must use the provided transaction client'));
    const execute = () => typeof input === 'function'
      ? super.$transaction(tx => transactionScope.run(true, () => input(tx)), options)
      : super.$transaction(input, options);
    const result = transactionTail.then(execute);
    transactionTail = result.then(() => undefined, () => undefined);
    return result;
  }) as PrismaClient['$transaction'];
}
