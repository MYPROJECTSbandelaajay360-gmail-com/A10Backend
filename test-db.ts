
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    try {
        console.log('Connecting to database...');
        await prisma.$connect();
        console.log('Connected!');

        const users = await prisma.user.findMany({ take: 1 });
        console.log('Users found:', users.length);
        if (users.length > 0) {
            console.log('First user:', users[0]);
        }

    } catch (error: any) {
        console.error('Database error full:', JSON.stringify(error, null, 2));
        console.error('Error message:', error.message);
        console.error('Error code:', error.code);
        console.error('Error meta:', error.meta);
    } finally {
        await prisma.$disconnect();
    }
}

main();
