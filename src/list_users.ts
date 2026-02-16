import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('Fetching users...');
    const users = await prisma.user.findMany({
        select: {
            email: true,
            role: true,
            status: true
        }
    });

    console.log(`Total users found: ${users.length}`);

    users.forEach(u => {
        console.log(`Email: '${u.email}' (Length: ${u.email.length})`);
    });
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
