CREATE INDEX orders_payPlatform_paydAt_idx ON orders(payPlatform,paydAt);

CREATE TABLE payment_statements (
  id TEXT NOT NULL PRIMARY KEY,
  provider TEXT NOT NULL,
  fileName TEXT NOT NULL,
  contentHash TEXT NOT NULL,
  importedBy TEXT NOT NULL,
  fromDay TEXT NOT NULL DEFAULT '',
  throughDay TEXT NOT NULL DEFAULT '',
  paymentCents BIGINT NOT NULL,
  refundCents BIGINT NOT NULL,
  feeCents BIGINT,
  importedCount INTEGER NOT NULL,
  matchedCount INTEGER NOT NULL,
  missingCount INTEGER NOT NULL,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX payment_statements_provider_contentHash_key ON payment_statements(provider,contentHash);
CREATE INDEX payment_statements_createdAt_idx ON payment_statements(createdAt);

CREATE TABLE payment_statement_rows (
  id TEXT NOT NULL PRIMARY KEY,
  statementId TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  sourceLine INTEGER,
  kind TEXT NOT NULL,
  eventRef TEXT NOT NULL DEFAULT '',
  orderRef TEXT NOT NULL DEFAULT '',
  tradeRef TEXT NOT NULL DEFAULT '',
  occurredAt DATETIME NOT NULL,
  amountCents INTEGER,
  feeCents INTEGER,
  localOrderId TEXT NOT NULL DEFAULT '',
  localAmountCents INTEGER,
  findingCodes TEXT NOT NULL,
  state TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (statementId) REFERENCES payment_statements(id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX payment_statement_rows_statementId_ordinal_key ON payment_statement_rows(statementId,ordinal);
CREATE INDEX payment_statement_rows_statementId_state_ordinal_idx ON payment_statement_rows(statementId,state,ordinal);

CREATE TABLE payment_statement_decisions (
  id TEXT NOT NULL PRIMARY KEY,
  rowId TEXT NOT NULL,
  revision INTEGER NOT NULL,
  state TEXT NOT NULL,
  note TEXT NOT NULL,
  actorId TEXT NOT NULL,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (rowId) REFERENCES payment_statement_rows(id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX payment_statement_decisions_rowId_revision_key ON payment_statement_decisions(rowId,revision);

INSERT INTO menus(id,parentId,title,path,icon,sort,roles,titleEn,titleTw,standardKey,createdAt,updatedAt)
SELECT 'qgauss-payment-statements-menu',parent.id,'商户账单','/admin/orders/statements','file',
       COALESCE((SELECT MAX(item.sort) FROM menus item WHERE item.parentId=parent.id AND item.deletedAt IS NULL),0)+10,
       'ADMIN','Merchant statements','商戶帳單','paymentStatements',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
FROM menus parent
WHERE parent.standardKey='ops' AND parent.deletedAt IS NULL AND parent.kind='group'
  AND NOT EXISTS (
    SELECT 1 FROM menus existing
    WHERE existing.id='qgauss-payment-statements-menu' OR existing.path='/admin/orders/statements'
       OR existing.standardKey='paymentStatements'
  )
ORDER BY parent.sort,parent.id
LIMIT 1;
