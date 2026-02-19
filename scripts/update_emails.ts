import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
    console.log('🔄 Starting email migration...')

    const emailMappings = [
        { old: 'admin@gmail.com', new: 'mongodb362@gmail.com' },
        { old: 'hr@gmail.com', new: 'hr.a10@gmail.com' }, // Assuming HR might also need a real one soon, but focusing on user's request
        { old: 'employee@gmail.com', new: 'bandelaajay362@gmail.com' },
        { old: 'manager@gmail.com', new: 'manager.a10@gmail.com' }
    ]

    for (const mapping of emailMappings) {
        // Update User
        const userUpdate = await prisma.user.updateMany({
            where: { email: mapping.old },
            data: { email: mapping.new }
        })

        // Update Employee
        const employeeUpdate = await prisma.employee.updateMany({
            where: { email: mapping.old },
            data: { email: mapping.new }
        })

        if (userUpdate.count > 0 || employeeUpdate.count > 0) {
            console.log(`✅ Updated ${mapping.old} -> ${mapping.new} (Users: ${userUpdate.count}, Employees: ${employeeUpdate.count})`)
        } else {
            console.log(`ℹ️ No records found for ${mapping.old}`)
        }
    }

    // Also update system settings if any
    const settingsUpdate = await prisma.systemSetting.updateMany({
        where: {
            key: 'company_email',
            value: 'info@cognitbotz.com'
        },
        data: { value: 'info@gmail.com' }
    })

    if (settingsUpdate.count > 0) {
        console.log(`✅ Updated company_email setting`)
    }

    console.log('🏁 Migration complete!')
}

main()
    .catch((e) => {
        console.error('❌ Error during migration:', e)
        process.exit(1)
    })
    .finally(async () => {
        await prisma.$disconnect()
    })
