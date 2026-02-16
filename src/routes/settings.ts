import { Router, Response } from 'express';
import { prisma } from '../lib/prisma';
import { AuthRequest, authenticate } from '../middleware/auth';

const router = Router();

// GET - Fetch all settings
router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
    try {
        const settings = await prisma.systemSetting.findMany();

        // Convert to a flat key-value object for easy use
        const settingsObj: Record<string, string> = {};
        settings.forEach(s => {
            settingsObj[s.key] = s.value;
        });

        // Structure the response to match what the frontend expects
        res.json({
            officeLocation: {
                name: settingsObj['office_name'] || 'Hyderabad Office',
                latitude: settingsObj['office_latitude'] || '17.4438',
                longitude: settingsObj['office_longitude'] || '78.3831',
                radius: settingsObj['office_radius'] || '500'
            },
            wifiIPs: settingsObj['office_wifi_ips'] ? JSON.parse(settingsObj['office_wifi_ips']) : [],
            company: {
                name: settingsObj['company_name'] || 'CognitBotz Technologies',
                timezone: settingsObj['timezone'] || 'Asia/Kolkata',
                workStartTime: settingsObj['work_start_time'] || '09:00',
                workEndTime: settingsObj['work_end_time'] || '18:00',
                checkinWindowStart: settingsObj['checkin_window_start'] || '09:00',
                checkinWindowEnd: settingsObj['checkin_window_end'] || '10:30',
                checkoutWindowStart: settingsObj['checkout_window_start'] || '18:30',
                checkoutWindowEnd: settingsObj['checkout_window_end'] || '20:30'
            }
        });
    } catch (error) {
        console.error('Error fetching settings:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// POST - Update settings (Admin only)
router.post('/', authenticate, async (req: AuthRequest, res: Response) => {
    try {
        if (!['ADMIN', 'CEO'].includes(req.user?.role || '')) {
            return res.status(403).json({ error: 'Forbidden: Admin access required' });
        }

        const { officeLocation, wifiIPs, company } = req.body;

        const settingsToSave = [
            { key: 'office_name', value: officeLocation?.name, category: 'ATTENDANCE' },
            { key: 'office_latitude', value: String(officeLocation?.latitude), category: 'ATTENDANCE' },
            { key: 'office_longitude', value: String(officeLocation?.longitude), category: 'ATTENDANCE' },
            { key: 'office_radius', value: String(officeLocation?.radius), category: 'ATTENDANCE' },
            { key: 'office_wifi_ips', value: JSON.stringify(wifiIPs || []), category: 'ATTENDANCE' },
            { key: 'company_name', value: company?.name, category: 'GENERAL' },
            { key: 'timezone', value: company?.timezone, category: 'GENERAL' },
            { key: 'work_start_time', value: company?.workStartTime, category: 'GENERAL' },
            { key: 'work_end_time', value: company?.workEndTime, category: 'GENERAL' },
            { key: 'checkin_window_start', value: company?.checkinWindowStart, category: 'ATTENDANCE' },
            { key: 'checkin_window_end', value: company?.checkinWindowEnd, category: 'ATTENDANCE' },
            { key: 'checkout_window_start', value: company?.checkoutWindowStart, category: 'ATTENDANCE' },
            { key: 'checkout_window_end', value: company?.checkoutWindowEnd, category: 'ATTENDANCE' }
        ];

        for (const setting of settingsToSave) {
            if (setting.value === undefined) continue;

            await prisma.systemSetting.upsert({
                where: { key: setting.key },
                update: { value: setting.value },
                create: {
                    key: setting.key,
                    value: setting.value,
                    category: setting.category
                }
            });
        }

        res.json({ message: 'Settings updated successfully' });
    } catch (error) {
        console.error('Error updating settings:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

export default router;
