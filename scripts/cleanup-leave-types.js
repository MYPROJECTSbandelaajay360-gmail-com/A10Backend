const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    // First show all leave types
    const types = await prisma.leaveTypeConfig.findMany({
        select: { id: true, name: true, isActive: true }
    });
    console.log('Current leave types:');
    console.log(JSON.stringify(types, null, 2));

    // Deactivate unwanted types
    const unwanted = ['Maternity Leave', 'Paternity Leave', 'Unpaid Leave', 'Compensatory Off'];

    const result = await prisma.leaveTypeConfig.updateMany({
        where: {
            name: { in: unwanted }
        },
        data: {
            isActive: false
        }
    });

    console.log(`\nDeactivated ${result.count} leave types: ${unwanted.join(', ')}`);

    // Show remaining active types
    const active = await prisma.leaveTypeConfig.findMany({
        where: { isActive: true },
        select: { id: true, name: true, isActive: true }
    });
    console.log('\nRemaining active leave types:');
    console.log(JSON.stringify(active, null, 2));
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
