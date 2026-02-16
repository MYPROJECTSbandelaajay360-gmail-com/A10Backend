import { Router, Response } from 'express';
import { prisma } from '../lib/prisma';
import { AuthRequest, authenticate, authorize } from '../middleware/auth';
import { generateRequestNumber, calculateLeaveDays } from '../utils';
import { startOfDay } from 'date-fns';

const router = Router();

// ==================== LEAVE REQUESTS ====================

// GET - Get leave requests
router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
    try {
        if (!req.user?.employeeId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const status = req.query.status as string;
        const year = req.query.year as string || new Date().getFullYear().toString();

        const whereClause: any = {
            employeeId: req.user.employeeId
        };

        if (status && status !== 'all') {
            whereClause.status = status.toUpperCase();
        }

        const leaveRequests = await prisma.leaveRequest.findMany({
            where: whereClause,
            include: {
                leaveType: true,
                approvals: {
                    include: {
                        approver: {
                            select: {
                                firstName: true,
                                lastName: true
                            }
                        }
                    }
                }
            },
            orderBy: { appliedAt: 'desc' }
        });

        res.json({ data: leaveRequests });
    } catch (error) {
        console.error('Leave GET error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// POST - Apply for leave
router.post('/apply', authenticate, async (req: AuthRequest, res: Response) => {
    try {
        if (!req.user?.employeeId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const {
            leaveTypeId,
            fromDate,
            toDate,
            isHalfDay,
            halfDayType,
            reason,
            contactNumber,
            document
        } = req.body;

        if (!leaveTypeId || !fromDate || !toDate || !reason) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const numberOfDays = calculateLeaveDays(new Date(fromDate), new Date(toDate), isHalfDay);

        const year = new Date(fromDate).getFullYear();
        const leaveBalance = await prisma.leaveBalance.findFirst({
            where: {
                employeeId: req.user.employeeId,
                leaveTypeId,
                year
            }
        });

        if (!leaveBalance) {
            return res.status(400).json({ error: 'Leave balance not found for this year' });
        }

        const availableBalance = leaveBalance.allocated + leaveBalance.carriedForward + leaveBalance.adjustment - leaveBalance.used - leaveBalance.pending;
        if (numberOfDays > availableBalance) {
            return res.status(400).json({
                error: `Insufficient leave balance. Available: ${availableBalance} days`
            });
        }

        const overlappingLeave = await prisma.leaveRequest.findFirst({
            where: {
                employeeId: req.user.employeeId,
                status: { in: ['PENDING', 'APPROVED'] },
                OR: [
                    {
                        fromDate: { lte: new Date(toDate) },
                        toDate: { gte: new Date(fromDate) }
                    }
                ]
            }
        });

        if (overlappingLeave) {
            return res.status(400).json({ error: 'You already have a leave request for this period' });
        }

        const employee = await prisma.employee.findUnique({
            where: { id: req.user.employeeId },
            include: { reportingManager: true }
        });

        const leaveRequest = await prisma.leaveRequest.create({
            data: {
                requestNumber: generateRequestNumber('LR'),
                employeeId: req.user.employeeId,
                leaveTypeId,
                fromDate: new Date(fromDate),
                toDate: new Date(toDate),
                numberOfDays,
                isHalfDay: isHalfDay || false,
                halfDayType,
                reason,
                contactNumber,
                document,
                status: 'PENDING',
                currentApprover: employee?.reportingManagerId || null
            },
            include: {
                leaveType: true
            }
        });

        await prisma.leaveBalance.update({
            where: { id: leaveBalance.id },
            data: {
                pending: { increment: numberOfDays }
            }
        });

        // Notify the reporting manager
        if (employee?.reportingManagerId) {
            await prisma.leaveApproval.create({
                data: {
                    leaveRequestId: leaveRequest.id,
                    approverId: employee.reportingManagerId,
                    level: 1,
                    status: 'PENDING'
                }
            });

            const manager = await prisma.employee.findUnique({
                where: { id: employee.reportingManagerId },
                include: { user: true }
            });

            if (manager?.user) {
                await prisma.notification.create({
                    data: {
                        userId: manager.user.id,
                        type: 'LEAVE',
                        title: 'New Leave Request',
                        message: `${employee.firstName} ${employee.lastName} has applied for ${leaveRequest.leaveType.name} (${numberOfDays} day${numberOfDays > 1 ? 's' : ''}) from ${fromDate} to ${toDate}`,
                        link: '/leave/approvals'
                    }
                });
            }
        }

        // Also notify all ADMIN/HR users so they see the request in real-time
        const adminHRUsers = await prisma.user.findMany({
            where: {
                role: { in: ['ADMIN', 'HR'] },
                id: { not: req.user.id } // Don't notify the applicant themselves
            },
            select: { id: true }
        });

        // Get the manager's userId to avoid duplicate notification
        const managerUserId = employee?.reportingManagerId
            ? (await prisma.employee.findUnique({
                where: { id: employee.reportingManagerId },
                select: { userId: true }
            }))?.userId
            : null;

        const notifData = adminHRUsers
            .filter(u => u.id !== managerUserId) // Skip if already notified as reporting manager
            .map(u => ({
                userId: u.id,
                type: 'LEAVE',
                title: 'New Leave Request',
                message: `${employee!.firstName} ${employee!.lastName} has applied for ${leaveRequest.leaveType.name} (${numberOfDays} day${numberOfDays > 1 ? 's' : ''}) from ${fromDate} to ${toDate}`,
                link: '/leave/approvals'
            }));

        if (notifData.length > 0) {
            await prisma.notification.createMany({ data: notifData });
        }

        await prisma.auditLog.create({
            data: {
                userId: req.user.id,
                action: 'CREATE',
                entityType: 'LeaveRequest',
                entityId: leaveRequest.id,
                description: `Applied for ${numberOfDays} days ${leaveRequest.leaveType.name}`
            }
        });

        res.json({
            data: leaveRequest,
            message: 'Leave request submitted successfully'
        });
    } catch (error) {
        console.error('Leave POST error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// ==================== LEAVE APPROVALS ====================

// GET - Get pending leave requests for approval
router.get('/approvals', authenticate, async (req: AuthRequest, res: Response) => {
    try {
        if (!req.user?.employeeId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const userRole = req.user.role;
        if (!['MANAGER', 'HR', 'ADMIN'].includes(userRole)) {
            return res.status(403).json({ error: 'No approval rights' });
        }

        const status = (req.query.status as string || 'PENDING').toUpperCase();

        const pendingApprovals = await prisma.leaveApproval.findMany({
            where: {
                approverId: req.user.employeeId,
                status: status
            },
            include: {
                leaveRequest: {
                    include: {
                        employee: {
                            include: {
                                department: true,
                                designation: true
                            }
                        },
                        leaveType: true
                    }
                }
            },
            orderBy: { createdAt: 'desc' }
        });

        let allPendingRequests: any[] = [];
        if (['HR', 'ADMIN'].includes(userRole)) {
            allPendingRequests = await prisma.leaveRequest.findMany({
                where: { status: 'PENDING' },
                include: {
                    employee: {
                        include: {
                            department: true,
                            designation: true
                        }
                    },
                    leaveType: true,
                    approvals: {
                        include: {
                            approver: {
                                select: {
                                    firstName: true,
                                    lastName: true
                                }
                            }
                        }
                    }
                },
                orderBy: { appliedAt: 'desc' }
            });
        }

        res.json({
            data: {
                myApprovals: pendingApprovals,
                allPending: allPendingRequests
            }
        });
    } catch (error) {
        console.error('Leave Approvals GET error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// POST - Approve or Reject leave request
router.post('/approvals/action', authenticate, async (req: AuthRequest, res: Response) => {
    try {
        if (!req.user?.employeeId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const { leaveRequestId, action, comments } = req.body;

        if (!leaveRequestId || !action || !['APPROVE', 'REJECT'].includes(action)) {
            return res.status(400).json({ error: 'Invalid request' });
        }

        const leaveRequest = await prisma.leaveRequest.findUnique({
            where: { id: leaveRequestId },
            include: {
                employee: {
                    include: { user: true }
                },
                leaveType: true,
                approvals: true
            }
        });

        if (!leaveRequest) {
            return res.status(404).json({ error: 'Leave request not found' });
        }

        if (leaveRequest.status !== 'PENDING') {
            return res.status(400).json({ error: 'Leave request is not pending' });
        }

        const approval = leaveRequest.approvals.find(
            a => a.approverId === req.user!.employeeId && a.status === 'PENDING'
        );

        const userRole = req.user.role;
        const isHRorAdmin = ['HR', 'ADMIN'].includes(userRole);

        if (!approval && !isHRorAdmin) {
            return res.status(403).json({ error: 'You are not authorized to approve this request' });
        }

        const newStatus = action === 'APPROVE' ? 'APPROVED' : 'REJECTED';
        const now = new Date();

        await prisma.$transaction(async (tx) => {
            if (approval) {
                await tx.leaveApproval.update({
                    where: { id: approval.id },
                    data: {
                        status: newStatus,
                        comments,
                        actionAt: now
                    }
                });
            } else if (isHRorAdmin) {
                await tx.leaveApproval.create({
                    data: {
                        leaveRequestId,
                        approverId: req.user!.employeeId!,
                        level: 2,
                        status: newStatus,
                        comments,
                        actionAt: now
                    }
                });
            }

            await tx.leaveRequest.update({
                where: { id: leaveRequestId },
                data: {
                    status: newStatus,
                    currentApprover: null
                }
            });

            const year = leaveRequest.fromDate.getFullYear();
            const leaveBalance = await tx.leaveBalance.findFirst({
                where: {
                    employeeId: leaveRequest.employeeId,
                    leaveTypeId: leaveRequest.leaveTypeId,
                    year
                }
            });

            if (leaveBalance) {
                if (action === 'APPROVE') {
                    await tx.leaveBalance.update({
                        where: { id: leaveBalance.id },
                        data: {
                            pending: { decrement: leaveRequest.numberOfDays },
                            used: { increment: leaveRequest.numberOfDays }
                        }
                    });

                    const fromDate = startOfDay(leaveRequest.fromDate);
                    const toDate = startOfDay(leaveRequest.toDate);
                    const currentDate = new Date(fromDate);

                    while (currentDate <= toDate) {
                        const dayOfWeek = currentDate.getDay();
                        if (dayOfWeek !== 0 && dayOfWeek !== 6) {
                            await tx.attendance.upsert({
                                where: {
                                    employeeId_date: {
                                        employeeId: leaveRequest.employeeId,
                                        date: new Date(currentDate)
                                    }
                                },
                                update: {
                                    status: 'ON_LEAVE',
                                    isAutoMarked: true,
                                    autoMarkReason: `${leaveRequest.leaveType.name} - Request #${leaveRequest.requestNumber}`
                                },
                                create: {
                                    employeeId: leaveRequest.employeeId,
                                    date: new Date(currentDate),
                                    status: 'ON_LEAVE',
                                    isAutoMarked: true,
                                    autoMarkReason: `${leaveRequest.leaveType.name} - Request #${leaveRequest.requestNumber}`
                                }
                            });
                        }
                        currentDate.setDate(currentDate.getDate() + 1);
                    }
                } else {
                    await tx.leaveBalance.update({
                        where: { id: leaveBalance.id },
                        data: {
                            pending: { decrement: leaveRequest.numberOfDays }
                        }
                    });
                }
            }

            await tx.notification.create({
                data: {
                    userId: leaveRequest.employee.user.id,
                    type: 'LEAVE',
                    title: `Leave Request ${action === 'APPROVE' ? 'Approved' : 'Rejected'}`,
                    message: `Your ${leaveRequest.leaveType.name} request for ${leaveRequest.numberOfDays} day(s) has been ${action.toLowerCase()}ed.${comments ? ` Comment: ${comments}` : ''}`,
                    link: '/leave'
                }
            });

            await tx.auditLog.create({
                data: {
                    userId: req.user!.id,
                    action: action === 'APPROVE' ? 'APPROVE' : 'REJECT',
                    entityType: 'LeaveRequest',
                    entityId: leaveRequestId,
                    description: `${action}ed leave request #${leaveRequest.requestNumber} for ${leaveRequest.employee.firstName} ${leaveRequest.employee.lastName}`
                }
            });
        });

        res.json({
            message: `Leave request ${action.toLowerCase()}ed successfully`
        });
    } catch (error) {
        console.error('Leave Approval POST error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// ==================== LEAVE BALANCE ====================

// GET - Get leave balance for current user
router.get('/balance', authenticate, async (req: AuthRequest, res: Response) => {
    try {
        if (!req.user?.employeeId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const year = parseInt(req.query.year as string || new Date().getFullYear().toString());

        const leaveBalances = await prisma.leaveBalance.findMany({
            where: {
                employeeId: req.user.employeeId,
                year,
                leaveType: {
                    isActive: true
                }
            },
            include: {
                leaveType: true
            },
            orderBy: {
                leaveType: { name: 'asc' }
            }
        });

        const balancesWithAvailable = leaveBalances.map(balance => ({
            ...balance,
            available: balance.allocated + balance.carriedForward + balance.adjustment - balance.used - balance.pending
        }));

        res.json({ data: balancesWithAvailable });
    } catch (error) {
        console.error('Leave Balance GET error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// POST - Initialize leave balances (HR/Admin only)
router.post('/balance/initialize', authenticate, authorize(['HR', 'ADMIN']), async (req: AuthRequest, res: Response) => {
    try {
        const { employeeId, year } = req.body;

        if (!employeeId) {
            return res.status(400).json({ error: 'Employee ID is required' });
        }

        const targetYear = year || new Date().getFullYear();

        const leaveTypes = await prisma.leaveTypeConfig.findMany({
            where: { isActive: true }
        });

        const existingBalances = await prisma.leaveBalance.findMany({
            where: {
                employeeId,
                year: targetYear
            }
        });

        if (existingBalances.length > 0) {
            return res.status(400).json({ error: 'Leave balances already initialized for this year' });
        }

        const previousBalances = await prisma.leaveBalance.findMany({
            where: {
                employeeId,
                year: targetYear - 1
            },
            include: { leaveType: true }
        });

        const createdBalances = await Promise.all(
            leaveTypes.map(async (leaveType) => {
                let carriedForward = 0;
                const prevBalance = previousBalances.find(pb => pb.leaveTypeId === leaveType.id);

                if (prevBalance && leaveType.maxCarryForward > 0) {
                    const remainingBalance = prevBalance.allocated - prevBalance.used;
                    carriedForward = Math.min(remainingBalance, leaveType.maxCarryForward);
                }

                return prisma.leaveBalance.create({
                    data: {
                        employeeId,
                        leaveTypeId: leaveType.id,
                        year: targetYear,
                        allocated: leaveType.defaultBalance,
                        used: 0,
                        pending: 0,
                        carriedForward,
                        adjustment: 0
                    },
                    include: { leaveType: true }
                });
            })
        );

        await prisma.auditLog.create({
            data: {
                userId: req.user!.id,
                action: 'CREATE',
                entityType: 'LeaveBalance',
                description: `Initialized leave balances for employee ${employeeId} for year ${targetYear}`
            }
        });

        res.json({
            data: createdBalances,
            message: `Leave balances initialized for year ${targetYear}`
        });
    } catch (error) {
        console.error('Leave Balance POST error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// ==================== LEAVE REPORTS ====================

// GET - Get leave reports data (HR/Admin/CEO only)
router.get('/reports', authenticate, authorize(['HR', 'ADMIN', 'CEO']), async (req: AuthRequest, res: Response) => {
    try {
        const year = parseInt(req.query.year as string || new Date().getFullYear().toString());
        const departmentFilter = req.query.department as string;

        // Build base where clause for leave requests in this year
        const baseWhere: any = {
            fromDate: {
                gte: new Date(`${year}-01-01`),
                lt: new Date(`${year + 1}-01-01`)
            }
        };

        if (departmentFilter && departmentFilter !== 'all') {
            baseWhere.employee = { departmentId: departmentFilter };
        }

        // 1. Fetch all leave requests for the year
        const allRequests = await prisma.leaveRequest.findMany({
            where: baseWhere,
            include: {
                leaveType: true,
                employee: {
                    include: {
                        department: true,
                        designation: true
                    }
                }
            },
            orderBy: { appliedAt: 'desc' }
        });

        // 2. KPI Summary
        const totalRequests = allRequests.length;
        const approved = allRequests.filter(r => r.status === 'APPROVED').length;
        const rejected = allRequests.filter(r => r.status === 'REJECTED').length;
        const pending = allRequests.filter(r => r.status === 'PENDING').length;
        const cancelled = allRequests.filter(r => r.status === 'CANCELLED').length;
        const totalDays = allRequests.reduce((sum, r) => sum + r.numberOfDays, 0);
        const avgDaysPerRequest = totalRequests > 0 ? Math.round((totalDays / totalRequests) * 10) / 10 : 0;

        // 3. Monthly Trends
        const monthlyTrends = Array.from({ length: 12 }, (_, i) => {
            const month = i + 1;
            const monthRequests = allRequests.filter(r => {
                const d = new Date(r.fromDate);
                return d.getMonth() + 1 === month;
            });
            return {
                month,
                monthName: new Date(year, i).toLocaleString('en-US', { month: 'short' }),
                total: monthRequests.length,
                approved: monthRequests.filter(r => r.status === 'APPROVED').length,
                rejected: monthRequests.filter(r => r.status === 'REJECTED').length,
                pending: monthRequests.filter(r => r.status === 'PENDING').length,
                totalDays: monthRequests.reduce((sum, r) => sum + r.numberOfDays, 0)
            };
        });

        // 4. Department Breakdown
        const deptMap = new Map<string, { name: string; count: number; days: number }>();
        allRequests.forEach(r => {
            const deptName = r.employee?.department?.name || 'Unknown';
            const existing = deptMap.get(deptName) || { name: deptName, count: 0, days: 0 };
            existing.count++;
            existing.days += r.numberOfDays;
            deptMap.set(deptName, existing);
        });
        const departmentBreakdown = Array.from(deptMap.values()).sort((a, b) => b.count - a.count);

        // 5. Leave Type Breakdown
        const typeMap = new Map<string, { name: string; code: string; count: number; days: number }>();
        allRequests.forEach(r => {
            const typeName = r.leaveType?.name || 'Unknown';
            const typeCode = r.leaveType?.code || 'UNK';
            const existing = typeMap.get(typeName) || { name: typeName, code: typeCode, count: 0, days: 0 };
            existing.count++;
            existing.days += r.numberOfDays;
            typeMap.set(typeName, existing);
        });
        const leaveTypeBreakdown = Array.from(typeMap.values()).sort((a, b) => b.count - a.count);

        // 6. Employee-wise Summary
        const empMap = new Map<string, {
            employeeId: string;
            name: string;
            department: string;
            designation: string;
            totalRequests: number;
            approvedDays: number;
            pendingDays: number;
            rejectedDays: number;
        }>();
        allRequests.forEach(r => {
            const empId = r.employeeId;
            const emp = r.employee;
            const existing = empMap.get(empId) || {
                employeeId: emp?.employeeId || empId,
                name: emp ? `${emp.firstName} ${emp.lastName}` : 'Unknown',
                department: emp?.department?.name || 'Unknown',
                designation: emp?.designation?.name || 'Unknown',
                totalRequests: 0,
                approvedDays: 0,
                pendingDays: 0,
                rejectedDays: 0
            };
            existing.totalRequests++;
            if (r.status === 'APPROVED') existing.approvedDays += r.numberOfDays;
            if (r.status === 'PENDING') existing.pendingDays += r.numberOfDays;
            if (r.status === 'REJECTED') existing.rejectedDays += r.numberOfDays;
            empMap.set(empId, existing);
        });
        const employeeSummary = Array.from(empMap.values()).sort((a, b) => b.approvedDays - a.approvedDays);

        // 7. Fetch all departments for filter dropdown
        const departments = await prisma.department.findMany({
            where: { isActive: true },
            select: { id: true, name: true },
            orderBy: { name: 'asc' }
        });

        res.json({
            data: {
                kpis: {
                    totalRequests,
                    approved,
                    rejected,
                    pending,
                    cancelled,
                    totalDays,
                    avgDaysPerRequest
                },
                monthlyTrends,
                departmentBreakdown,
                leaveTypeBreakdown,
                employeeSummary,
                departments,
                filters: { year, department: departmentFilter || 'all' }
            }
        });
    } catch (error) {
        console.error('Leave Reports GET error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

export default router;
