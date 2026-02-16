import { Router, Response } from 'express';
import { prisma } from '../lib/prisma';
import { AuthRequest, authenticate } from '../middleware/auth';
import { startOfDay } from 'date-fns';
import { createNotification } from '../lib/notifications';

const router = Router();

// POST - Create WFH Request
router.post('/request', authenticate, async (req: AuthRequest, res: Response) => {
    try {
        if (!req.user?.employeeId) {
            return res.status(401).json({ error: 'Unauthorized: Employee record not found' });
        }

        const { date, reason } = req.body;
        if (!date || !reason) {
            return res.status(400).json({ error: 'Date and reason are required' });
        }

        const requestDate = startOfDay(new Date(date));
        const today = startOfDay(new Date());

        if (requestDate < today) {
            return res.status(400).json({ error: 'Cannot request WFH for past dates' });
        }

        // Check internal duplicates
        const existing = await prisma.wFHRequest.findUnique({
            where: {
                employeeId_date: {
                    employeeId: req.user.employeeId,
                    date: requestDate
                }
            }
        });

        if (existing) {
            return res.status(400).json({ error: 'WFH request already exists for this date' });
        }

        // Get Manager (Approver) - Assuming Reporting Manager
        const employee = await prisma.employee.findUnique({
            where: { id: req.user.employeeId },
            select: { reportingManagerId: true }
        });

        const wfhRequest = await prisma.wFHRequest.create({
            data: {
                employeeId: req.user.employeeId,
                date: requestDate,
                reason,
                status: 'PENDING',
                approverId: employee?.reportingManagerId // Can be null if no manager
            }
        });

        res.status(201).json(wfhRequest);

        // Notify Manager
        if (employee?.reportingManagerId) {
            const manager = await prisma.employee.findUnique({
                where: { id: employee.reportingManagerId },
                select: { userId: true }
            });
            if (manager?.userId) {
                createNotification({
                    userId: manager.userId,
                    type: 'WFH_REQUEST',
                    title: 'New WFH Request',
                    message: `An employee (${req.user.email}) has requested WFH for ${requestDate.toLocaleDateString()}.`,
                    link: '/wfh-requests' // Frontend route to be created/assumed
                });
            }
        }

    } catch (error) {
        console.error('WFH Request error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// GET - Get My Requests
router.get('/my-requests', authenticate, async (req: AuthRequest, res: Response) => {
    try {
        if (!req.user?.employeeId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const requests = await prisma.wFHRequest.findMany({
            where: { employeeId: req.user.employeeId },
            orderBy: { date: 'desc' }
        });

        res.json(requests);
    } catch (error) {
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// GET - Get Team Requests (For Managers)
router.get('/team-requests', authenticate, async (req: AuthRequest, res: Response) => {
    try {
        if (!req.user?.employeeId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        // Find requests where current user is the approver (or implies they are manager of requester)
        // Adjust logic based on how strict "approverId" is used. 
        // If approverId is set on creation, we filter by that.

        const requests = await prisma.wFHRequest.findMany({
            where: {
                approverId: req.user.employeeId,
                status: 'PENDING'
            },
            include: {
                employee: {
                    select: {
                        firstName: true,
                        lastName: true,
                        designation: { select: { name: true } },
                        profileImage: true
                    }
                }
            },
            orderBy: { date: 'asc' }
        });

        res.json(requests);
    } catch (error) {
        console.error('Team WFH error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// PATCH - Approve/Reject
router.patch('/:id/status', authenticate, async (req: AuthRequest, res: Response) => {
    try {
        if (!req.user?.employeeId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const { id } = req.params;
        const { status, rejectionReason } = req.body; // status: 'APPROVED' | 'REJECTED'

        if (!['APPROVED', 'REJECTED'].includes(status)) {
            return res.status(400).json({ error: 'Invalid status' });
        }

        const wfhRequest = await prisma.wFHRequest.findUnique({
            where: { id }
        });

        if (!wfhRequest) {
            return res.status(404).json({ error: 'Request not found' });
        }

        // Verify Authorizer (Must be the assigned approver)
        if (wfhRequest.approverId !== req.user.employeeId) {
            // Optional: Allow Admin role to override? validation mostly enough for now.
            return res.status(403).json({ error: 'Not authorized to approve this request' });
        }

        const updated = await prisma.wFHRequest.update({
            where: { id },
            data: {
                status,
                rejectionReason: status === 'REJECTED' ? rejectionReason : null
            }
        });

        res.json(updated);

        // Notify Requester
        const employee = await prisma.employee.findUnique({
            where: { id: wfhRequest.employeeId },
            select: { userId: true }
        });

        if (employee?.userId) {
            createNotification({
                userId: employee.userId,
                type: 'WFH_STATUS',
                title: `WFH Request ${status === 'APPROVED' ? 'Approved' : 'Rejected'}`,
                message: `Your WFH request for ${new Date(wfhRequest.date).toLocaleDateString()} has been ${status.toLowerCase()}.`,
                link: '/attendance'
            });
        }

    } catch (error) {
        console.error('WFH Status Update error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

export default router;
