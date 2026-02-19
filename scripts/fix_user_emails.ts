import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
    console.log('--- REFINED CONSOLIDATION START ---')

    const configs = [
        {
            target: 'mongodb362@gmail.com',
            variants: ['admin@gmail.com', 'admin@cognitbotz.com', 'mongodb362@gmail.com']
        },
        {
            target: 'bandelaajay362@gmail.com',
            variants: ['employee@gmail.com', 'bandelajay362@gmail.com', 'bandelaajay362@gmail.com', 'employee@cognitbotz.com']
        }
    ]

    for (const config of configs) {
        console.log(`\nTarget: ${config.target}`)

        // Find all matching users/employees
        const users = await prisma.user.findMany({ where: { email: { in: config.variants } } })
        const employees = await prisma.employee.findMany({
            where: {
                OR: [
                    { email: { in: config.variants } },
                    { userId: { in: users.map(u => u.id) } }
                ]
            }
        })

        console.log(`  Users: ${users.length}, Employees: ${employees.length}`)

        // Pick Primary User and Primary Employee
        let primaryUser = users.find(u => u.email === config.target) || users[0]
        let primaryEmployee = employees.find(e => e.email === config.target) || employees[0]

        if (!primaryUser || !primaryEmployee) {
            console.log('  Missing user or employee record to start with.')
            continue
        }

        // 1. Prepare Primary Employee to be linked ONLY to Primary User
        // We update it to have the correct email and temporary unique employeeId if needed,
        // but better to just fix email and userId.
        await prisma.employee.update({
            where: { id: primaryEmployee.id },
            data: {
                email: config.target,
                userId: primaryUser.id
            }
        })
        console.log(`  Updated Primary Employee ${primaryEmployee.id} to email ${config.target}`)

        // 2. Clear out all other employees in the variant group
        for (const emp of employees) {
            if (emp.id === primaryEmployee.id) continue
            console.log(`  Deleting duplicate employee: ${emp.id} (${emp.email})`)
            await prisma.employee.delete({ where: { id: emp.id } })
        }

        // 3. Clear out all other users in the variant group
        for (const user of users) {
            if (user.id === primaryUser.id) continue
            console.log(`  Deleting duplicate user: ${user.id} (${user.email})`)
            await prisma.user.delete({ where: { id: user.id } })
        }

        // 4. Finally ensure Primary User has correct email
        await prisma.user.update({
            where: { id: primaryUser.id },
            data: { email: config.target }
        })
        console.log(`  Updated Primary User ${primaryUser.id} to email ${config.target}`)
    }

    console.log('\n--- REFINED CONSOLIDATION FINISHED ---')
}

main()
    .catch((e) => {
        console.error(e)
        process.exit(1)
    })
    .finally(async () => {
        await prisma.$disconnect()
    })
