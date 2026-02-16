
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('--- USERS ---');
    const users = await prisma.user.findMany({
        include: { employee: true }
    });
    users.forEach(u => {
        console.log(`ID: ${u.id}, Email: ${u.email}, Role: ${u.role}, EmpID: ${u.employee?.id}`);
    });

    console.log('\n--- LEAVE REQUESTS ---');
    const leaves = await prisma.leaveRequest.findMany({
        include: {
            employee: true,
            approvals: {
                include: { approver: true }
            }
        },
        orderBy: { createdAt: 'desc' },
        take: 5
    });

    leaves.forEach(l => {
        console.log(`Req: ${l.requestNumber}, Status: ${l.status}, Employee: ${l.employee.firstName}, Applied: ${l.createdAt}`);
        console.log(`Approvals: ${l.approvals.length}`);
        l.approvals.forEach(a => {
            console.log(`  - Approver: ${a.approver.firstName}, Status: ${a.status}`);
        });
    });

    console.log('\n--- LEAVE APPROVALS ---');
    const approvals = await prisma.leaveApproval.findMany({
        include: {
            approver: true,
            leaveRequest: { include: { employee: true } }
        }
    });
    approvals.forEach(a => {
        console.log(`ID: ${a.id}, Approver: ${a.approver.firstName}, For: ${a.leaveRequest.employee.firstName}, Status: ${a.status}`);
    });
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
