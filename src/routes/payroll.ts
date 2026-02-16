import { Router, Response } from 'express';
import { prisma } from '../lib/prisma';
import { AuthRequest, authenticate, authorize } from '../middleware/auth';
import { generatePayrollNumber } from '../utils';
import { startOfMonth, endOfMonth, eachDayOfInterval, getDay } from 'date-fns';

const router = Router();

// GET - Get payroll records
router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
    try {
        if (!req.user) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const month = req.query.month as string;
        const year = req.query.year as string;
        const employeeId = req.query.employeeId as string;
        const status = req.query.status as string;

        const whereClause: any = {};

        // Regular employees can only see their own payroll
        const userRole = req.user.role;
        if (!['HR', 'ADMIN'].includes(userRole)) {
            if (!req.user.employeeId) {
                return res.status(404).json({ error: 'Employee not found' });
            }
            whereClause.employeeId = req.user.employeeId;
        } else if (employeeId) {
            whereClause.employeeId = employeeId;
        }

        if (month) whereClause.month = parseInt(month);
        if (year) whereClause.year = parseInt(year);
        if (status) whereClause.status = status.toUpperCase();

        const payrollRecords = await prisma.payrollRecord.findMany({
            where: whereClause,
            include: {
                employee: {
                    select: {
                        employeeId: true,
                        firstName: true,
                        lastName: true,
                        department: { select: { name: true } },
                        designation: { select: { name: true } }
                    }
                },
                payslip: true,
                earnings: true,
                deductions: true
            },
            orderBy: [
                { year: 'desc' },
                { month: 'desc' }
            ]
        });

        res.json({ data: payrollRecords });
    } catch (error) {
        console.error('Payroll GET error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// POST - Process payroll (HR/Admin only)
router.post('/process', authenticate, authorize(['HR', 'ADMIN']), async (req: AuthRequest, res: Response) => {
    try {
        const { month, year, employeeIds } = req.body;

        if (!month || !year) {
            return res.status(400).json({ error: 'Month and year are required' });
        }

        // Get date range for the month
        const monthStart = startOfMonth(new Date(year, month - 1));
        const monthEnd = endOfMonth(new Date(year, month - 1));
        const daysInMonth = eachDayOfInterval({ start: monthStart, end: monthEnd });

        // Calculate working days (excluding weekends)
        const workingDays = daysInMonth.filter(day => {
            const dayOfWeek = getDay(day);
            return dayOfWeek !== 0 && dayOfWeek !== 6;
        });

        // Get holidays in this month
        const holidays = await prisma.holiday.findMany({
            where: {
                date: {
                    gte: monthStart,
                    lte: monthEnd
                },
                type: 'PUBLIC',
                isActive: true
            }
        });

        const totalWorkingDays = workingDays.length - holidays.length;

        // Get employees to process
        const whereClause: any = {
            user: { status: 'ACTIVE' }
        };
        if (employeeIds && employeeIds.length > 0) {
            whereClause.id = { in: employeeIds };
        }

        const employees = await prisma.employee.findMany({
            where: whereClause,
            include: {
                salaryStructure: {
                    include: {
                        components: {
                            include: { component: true }
                        }
                    }
                },
                user: true
            }
        });

        const processedRecords = [];

        for (const employee of employees) {
            const existingPayroll = await prisma.payrollRecord.findFirst({
                where: {
                    employeeId: employee.id,
                    month,
                    year
                }
            });

            if (existingPayroll || !employee.salaryStructure) {
                continue;
            }

            const attendances = await prisma.attendance.findMany({
                where: {
                    employeeId: employee.id,
                    date: {
                        gte: monthStart,
                        lte: monthEnd
                    }
                }
            });

            const presentDays = attendances.filter(a => a.status === 'PRESENT').length;
            const halfDays = attendances.filter(a => a.status === 'HALF_DAY').length;
            const leaveDays = attendances.filter(a => a.status === 'ON_LEAVE').length;
            const holidayDays = attendances.filter(a => a.status === 'HOLIDAY').length;
            const lateDays = attendances.filter(a => a.isLateLogin).length;
            const earlyLogoutDays = attendances.filter(a => a.isEarlyLogout).length;

            const effectivePresentDays = presentDays + (halfDays * 0.5) + leaveDays;
            const absentDays = Math.max(0, totalWorkingDays - effectivePresentDays - holidays.length);

            const earnings = employee.salaryStructure.components
                .filter(c => c.component.type === 'EARNING')
                .map(c => ({
                    name: c.component.name,
                    amount: c.amount
                }));

            const grossEarnings = earnings.reduce((sum, e) => sum + e.amount, 0);

            const deductionComponents = employee.salaryStructure.components
                .filter(c => c.component.type === 'DEDUCTION' || c.component.type === 'STATUTORY')
                .map(c => ({
                    name: c.component.name,
                    amount: c.amount
                }));

            const perDaySalary = grossEarnings / totalWorkingDays;
            const lossOfPay = absentDays * perDaySalary;

            const totalDeductions = deductionComponents.reduce((sum, d) => sum + d.amount, 0) + lossOfPay;
            const netSalary = grossEarnings - totalDeductions;

            const payrollRecord = await prisma.payrollRecord.create({
                data: {
                    payrollNumber: generatePayrollNumber(month, year),
                    employeeId: employee.id,
                    month,
                    year,
                    totalWorkingDays,
                    presentDays: effectivePresentDays,
                    absentDays,
                    leavesTaken: leaveDays,
                    holidays: holidayDays,
                    weekends: daysInMonth.length - workingDays.length,
                    lateDays,
                    earlyLogoutDays,
                    basicSalary: employee.salaryStructure.monthlyCTC,
                    grossEarnings,
                    totalDeductions,
                    lossOfPay,
                    netSalary,
                    status: 'COMPLETED',
                    processedAt: new Date(),
                    earnings: {
                        create: earnings
                    },
                    deductions: {
                        create: [
                            ...deductionComponents,
                            ...(lossOfPay > 0 ? [{ name: 'Loss of Pay', amount: lossOfPay }] : [])
                        ]
                    }
                },
                include: {
                    employee: true,
                    earnings: true,
                    deductions: true
                }
            });

            processedRecords.push(payrollRecord);

            await prisma.notification.create({
                data: {
                    userId: employee.user.id,
                    type: 'PAYROLL',
                    title: 'Payroll Processed',
                    message: `Your payroll for ${new Date(year, month - 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })} has been processed. Net salary: ₹${netSalary.toLocaleString('en-IN')}`,
                    link: '/payroll'
                }
            });
        }

        await prisma.auditLog.create({
            data: {
                userId: req.user!.id,
                action: 'CREATE',
                entityType: 'PayrollRecord',
                description: `Processed payroll for ${processedRecords.length} employees for ${month}/${year}`
            }
        });

        res.json({
            data: processedRecords,
            message: `Payroll processed for ${processedRecords.length} employees`
        });
    } catch (error) {
        console.error('Payroll POST error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// PATCH - Update payment status (HR/Admin only)
router.patch('/status', authenticate, authorize(['HR', 'ADMIN']), async (req: AuthRequest, res: Response) => {
    try {
        const { payrollId, status, paymentDate, paymentReference, paymentMode } = req.body;

        if (!payrollId || !status) {
            return res.status(400).json({ error: 'Payroll ID and status are required' });
        }

        const payroll = await prisma.payrollRecord.update({
            where: { id: payrollId },
            data: {
                status,
                paymentDate: paymentDate ? new Date(paymentDate) : new Date(),
                paymentReference,
                paymentMode
            },
            include: {
                employee: {
                    include: { user: true }
                }
            }
        });

        if (status === 'PAID') {
            await prisma.notification.create({
                data: {
                    userId: payroll.employee.user.id,
                    type: 'PAYROLL',
                    title: 'Salary Credited',
                    message: `Your salary of ₹${payroll.netSalary.toLocaleString('en-IN')} has been credited to your bank account.`,
                    link: '/payroll'
                }
            });

            await prisma.payslip.create({
                data: {
                    payrollId: payroll.id,
                    payslipNumber: `PS${payroll.payrollNumber.replace('PAY', '')}`,
                    generatedAt: new Date()
                }
            });
        }

        await prisma.auditLog.create({
            data: {
                userId: req.user!.id,
                action: 'UPDATE',
                entityType: 'PayrollRecord',
                entityId: payrollId,
                description: `Updated payment status to ${status}`
            }
        });

        res.json({
            data: payroll,
            message: 'Payment status updated successfully'
        });
    } catch (error) {
        console.error('Payroll PATCH error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

export default router;
