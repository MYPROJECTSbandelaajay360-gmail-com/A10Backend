import { prisma } from './prisma';

interface CreateNotificationParams {
    userId: string;
    type: 'LEAVE' | 'PAYROLL' | 'ATTENDANCE' | 'SYSTEM' | 'USER' | 'WFH_REQUEST' | 'WFH_STATUS';
    title: string;
    message: string;
    link?: string;
}

/**
 * Create a notification for a specific user.
 * This stores the notification in MongoDB, making it account-specific.
 */
export async function createNotification(params: CreateNotificationParams) {
    try {
        return await prisma.notification.create({
            data: {
                userId: params.userId,
                type: params.type,
                title: params.title,
                message: params.message,
                link: params.link
            }
        });
    } catch (error) {
        console.error('Failed to create notification:', error);
        return null;
    }
}

/**
 * Create a notification for multiple users at once (e.g., for broadcasts).
 */
export async function createBulkNotifications(
    userIds: string[],
    params: Omit<CreateNotificationParams, 'userId'>
) {
    try {
        const data = userIds.map(userId => ({
            userId,
            type: params.type,
            title: params.title,
            message: params.message,
            link: params.link
        }));

        // MongoDB doesn't support createMany with relations well,
        // so we create them one by one
        const results = await Promise.allSettled(
            data.map(d => prisma.notification.create({ data: d }))
        );

        return results.filter(r => r.status === 'fulfilled').length;
    } catch (error) {
        console.error('Failed to create bulk notifications:', error);
        return 0;
    }
}
