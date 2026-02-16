import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const email1 = 'bandelaajay362@gmail.com'; // What user is typing
    const email2 = 'bandelajay362@gmail.com';  // What likely exists (23 chars)

    console.log(`Checking for '${email1}'...`);
    const user1 = await prisma.user.findUnique({ where: { email: email1 } });
    if (user1) console.log(`✅ FOUND '${email1}'`);
    else console.log(`❌ NOT FOUND '${email1}'`);

    console.log(`Checking for '${email2}'...`);
    const user2 = await prisma.user.findUnique({ where: { email: email2 } });
    if (user2) console.log(`✅ FOUND '${email2}'`);
    else console.log(`❌ NOT FOUND '${email2}'`);
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
