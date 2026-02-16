
import { Router } from 'express';
import { prisma } from '../lib/prisma';

const router = Router();

// GET /api/dashboard/activity
router.get('/activity', async (req, res) => {
    try {
        // 1. Fetch recent check-ins
        const checkIns = await prisma.attendance.findMany({
            where: { checkInTime: { not: null } },
            orderBy: { checkInTime: 'desc' },
            take: 10,
            include: { employee: true }
        });

        // 2. Fetch recent check-outs
        const checkOuts = await prisma.attendance.findMany({
            where: { checkOutTime: { not: null } },
            orderBy: { checkOutTime: 'desc' },
            take: 10,
            include: { employee: true }
        });

        // 3. Fetch recent leave applications
        const leaveRequests = await prisma.leaveRequest.findMany({
            orderBy: { createdAt: 'desc' },
            take: 10,
            include: { employee: true }
        });

        // 4. Fetch recent leave approvals
        const leaveApprovals = await prisma.leaveApproval.findMany({
            where: { actionAt: { not: null } },
            orderBy: { actionAt: 'desc' },
            take: 10,
            include: {
                leaveRequest: {
                    include: { employee: true }
                },
                approver: true
            }
        });

        // 5. Fetch recent payroll processing
        const payrolls = await prisma.payrollRecord.findMany({
            where: { processedAt: { not: null } },
            orderBy: { processedAt: 'desc' },
            take: 10,
            include: { employee: true }
        });

        // Combine and normalize
        const activities = [
            ...checkIns.map(item => ({
                id: `ci-${item.id}`,
                user: `${item.employee.firstName} ${item.employee.lastName}`,
                action: 'checked in',
                time: item.checkInTime, // raw Date object
                initials: `${item.employee.firstName[0]}${item.employee.lastName[0]}`,
                color: 'bg-blue-500',
                timestamp: new Date(item.checkInTime!).getTime()
            })),
            ...checkOuts.map(item => ({
                id: `co-${item.id}`,
                user: `${item.employee.firstName} ${item.employee.lastName}`,
                action: 'checked out',
                time: item.checkOutTime,
                initials: `${item.employee.firstName[0]}${item.employee.lastName[0]}`,
                color: 'bg-pink-500',
                timestamp: new Date(item.checkOutTime!).getTime()
            })),
            ...leaveRequests.map(item => ({
                id: `lr-${item.id}`,
                user: `${item.employee.firstName} ${item.employee.lastName}`,
                action: 'applied for leave',
                time: item.createdAt,
                initials: `${item.employee.firstName[0]}${item.employee.lastName[0]}`,
                color: 'bg-yellow-500',
                timestamp: new Date(item.createdAt).getTime()
            })),
            ...leaveApprovals.map(item => ({
                id: `la-${item.id}`,
                user: `${item.approver.firstName} ${item.approver.lastName}`,
                action: `${item.status.toLowerCase()} leave for ${item.leaveRequest.employee.firstName}`,
                time: item.actionAt,
                initials: `${item.approver.firstName[0]}${item.approver.lastName[0]}`,
                color: item.status === 'APPROVED' ? 'bg-orange-500' : 'bg-red-500',
                timestamp: new Date(item.actionAt!).getTime()
            })),
            ...payrolls.map(item => ({
                id: `pr-${item.id}`,
                user: `${item.employee.firstName} ${item.employee.lastName}`,
                action: 'salary processed',
                time: item.processedAt,
                initials: `${item.employee.firstName[0]}${item.employee.lastName[0]}`,
                color: 'bg-green-500',
                timestamp: new Date(item.processedAt!).getTime()
            }))
        ];

        // Sort by timestamp descending
        activities.sort((a, b) => b.timestamp - a.timestamp);

        // Take top 10
        const recentActivity = activities.slice(0, 10).map(activity => {
            // specific formatter for time
            const date = new Date(activity.time as Date);
            const hours = date.getHours();
            const minutes = date.getMinutes();
            const ampm = hours >= 12 ? 'PM' : 'AM';
            const formattedTime = `${hours % 12 || 12}:${minutes.toString().padStart(2, '0')} ${ampm}`;

            return {
                ...activity,
                time: formattedTime // Replace raw date with formatted string
            };
        });

        res.json(recentActivity);
    } catch (error) {
        console.error('Error fetching dashboard activity:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

export default router;
