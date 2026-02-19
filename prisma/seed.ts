import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
    console.log('🌱 Starting database seeding...')

    // Clean up existing data
    console.log('🧹 Cleaning database...')
    const cleanup = [
        prisma.auditLog.deleteMany(),
        prisma.notification.deleteMany(),
        prisma.leaveApproval.deleteMany(),
        prisma.leaveRequest.deleteMany(),
        prisma.leaveBalance.deleteMany(),
        prisma.attendance.deleteMany(),
        prisma.payrollRecord.deleteMany(),
        prisma.payslip.deleteMany(),
        prisma.salaryDetail.deleteMany(),
        prisma.salaryStructure.deleteMany(),
        prisma.offerLetter.deleteMany(),
        prisma.employee.deleteMany(),
        prisma.account.deleteMany(),
        prisma.session.deleteMany(),
        prisma.verificationToken.deleteMany(),
        prisma.user.deleteMany(),
        prisma.department.deleteMany(),
        prisma.designation.deleteMany(),
        prisma.shift.deleteMany(),
        prisma.leaveTypeConfig.deleteMany(),
        prisma.salaryComponent.deleteMany(),
        prisma.holiday.deleteMany(),
        prisma.systemSetting.deleteMany(),
    ]

    try {
        await Promise.all(cleanup)
        console.log('✅ Database cleaned')
    } catch (error) {
        console.error('⚠️ Error cleaning database:', error)
        // Continue anyway as tables might not exist or be empty
    }

    // Create Departments
    console.log('Creating departments...')
    const departments = await Promise.all([
        prisma.department.upsert({
            where: { code: 'ENG' },
            update: {},
            create: { name: 'Engineering', code: 'ENG', description: 'Software Development & Engineering' }
        }),
        prisma.department.upsert({
            where: { code: 'HR' },
            update: {},
            create: { name: 'Human Resources', code: 'HR', description: 'Human Resources & Administration' }
        }),
        prisma.department.upsert({
            where: { code: 'FIN' },
            update: {},
            create: { name: 'Finance', code: 'FIN', description: 'Finance & Accounting' }
        }),
        prisma.department.upsert({
            where: { code: 'MKT' },
            update: {},
            create: { name: 'Marketing', code: 'MKT', description: 'Marketing & Communications' }
        }),
        prisma.department.upsert({
            where: { code: 'SAL' },
            update: {},
            create: { name: 'Sales', code: 'SAL', description: 'Sales & Business Development' }
        }),
        prisma.department.upsert({
            where: { code: 'OPS' },
            update: {},
            create: { name: 'Operations', code: 'OPS', description: 'Operations & Support' }
        })
    ])
    console.log(`✅ Created ${departments.length} departments`)

    // Create Designations
    console.log('Creating designations...')
    const designations = await Promise.all([
        prisma.designation.upsert({
            where: { code: 'CEO' },
            update: {},
            create: { name: 'Chief Executive Officer', code: 'CEO', level: 1 }
        }),
        prisma.designation.upsert({
            where: { code: 'CTO' },
            update: {},
            create: { name: 'Chief Technology Officer', code: 'CTO', level: 1 }
        }),
        prisma.designation.upsert({
            where: { code: 'HRM' },
            update: {},
            create: { name: 'HR Manager', code: 'HRM', level: 2 }
        }),
        prisma.designation.upsert({
            where: { code: 'ENGM' },
            update: {},
            create: { name: 'Engineering Manager', code: 'ENGM', level: 2 }
        }),
        prisma.designation.upsert({
            where: { code: 'SRDEV' },
            update: {},
            create: { name: 'Senior Developer', code: 'SRDEV', level: 3 }
        }),
        prisma.designation.upsert({
            where: { code: 'DEV' },
            update: {},
            create: { name: 'Developer', code: 'DEV', level: 4 }
        }),
        prisma.designation.upsert({
            where: { code: 'JRDEV' },
            update: {},
            create: { name: 'Junior Developer', code: 'JRDEV', level: 5 }
        }),
        prisma.designation.upsert({
            where: { code: 'HRE' },
            update: {},
            create: { name: 'HR Executive', code: 'HRE', level: 4 }
        }),
        prisma.designation.upsert({
            where: { code: 'ACC' },
            update: {},
            create: { name: 'Accountant', code: 'ACC', level: 4 }
        }),
        prisma.designation.upsert({
            where: { code: 'MKTL' },
            update: {},
            create: { name: 'Marketing Lead', code: 'MKTL', level: 3 }
        }),
        prisma.designation.upsert({
            where: { code: 'SALE' },
            update: {},
            create: { name: 'Sales Executive', code: 'SALE', level: 4 }
        })
    ])
    console.log(`✅ Created ${designations.length} designations`)

    // Create Shifts
    console.log('Creating shifts...')
    const shifts = await Promise.all([
        prisma.shift.upsert({
            where: { name: 'General' },
            update: {},
            create: {
                name: 'General',
                startTime: '09:00',
                endTime: '18:00',
                breakMinutes: 60,
                graceMinutes: 15,
                halfDayMinutes: 240,
                isFlexible: false,
                weekDays: JSON.stringify([1, 2, 3, 4, 5])
            }
        }),
        prisma.shift.upsert({
            where: { name: 'Morning' },
            update: {},
            create: {
                name: 'Morning',
                startTime: '06:00',
                endTime: '15:00',
                breakMinutes: 60,
                graceMinutes: 15,
                halfDayMinutes: 240,
                isFlexible: false,
                weekDays: JSON.stringify([1, 2, 3, 4, 5])
            }
        }),
        prisma.shift.upsert({
            where: { name: 'Flexible' },
            update: {},
            create: {
                name: 'Flexible',
                startTime: '08:00',
                endTime: '20:00',
                breakMinutes: 60,
                graceMinutes: 120,
                halfDayMinutes: 240,
                isFlexible: true,
                flexibleHours: 8,
                weekDays: JSON.stringify([1, 2, 3, 4, 5])
            }
        })
    ])
    console.log(`✅ Created ${shifts.length} shifts`)

    // Create Leave Types
    console.log('Creating leave types...')
    const leaveTypes = await Promise.all([
        prisma.leaveTypeConfig.upsert({
            where: { code: 'CL' },
            update: {},
            create: {
                name: 'Casual Leave',
                code: 'CL',
                description: 'Leave for personal matters',
                defaultBalance: 12,
                maxCarryForward: 0,
                isEncashable: false,
                isPaidLeave: true,
                requiresApproval: true,
                minDaysNotice: 1,
                maxConsecutiveDays: 3,
                isActive: true
            }
        }),
        prisma.leaveTypeConfig.upsert({
            where: { code: 'SL' },
            update: {},
            create: {
                name: 'Sick Leave',
                code: 'SL',
                description: 'Leave due to illness',
                defaultBalance: 10,
                maxCarryForward: 0,
                isEncashable: false,
                isPaidLeave: true,
                requiresApproval: true,
                requiresDocument: true,
                documentAfterDays: 3,
                minDaysNotice: 0,
                maxConsecutiveDays: 5,
                isActive: true
            }
        }),
        prisma.leaveTypeConfig.upsert({
            where: { code: 'EL' },
            update: {},
            create: {
                name: 'Earned Leave',
                code: 'EL',
                description: 'Earned/Privilege leave',
                defaultBalance: 15,
                maxCarryForward: 30,
                isEncashable: true,
                isPaidLeave: true,
                requiresApproval: true,
                minDaysNotice: 7,
                maxConsecutiveDays: 15,
                isActive: true
            }
        }),
        prisma.leaveTypeConfig.upsert({
            where: { code: 'CO' },
            update: {},
            create: {
                name: 'Compensatory Off',
                code: 'CO',
                description: 'Comp off for working on holidays',
                defaultBalance: 0,
                maxCarryForward: 0,
                isEncashable: false,
                isPaidLeave: true,
                requiresApproval: true,
                minDaysNotice: 1,
                maxConsecutiveDays: 1,
                isActive: true
            }
        }),
        prisma.leaveTypeConfig.upsert({
            where: { code: 'UL' },
            update: {},
            create: {
                name: 'Unpaid Leave',
                code: 'UL',
                description: 'Leave without pay',
                defaultBalance: 99,
                maxCarryForward: 0,
                isEncashable: false,
                isPaidLeave: false,
                requiresApproval: true,
                minDaysNotice: 7,
                maxConsecutiveDays: 30,
                isActive: true
            }
        }),
        prisma.leaveTypeConfig.upsert({
            where: { code: 'ML' },
            update: {},
            create: {
                name: 'Maternity Leave',
                code: 'ML',
                description: 'Maternity leave for female employees',
                defaultBalance: 182,
                maxCarryForward: 0,
                isEncashable: false,
                isPaidLeave: true,
                requiresApproval: true,
                requiresDocument: true,
                minDaysNotice: 30,
                applicableGender: 'FEMALE',
                isActive: true
            }
        }),
        prisma.leaveTypeConfig.upsert({
            where: { code: 'PL' },
            update: {},
            create: {
                name: 'Paternity Leave',
                code: 'PL',
                description: 'Paternity leave for male employees',
                defaultBalance: 5,
                maxCarryForward: 0,
                isEncashable: false,
                isPaidLeave: true,
                requiresApproval: true,
                requiresDocument: true,
                minDaysNotice: 7,
                applicableGender: 'MALE',
                isActive: true
            }
        })
    ])
    console.log(`✅ Created ${leaveTypes.length} leave types`)

    // Create Salary Components
    console.log('Creating salary components...')
    const salaryComponents = await Promise.all([
        prisma.salaryComponent.upsert({
            where: { code: 'BASIC' },
            update: {},
            create: {
                name: 'Basic Salary',
                code: 'BASIC',
                type: 'EARNING',
                isFixed: true,
                isTaxable: true,
                description: 'Basic salary component',
                isActive: true
            }
        }),
        prisma.salaryComponent.upsert({
            where: { code: 'HRA' },
            update: {},
            create: {
                name: 'House Rent Allowance',
                code: 'HRA',
                type: 'EARNING',
                isFixed: true,
                isTaxable: true,
                description: 'House rent allowance',
                isActive: true
            }
        }),
        prisma.salaryComponent.upsert({
            where: { code: 'SA' },
            update: {},
            create: {
                name: 'Special Allowance',
                code: 'SA',
                type: 'EARNING',
                isFixed: true,
                isTaxable: true,
                description: 'Special allowance',
                isActive: true
            }
        }),
        prisma.salaryComponent.upsert({
            where: { code: 'CA' },
            update: {},
            create: {
                name: 'Conveyance Allowance',
                code: 'CA',
                type: 'EARNING',
                isFixed: true,
                isTaxable: true,
                description: 'Conveyance/Transport allowance',
                isActive: true
            }
        }),
        prisma.salaryComponent.upsert({
            where: { code: 'MA' },
            update: {},
            create: {
                name: 'Medical Allowance',
                code: 'MA',
                type: 'EARNING',
                isFixed: true,
                isTaxable: true,
                description: 'Medical allowance',
                isActive: true
            }
        }),
        prisma.salaryComponent.upsert({
            where: { code: 'LTA' },
            update: {},
            create: {
                name: 'Leave Travel Allowance',
                code: 'LTA',
                type: 'EARNING',
                isFixed: true,
                isTaxable: false,
                description: 'Leave travel allowance',
                isActive: true
            }
        }),
        prisma.salaryComponent.upsert({
            where: { code: 'PF' },
            update: {},
            create: {
                name: 'Provident Fund',
                code: 'PF',
                type: 'STATUTORY',
                isFixed: false,
                isTaxable: false,
                percentage: 12,
                calculationBase: 'BASIC',
                description: 'Employee Provident Fund',
                isActive: true
            }
        }),
        prisma.salaryComponent.upsert({
            where: { code: 'PT' },
            update: {},
            create: {
                name: 'Professional Tax',
                code: 'PT',
                type: 'STATUTORY',
                isFixed: true,
                isTaxable: false,
                description: 'Professional tax',
                isActive: true
            }
        }),
        prisma.salaryComponent.upsert({
            where: { code: 'TDS' },
            update: {},
            create: {
                name: 'Tax Deducted at Source',
                code: 'TDS',
                type: 'STATUTORY',
                isFixed: false,
                isTaxable: false,
                description: 'Income tax deduction',
                isActive: true
            }
        })
    ])
    console.log(`✅ Created ${salaryComponents.length} salary components`)

    // Create Holidays for 2026
    console.log('Creating holidays for 2026...')
    const holidays = await Promise.all([
        prisma.holiday.upsert({
            where: { date: new Date('2026-01-01') },
            update: {},
            create: {
                name: 'New Year\'s Day',
                date: new Date('2026-01-01'),
                type: 'PUBLIC',
                year: 2026,
                isOptional: false,
                isActive: true
            }
        }),
        prisma.holiday.upsert({
            where: { date: new Date('2026-01-26') },
            update: {},
            create: {
                name: 'Republic Day',
                date: new Date('2026-01-26'),
                type: 'PUBLIC',
                year: 2026,
                isOptional: false,
                isActive: true
            }
        }),
        prisma.holiday.upsert({
            where: { date: new Date('2026-03-14') },
            update: {},
            create: {
                name: 'Holi',
                date: new Date('2026-03-14'),
                type: 'PUBLIC',
                year: 2026,
                isOptional: false,
                isActive: true
            }
        }),
        prisma.holiday.upsert({
            where: { date: new Date('2026-04-03') },
            update: {},
            create: {
                name: 'Good Friday',
                date: new Date('2026-04-03'),
                type: 'PUBLIC',
                year: 2026,
                isOptional: false,
                isActive: true
            }
        }),
        prisma.holiday.upsert({
            where: { date: new Date('2026-03-30') },
            update: {},
            create: {
                name: 'Eid-ul-Fitr',
                date: new Date('2026-03-30'),
                type: 'PUBLIC',
                year: 2026,
                isOptional: false,
                isActive: true
            }
        }),
        prisma.holiday.upsert({
            where: { date: new Date('2026-05-01') },
            update: {},
            create: {
                name: 'May Day',
                date: new Date('2026-05-01'),
                type: 'PUBLIC',
                year: 2026,
                isOptional: false,
                isActive: true
            }
        }),
        prisma.holiday.upsert({
            where: { date: new Date('2026-08-15') },
            update: {},
            create: {
                name: 'Independence Day',
                date: new Date('2026-08-15'),
                type: 'PUBLIC',
                year: 2026,
                isOptional: false,
                isActive: true
            }
        }),
        prisma.holiday.upsert({
            where: { date: new Date('2026-08-27') },
            update: {},
            create: {
                name: 'Ganesh Chaturthi',
                date: new Date('2026-08-27'),
                type: 'OPTIONAL',
                year: 2026,
                isOptional: true,
                isActive: true
            }
        }),
        prisma.holiday.upsert({
            where: { date: new Date('2026-10-02') },
            update: {},
            create: {
                name: 'Gandhi Jayanti',
                date: new Date('2026-10-02'),
                type: 'PUBLIC',
                year: 2026,
                isOptional: false,
                isActive: true
            }
        }),
        prisma.holiday.upsert({
            where: { date: new Date('2026-10-06') },
            update: {},
            create: {
                name: 'Dussehra',
                date: new Date('2026-10-06'),
                type: 'PUBLIC',
                year: 2026,
                isOptional: false,
                isActive: true
            }
        }),
        prisma.holiday.upsert({
            where: { date: new Date('2026-10-20') },
            update: {},
            create: {
                name: 'Diwali',
                date: new Date('2026-10-20'),
                type: 'PUBLIC',
                year: 2026,
                isOptional: false,
                isActive: true
            }
        }),
        prisma.holiday.upsert({
            where: { date: new Date('2026-10-21') },
            update: {},
            create: {
                name: 'Diwali (Day 2)',
                date: new Date('2026-10-21'),
                type: 'PUBLIC',
                year: 2026,
                isOptional: false,
                isActive: true
            }
        }),
        prisma.holiday.upsert({
            where: { date: new Date('2026-11-04') },
            update: {},
            create: {
                name: 'Guru Nanak Jayanti',
                date: new Date('2026-11-04'),
                type: 'OPTIONAL',
                year: 2026,
                isOptional: true,
                isActive: true
            }
        }),
        prisma.holiday.upsert({
            where: { date: new Date('2026-12-25') },
            update: {},
            create: {
                name: 'Christmas',
                date: new Date('2026-12-25'),
                type: 'PUBLIC',
                year: 2026,
                isOptional: false,
                isActive: true
            }
        })
    ])
    console.log(`✅ Created ${holidays.length} holidays`)

    // Hash passwords
    const hashedPassword = await bcrypt.hash('Admin@123', 10)
    const userPassword = await bcrypt.hash('User@123', 10)

    // Get department and designation IDs
    const engDept = departments.find(d => d.code === 'ENG')!
    const hrDept = departments.find(d => d.code === 'HR')!
    const generalShift = shifts.find(s => s.name === 'General')!
    const ctoDes = designations.find(d => d.code === 'CTO')!
    const hrmDes = designations.find(d => d.code === 'HRM')!
    const srDevDes = designations.find(d => d.code === 'SRDEV')!
    const devDes = designations.find(d => d.code === 'DEV')!

    // Create Admin User
    console.log('Creating admin user...')
    const adminUser = await prisma.user.upsert({
        where: { email: 'mongodb362@gmail.com' },
        update: {},
        create: {
            email: 'mongodb362@gmail.com',
            password: hashedPassword,
            role: 'ADMIN',
            status: 'ACTIVE'
        }
    })

    const adminEmployee = await prisma.employee.upsert({
        where: { email: 'mongodb362@gmail.com' },
        update: {},
        create: {
            employeeId: 'EMP001',
            userId: adminUser.id,
            firstName: 'System',
            lastName: 'Admin',
            email: 'mongodb362@gmail.com',
            phone: '+91 98765 43200',
            departmentId: engDept.id,
            designationId: ctoDes.id,
            joiningDate: new Date('2023-01-01'),
            employmentType: 'FULL_TIME',
            shiftId: generalShift.id
        }
    })
    console.log('✅ Created admin user')

    // Create HR Manager
    console.log('Creating HR manager...')
    const hrUser = await prisma.user.upsert({
        where: { email: 'hr@gmail.com' },
        update: {},
        create: {
            email: 'hr@gmail.com',
            password: hashedPassword,
            role: 'HR',
            status: 'ACTIVE'
        }
    })

    const hrEmployee = await prisma.employee.upsert({
        where: { email: 'hr@gmail.com' },
        update: {},
        create: {
            employeeId: 'EMP002',
            userId: hrUser.id,
            firstName: 'Sarah',
            lastName: 'Wilson',
            email: 'hr@gmail.com',
            phone: '+91 98765 43201',
            departmentId: hrDept.id,
            designationId: hrmDes.id,
            joiningDate: new Date('2023-06-01'),
            employmentType: 'FULL_TIME',
            shiftId: generalShift.id
        }
    })
    console.log('✅ Created HR manager')

    // Create Manager
    console.log('Creating manager...')
    const managerUser = await prisma.user.upsert({
        where: { email: 'manager@gmail.com' },
        update: {},
        create: {
            email: 'manager@gmail.com',
            password: hashedPassword,
            role: 'MANAGER',
            status: 'ACTIVE'
        }
    })

    const managerEmployee = await prisma.employee.upsert({
        where: { email: 'manager@gmail.com' },
        update: {},
        create: {
            employeeId: 'EMP003',
            userId: managerUser.id,
            firstName: 'John',
            lastName: 'Manager',
            email: 'manager@gmail.com',
            phone: '+91 98765 43202',
            departmentId: engDept.id,
            designationId: srDevDes.id,
            joiningDate: new Date('2023-03-15'),
            employmentType: 'FULL_TIME',
            shiftId: generalShift.id,
            reportingManagerId: adminEmployee.id
        }
    })
    console.log('✅ Created manager')

    // Create Regular Employee
    console.log('Creating employee...')
    const empUser = await prisma.user.upsert({
        where: { email: 'bandelaajay362@gmail.com' },
        update: {},
        create: {
            email: 'bandelaajay362@gmail.com',
            password: userPassword,
            role: 'EMPLOYEE',
            status: 'ACTIVE'
        }
    })

    const regularEmployee = await prisma.employee.upsert({
        where: { email: 'bandelaajay362@gmail.com' },
        update: {},
        create: {
            employeeId: 'EMP004',
            userId: empUser.id,
            firstName: 'John',
            lastName: 'Doe',
            email: 'bandelaajay362@gmail.com',
            phone: '+91 98765 43203',
            departmentId: engDept.id,
            designationId: devDes.id,
            joiningDate: new Date('2024-01-15'),
            employmentType: 'FULL_TIME',
            shiftId: generalShift.id,
            reportingManagerId: managerEmployee.id
        }
    })
    console.log('✅ Created regular employee')

    // Initialize leave balances
    console.log('Initializing leave balances...')
    const currentYear = new Date().getFullYear()
    const allEmployees = [adminEmployee, hrEmployee, managerEmployee, regularEmployee]

    for (const employee of allEmployees) {
        for (const leaveType of leaveTypes) {
            await prisma.leaveBalance.upsert({
                where: {
                    employeeId_leaveTypeId_year: {
                        employeeId: employee.id,
                        leaveTypeId: leaveType.id,
                        year: currentYear
                    }
                },
                update: {},
                create: {
                    employeeId: employee.id,
                    leaveTypeId: leaveType.id,
                    year: currentYear,
                    allocated: leaveType.defaultBalance,
                    used: 0,
                    pending: 0,
                    carriedForward: 0,
                    adjustment: 0
                }
            })
        }
    }
    console.log('✅ Initialized leave balances')

    // Create System Settings
    console.log('Creating system settings...')
    const settings = [
        { key: 'company_name', value: 'CognitBotz Technologies', category: 'GENERAL' },
        { key: 'company_email', value: 'info@cognitbotz.com', category: 'GENERAL' },
        { key: 'company_phone', value: '+91 98765 43210', category: 'GENERAL' },
        { key: 'company_address', value: '123 Tech Park, Bangalore, Karnataka 560001', category: 'GENERAL' },
        { key: 'timezone', value: 'Asia/Kolkata', category: 'GENERAL' },
        { key: 'date_format', value: 'dd/MM/yyyy', category: 'GENERAL' },
        { key: 'office_name', value: 'Hyderabad Office', category: 'ATTENDANCE' },
        { key: 'office_latitude', value: '17.4438', category: 'ATTENDANCE' },
        { key: 'office_longitude', value: '78.3831', category: 'ATTENDANCE' },
        { key: 'office_radius', value: '500', category: 'ATTENDANCE' },
        { key: 'max_leave_per_request', value: '20', category: 'LEAVE' },
        { key: 'leave_approval_levels', value: '2', category: 'LEAVE' },
        { key: 'payroll_process_day', value: '25', category: 'PAYROLL' },
        { key: 'payment_day', value: '1', category: 'PAYROLL' },
        { key: 'checkin_window_start', value: '09:00', category: 'ATTENDANCE' },
        { key: 'checkin_window_end', value: '10:30', category: 'ATTENDANCE' },
        { key: 'checkout_window_start', value: '18:30', category: 'ATTENDANCE' },
        { key: 'checkout_window_end', value: '20:30', category: 'ATTENDANCE' }
    ]

    for (const setting of settings) {
        await prisma.systemSetting.upsert({
            where: { key: setting.key },
            update: { value: setting.value },
            create: setting
        })
    }
    console.log(`✅ Created ${settings.length} system settings`)

    // Create Notifications
    console.log('Creating notifications...')

    // Notifications for Admin
    await prisma.notification.createMany({
        data: [
            {
                userId: adminUser.id,
                type: 'SYSTEM',
                title: 'System Update',
                message: 'HRMS System updated to version 2.0. New features available.',
                isRead: false
            },
            {
                userId: adminUser.id,
                type: 'GENERAL',
                title: 'New Employee Onboarded',
                message: 'John Doe has joined the Engineering team.',
                isRead: true
            }
        ]
    })

    // Notifications for Employee
    await prisma.notification.createMany({
        data: [
            {
                userId: empUser.id,
                type: 'LEAVE_APPROVED',
                title: 'Leave Request Approved',
                message: 'Your leave request for Feb 15 has been approved by HR.',
                isRead: true,
                createdAt: new Date(Date.now() - 1000 * 60 * 5) // 5 mins ago
            },
            {
                userId: empUser.id,
                type: 'PAYROLL',
                title: 'Salary Credited',
                message: 'Your salary for January has been credited to your account.',
                isRead: true,
                createdAt: new Date(Date.now() - 1000 * 60 * 60 * 2) // 2 hours ago
            },
            {
                userId: empUser.id,
                type: 'GENERAL',
                title: 'Team Meeting',
                message: 'Team meeting scheduled at 3 PM in Conference Room A.',
                isRead: false,
                createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24) // 1 day ago
            },
            {
                userId: empUser.id,
                type: 'HOLIDAY',
                title: 'Upcoming Holiday',
                message: 'Office will be closed on Jan 26 for Republic Day.',
                isRead: false,
                createdAt: new Date(Date.now() - 1000 * 60 * 60 * 48) // 2 days ago
            }
        ]
    })
    console.log('✅ Created notifications')

    console.log('\n🎉 Database seeding completed successfully!')
    console.log('\n📋 Demo Credentials:')
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log('Admin:    admin@cognitbotz.com / Admin@123')
    console.log('HR:       hr@cognitbotz.com / Admin@123')
    console.log('Manager:  manager@cognitbotz.com / Admin@123')
    console.log('Employee: employee@cognitbotz.com / User@123')
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
}

main()
    .then(async () => {
        await prisma.$disconnect()
    })
    .catch(async (e) => {
        console.error('❌ Seeding failed:', e)
        await prisma.$disconnect()
        process.exit(1)
    })
