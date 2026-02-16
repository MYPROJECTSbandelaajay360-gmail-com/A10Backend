import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const oldEmail = 'bandelajay362@gmail.com';
    const newEmail = 'bandelaajay362@gmail.com';

    console.log(`Attempting to update email from '${oldEmail}' to '${newEmail}'...`);

    try {
        const user = await prisma.user.update({
            where: { email: oldEmail },
            data: { email: newEmail }
        });
        console.log(`✅ Successfully updated email for user ID: ${user.id}`);
        console.log(`New Email: ${user.email}`);
    } catch (error) {
        console.error(`❌ Failed to update email:`, error);
    }
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
