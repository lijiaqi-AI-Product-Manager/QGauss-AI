// 给截图用的演示数据：分销员 + 佣金明细 + 待审核提现
// 只用于 artifacts/screenshots，不参与任何测试；跑在 demo.db 上。
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' }, select: { id: true, username: true } });
if (!admin) throw new Error('没有管理员账号，先跑 seed');

const sales = await prisma.salesUser.upsert({
  where: { userId: admin.id },
  create: {
    userId: admin.id,
    performanceBps: 1500,
    salesOutletName: '官方推广',
    totalCents: 38600,
    distributionCents: 28600,
    withdrawalCents: 10000,
    drawMoneyInCents: 10000,
    orderCount: 7,
  },
  update: { performanceBps: 1500, totalCents: 38600, distributionCents: 28600, withdrawalCents: 10000, drawMoneyInCents: 10000, orderCount: 7 },
});

await prisma.user.update({ where: { id: admin.id }, data: { isDistribution: true } });
if (!(await prisma.user.findFirst({ where: { id: admin.id }, select: { inviteCode: true } })).inviteCode) {
  await prisma.user.update({ where: { id: admin.id }, data: { inviteCode: 'QG88ADMIN' } });
}

// 佣金明细（3 条）
const existing = await prisma.salesRecord.count({ where: { inviterUserId: admin.id } });
if (existing === 0) {
  for (const [i, cents] of [990, 5900, 1990].entries()) {
    await prisma.salesRecord.create({
      data: {
        inviterUserId: admin.id,
        inviteeUserId: admin.id,
        orderId: `demo-order-${i + 1}`,
        orderCents: cents,
        commissionCents: Math.floor((cents * 1500) / 10_000),
        commissionBps: 1500,
      },
    });
  }
}

// 一条待审核提现
const pending = await prisma.salesOrder.count({ where: { userId: admin.id } });
if (pending === 0) {
  await prisma.salesOrder.create({
    data: { userId: admin.id, amountCents: 10000, channels: 1, contact: 'demo@example.com', remark: '演示数据' },
  });
}

console.log(`演示数据就绪：salesUser=${sales.id}`);
await prisma.$disconnect();
