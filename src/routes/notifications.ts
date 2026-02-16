import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { AuthRequest, authenticate } from '../middleware/auth';

const router = Router();

// GET all notifications for the current user
router.get('/', authenticate, async (req: AuthRequest, res) => {
    try {
        const notifications = await prisma.notification.findMany({
            where: {
                userId: req.user!.id
            },
            orderBy: {
                createdAt: 'desc'
            },
            take: 50
        });

        const unreadCount = await prisma.notification.count({
            where: {
                userId: req.user!.id,
                isRead: false
            }
        });

        res.json({
            notifications: notifications.map(n => ({
                id: n.id,
                type: n.type,
                title: n.title,
                message: n.message,
                isRead: n.isRead,
                createdAt: n.createdAt.toISOString(),
                link: n.link
            })),
            unreadCount
        });
    } catch (error) {
        console.error('Error fetching notifications:', error);
        res.status(500).json({ error: 'Failed to fetch notifications' });
    }
});

// PATCH - Mark a notification as read
router.patch('/:id/read', authenticate, async (req: AuthRequest, res) => {
    try {
        const { id } = req.params;
        await prisma.notification.update({
            where: {
                id,
                userId: req.user!.id
            },
            data: {
                isRead: true,
                readAt: new Date()
            }
        });

        res.json({ success: true });
    } catch (error) {
        console.error('Error marking notification as read:', error);
        res.status(500).json({ error: 'Failed to mark notification as read' });
    }
});

// PATCH - Mark all notifications as read
router.patch('/read-all', authenticate, async (req: AuthRequest, res) => {
    try {
        await prisma.notification.updateMany({
            where: {
                userId: req.user!.id,
                isRead: false
            },
            data: {
                isRead: true,
                readAt: new Date()
            }
        });

        res.json({ success: true });
    } catch (error) {
        console.error('Error marking all notifications as read:', error);
        res.status(500).json({ error: 'Failed to mark notifications as read' });
    }
});

// DELETE - Delete a single notification
router.delete('/:id', authenticate, async (req: AuthRequest, res) => {
    try {
        const { id } = req.params;
        await prisma.notification.delete({
            where: {
                id,
                userId: req.user!.id
            }
        });

        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting notification:', error);
        res.status(500).json({ error: 'Failed to delete notification' });
    }
});

// DELETE - Clear all notifications for the current user
router.delete('/', authenticate, async (req: AuthRequest, res) => {
    try {
        await prisma.notification.deleteMany({
            where: {
                userId: req.user!.id
            }
        });

        res.json({ success: true });
    } catch (error) {
        console.error('Error clearing notifications:', error);
        res.status(500).json({ error: 'Failed to clear notifications' });
    }
});

export default router;
