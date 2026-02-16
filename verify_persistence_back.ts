
import { PrismaClient } from '@prisma/client'
import * as fs from 'fs'

const prisma = new PrismaClient()

async function main() {
    console.log('Connecting to DB from BACKEND...')
    // Verify user exists and verify if backend sees the change made by frontend
    const email = 'employee@cognitbotz.com'
    const user = await prisma.user.findUnique({
        where: { email },
        include: { employee: true }
    })

    if (!user) {
        console.log(`User ${email} not found!`)
        return
    }

    const output = {
        userId: user.id,
        employeeName: user.employee ? `${user.employee.firstName} ${user.employee.lastName}` : null,
        employeeImage: user.employee?.profileImage
    }

    fs.writeFileSync('result.json', JSON.stringify(output, null, 2))
    console.log('Written to result.json')
}

main()
    .catch(e => console.error(e))
    .finally(async () => {
        await prisma.$disconnect()
    })
