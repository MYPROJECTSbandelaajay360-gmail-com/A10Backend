import { Router, Response } from 'express';
import { prisma } from '../lib/prisma';
import { AuthRequest, authenticate, authorize } from '../middleware/auth';

const router = Router();

// GET - Get holidays
router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
    try {
        const year = parseInt(req.query.year as string || new Date().getFullYear().toString());
        const type = req.query.type as string;
        const upcoming = req.query.upcoming === 'true';

        const whereClause: any = {
            year,
            isActive: true
        };

        if (type && type !== 'all') {
            whereClause.type = type.toUpperCase();
        }

        if (upcoming) {
            whereClause.date = {
                gte: new Date()
            };
        }

        const holidays = await prisma.holiday.findMany({
            where: whereClause,
            orderBy: { date: 'asc' }
        });

        res.json({ data: holidays });
    } catch (error) {
        console.error('Holidays GET error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// POST - Create holiday (HR/Admin only)
router.post('/', authenticate, authorize(['HR', 'ADMIN']), async (req: AuthRequest, res: Response) => {
    try {
        const { name, date, description, type, isOptional } = req.body;

        if (!name || !date) {
            return res.status(400).json({ error: 'Name and date are required' });
        }

        const holidayDate = new Date(date);
        const year = holidayDate.getFullYear();

        // Check if holiday already exists on this date
        const existingHoliday = await prisma.holiday.findFirst({
            where: { date: holidayDate }
        });

        if (existingHoliday) {
            return res.status(400).json({ error: 'A holiday already exists on this date' });
        }

        const holiday = await prisma.holiday.create({
            data: {
                name,
                date: holidayDate,
                description,
                type: type || 'PUBLIC',
                isOptional: isOptional || false,
                year,
                isActive: true
            }
        });

        // Auto-mark attendance for all employees on this holiday
        if (type === 'PUBLIC') {
            const employees = await prisma.employee.findMany({
                where: {
                    user: { status: 'ACTIVE' }
                },
                select: { id: true }
            });

            await Promise.all(
                employees.map(emp =>
                    prisma.attendance.upsert({
                        where: {
                            employeeId_date: {
                                employeeId: emp.id,
                                date: holidayDate
                            }
                        },
                        update: {
                            status: 'HOLIDAY',
                            isAutoMarked: true,
                            autoMarkReason: `Public Holiday: ${name}`
                        },
                        create: {
                            employeeId: emp.id,
                            date: holidayDate,
                            status: 'HOLIDAY',
                            isAutoMarked: true,
                            autoMarkReason: `Public Holiday: ${name}`
                        }
                    })
                )
            );

            // Create notification for all users
            const users = await prisma.user.findMany({
                where: { status: 'ACTIVE' },
                select: { id: true }
            });

            await Promise.all(
                users.map(user =>
                    prisma.notification.create({
                        data: {
                            userId: user.id,
                            type: 'HOLIDAY',
                            title: 'New Holiday Announced',
                            message: `${name} on ${holidayDate.toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}`,
                            link: '/holidays'
                        }
                    })
                )
            );
        }

        // Create audit log
        await prisma.auditLog.create({
            data: {
                userId: req.user!.id,
                action: 'CREATE',
                entityType: 'Holiday',
                entityId: holiday.id,
                description: `Created holiday: ${name} on ${date}`
            }
        });

        res.json({
            data: holiday,
            message: 'Holiday created successfully'
        });
    } catch (error) {
        console.error('Holidays POST error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// DELETE - Delete holiday (Admin only)
router.delete('/:id', authenticate, authorize(['ADMIN']), async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;

        if (!id) {
            return res.status(400).json({ error: 'Holiday ID is required' });
        }

        const holiday = await prisma.holiday.findUnique({
            where: { id }
        });

        if (!holiday) {
            return res.status(404).json({ error: 'Holiday not found' });
        }

        // Soft delete by setting isActive to false
        await prisma.holiday.update({
            where: { id },
            data: { isActive: false }
        });

        // Create audit log
        await prisma.auditLog.create({
            data: {
                userId: req.user!.id,
                action: 'DELETE',
                entityType: 'Holiday',
                entityId: id,
                description: `Deleted holiday: ${holiday.name}`
            }
        });

        res.json({ message: 'Holiday deleted successfully' });
    } catch (error) {
        console.error('Holidays DELETE error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

export default router;
