import { Router, Response } from 'express';
import { prisma } from '../lib/prisma';
import { AuthRequest, authenticate } from '../middleware/auth';
import { startOfDay, isBefore, isAfter, parse } from 'date-fns';
import { createNotification } from '../lib/notifications';

const router = Router();

// Helper to check if current time is within a setting range
// Helper to check if current time is within a setting range
async function isWithinSettingRange(keyStart: string, keyEnd: string, now: Date): Promise<{ valid: boolean; start?: string; end?: string }> {
    const settings = await prisma.systemSetting.findMany({
        where: { key: { in: [keyStart, keyEnd] } }
    });

    const startStr = settings.find(s => s.key === keyStart)?.value;
    const endStr = settings.find(s => s.key === keyEnd)?.value;

    if (!startStr || !endStr) return { valid: true }; // No setting, allow anytime

    const todayStr = now.toISOString().split('T')[0];
    const startTime = parse(`${todayStr} ${startStr}`, 'yyyy-MM-dd HH:mm', new Date());
    const endTime = parse(`${todayStr} ${endStr}`, 'yyyy-MM-dd HH:mm', new Date());

    return {
        valid: now >= startTime && now <= endTime,
        start: startStr,
        end: endStr
    };
}

function getDistanceFromLatLonInMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
    var R = 6371; // Radius of the earth in km
    var dLat = deg2rad(lat2 - lat1);  // deg2rad below
    var dLon = deg2rad(lon2 - lon1);
    var a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2)
        ;
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    var d = R * c; // Distance in km
    return d * 1000;
}

function deg2rad(deg: number) {
    return deg * (Math.PI / 180);
}

// GET - Get attendance for logged in user or specific date
router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
    try {
        if (!req.user?.employeeId) {
            return res.status(401).json({ error: 'Unauthorized: Employee record not found' });
        }

        const month = req.query.month as string;
        const year = req.query.year as string;

        // Get monthly attendance
        if (month && year) {
            const startDate = new Date(parseInt(year), parseInt(month) - 1, 1);
            const endDate = new Date(parseInt(year), parseInt(month), 0, 23, 59, 59);

            const attendances = await prisma.attendance.findMany({
                where: {
                    employeeId: req.user.employeeId,
                    date: {
                        gte: startDate,
                        lte: endDate
                    }
                },
                include: {
                    employee: {
                        select: {
                            firstName: true,
                            lastName: true
                        }
                    }
                },
                orderBy: { date: 'desc' }
            });

            // Calculate stats for the frontend
            const presentDays = attendances.filter(r => r.status === 'PRESENT' || r.status === 'HALF_DAY').length;
            const absentDays = attendances.filter(r => r.status === 'ABSENT').length;
            const leaveDays = attendances.filter(r => r.status === 'ON_LEAVE').length;
            const totalHours = attendances.reduce((sum, r) => sum + (r.workingHours || 0), 0);

            // Today's status
            const today = startOfDay(new Date());
            const todayRecord = attendances.find(r => startOfDay(new Date(r.date)).getTime() === today.getTime());

            // --- FETCH SYSTEM SETTINGS FOR CONFIG ---
            const settings = await prisma.systemSetting.findMany({
                where: {
                    key: {
                        in: [
                            'office_name', 'office_latitude', 'office_longitude', 'office_radius',
                            'checkin_window_start', 'checkin_window_end',
                            'checkout_window_start', 'checkout_window_end'
                        ]
                    }
                }
            });

            const settingsMap: Record<string, string> = {};
            settings.forEach(s => settingsMap[s.key] = s.value);

            const officeConfig = {
                name: settingsMap['office_name'] || 'Hyderabad Office',
                latitude: parseFloat(settingsMap['office_latitude'] || '17.4438'),
                longitude: parseFloat(settingsMap['office_longitude'] || '78.3831'),
                radius: parseInt(settingsMap['office_radius'] || '500')
            };

            const timeWindows = {
                checkInStart: settingsMap['checkin_window_start'],
                checkInEnd: settingsMap['checkin_window_end'],
                checkOutStart: settingsMap['checkout_window_start'],
                checkOutEnd: settingsMap['checkout_window_end']
            };

            return res.json({
                records: attendances,
                stats: { presentDays, absentDays, leaveDays, totalHours },
                todayStatus: todayRecord ? {
                    isCheckedIn: !!todayRecord.checkInTime,
                    isCheckedOut: !!todayRecord.checkOutTime,
                    checkInTime: todayRecord.checkInTime,
                    checkOutTime: todayRecord.checkOutTime
                } : null,
                officeConfig,
                timeWindows,
                pendingCheckOuts: await prisma.attendance.findMany({
                    where: {
                        employeeId: req.user.employeeId,
                        checkOutTime: null,
                        date: { lt: today }
                    },
                    orderBy: { date: 'desc' }
                })
            });
        }

        return res.status(400).json({ error: 'Month and year are required' });
    } catch (error) {
        console.error('Attendance GET error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// POST - Check In
router.post('/check-in', authenticate, async (req: AuthRequest, res: Response) => {
    try {
        if (!req.user?.employeeId) {
            return res.status(401).json({ error: 'Unauthorized: Employee record not found' });
        }

        const { latitude, longitude, workMode } = req.body; // workMode: 'OFFICE' | 'WFH'
        // Detect IP from request (trusted proxies should be configured if behind Nginx/LoadBalancer)
        const ipAddress = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.socket.remoteAddress || '';

        const now = new Date();
        const today = startOfDay(now);

        let validatedWorkMode = 'OFFICE'; // Default

        // Fetch Settings for Validation
        const settings = await prisma.systemSetting.findMany({
            where: {
                key: {
                    in: [
                        'office_latitude', 'office_longitude', 'office_radius', 'office_ip_addresses',
                        'checkin_window_start', 'checkin_window_end'
                    ]
                }
            }
        });
        const settingsMap: Record<string, string> = {};
        settings.forEach(s => settingsMap[s.key] = s.value);

        if (workMode === 'WFH') {
            // 1. Verify APPROVED WFH Request for today
            const wfhRequest = await prisma.wFHRequest.findUnique({
                where: {
                    employeeId_date: {
                        employeeId: req.user.employeeId,
                        date: today
                    }
                }
            });

            if (!wfhRequest || wfhRequest.status !== 'APPROVED') {
                return res.status(403).json({
                    error: 'Work From Home is not authorized for today. Please submit a request and get approval.'
                });
            }

            validatedWorkMode = 'WFH';
            // Skip Location/IP validation for WFH
        } else {
            // OFFICE Mode - Enforce Location OR IP

            // A. Time Window Check (Global or Office-Specific? Keeping it for check-in discipline)
            const windowCheck = await isWithinSettingRange('checkin_window_start', 'checkin_window_end', now);
            if (!windowCheck.valid) {
                return res.status(403).json({
                    error: `Check-in is only allowed between ${windowCheck.start} and ${windowCheck.end}.`
                });
            }

            // B. Geofencing Check
            const officeLat = parseFloat(settingsMap['office_latitude'] || '0');
            const officeLng = parseFloat(settingsMap['office_longitude'] || '0');
            const officeRadius = parseFloat(settingsMap['office_radius'] || '500'); // meters

            let isWithinLocation = false;

            if (latitude && longitude && officeLat && officeLng) {
                const distance = getDistanceFromLatLonInMeters(latitude, longitude, officeLat, officeLng);
                if (distance <= officeRadius) {
                    isWithinLocation = true;
                }
            }

            // C. IP Check
            const allowedIPs = (settingsMap['office_ip_addresses'] || '').split(',').map(ip => ip.trim()).filter(Boolean);
            let isIPMatch = false;
            if (allowedIPs.length > 0) {
                // Simple substring/exact match (CIDR support would be better but manual for now)
                // Checking if client IP is in the list
                isIPMatch = allowedIPs.includes(ipAddress) || allowedIPs.includes('::1') && ipAddress === '::1'; // Localhost handle
            }

            // D. Condition: IP OR Location MUST match
            if (!isWithinLocation && !isIPMatch) {
                return res.status(403).json({
                    error: 'You must be in the Office Location OR connected to Office Network to check in.',
                    details: {
                        locationValid: isWithinLocation,
                        ipValid: isIPMatch,
                        yourIP: ipAddress
                    }
                });
            }
        }

        // Check if already checked in today
        const existingAttendance = await prisma.attendance.findFirst({
            where: {
                employeeId: req.user.employeeId,
                date: today
            }
        });

        if (existingAttendance?.checkInTime) {
            return res.status(400).json({ error: 'Already checked in today' });
        }

        // Get employee's shift for late calculation
        const employee = await prisma.employee.findUnique({
            where: { id: req.user.employeeId },
            include: { shift: true }
        });

        let isLate = false;
        let lateByMinutes = 0;

        if (employee?.shift) {
            const [shiftHours, shiftMinutes] = employee.shift.endTime.split(':').map(Number);
            // NOTE: Logic correction -> shift.startTime for check-in
            const [startH, startM] = employee.shift.startTime.split(':').map(Number);
            const shiftStart = new Date(today);
            shiftStart.setHours(startH, startM, 0, 0);

            const graceEnd = new Date(shiftStart);
            graceEnd.setMinutes(graceEnd.getMinutes() + employee.shift.graceMinutes);

            if (now > graceEnd) {
                isLate = true;
                lateByMinutes = Math.floor((now.getTime() - shiftStart.getTime()) / (1000 * 60));
            }
        }

        // Create or update attendance record
        const attendance = await prisma.attendance.upsert({
            where: {
                employeeId_date: {
                    employeeId: req.user.employeeId,
                    date: today
                }
            },
            update: {
                checkInTime: now,
                status: 'PRESENT',
                workMode: validatedWorkMode,
                isLateLogin: isLate,
                lateByMinutes,
                checkInLatitude: latitude,
                checkInLongitude: longitude,
                checkInIP: ipAddress
            },
            create: {
                employeeId: req.user.employeeId,
                date: today,
                checkInTime: now,
                status: 'PRESENT',
                workMode: validatedWorkMode,
                isLateLogin: isLate,
                lateByMinutes,
                checkInLatitude: latitude,
                checkInLongitude: longitude,
                checkInIP: ipAddress
            }
        });

        res.json({
            data: attendance,
            message: isLate ? `Checked in ${lateByMinutes} minutes late (${validatedWorkMode})` : `Checked in successfully (${validatedWorkMode})`
        });

        // Create notification for the user
        if (req.user?.id) {
            const modeText = validatedWorkMode === 'WFH' ? ' (Home)' : ' (Office)';
            if (isLate) {
                createNotification({
                    userId: req.user.id,
                    type: 'ATTENDANCE',
                    title: 'Late Check-in Alert',
                    message: `You checked in ${lateByMinutes} minutes late today${modeText}.`,
                    link: '/attendance'
                });
            } else {
                createNotification({
                    userId: req.user.id,
                    type: 'ATTENDANCE',
                    title: 'Checked In Successfully',
                    message: `You checked in at ${now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}${modeText}.`,
                    link: '/attendance'
                });
            }
        }
    } catch (error) {
        console.error('Attendance POST error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// PATCH - Check Out
router.patch('/check-out', authenticate, async (req: AuthRequest, res: Response) => {
    try {
        if (!req.user?.employeeId) {
            return res.status(401).json({ error: 'Unauthorized: Employee record not found' });
        }

        const { latitude, longitude, ipAddress } = req.body;
        const now = new Date();
        const today = startOfDay(now);

        // Get today's attendance
        const existingAttendance = await prisma.attendance.findFirst({
            where: {
                employeeId: req.user.employeeId,
                date: today
            }
        });

        // Validation based on Work Mode
        // If Work Mode is OFFICE (or undefined/null defaulting to OFFICE logic), check windows.
        // If WFH, we permit check-out without strict window/location.
        const isWFH = existingAttendance?.workMode === 'WFH';

        if (!isWFH) {
            // --- DYNAMIC TIME RANGE VALIDATION FOR OFFICE ---
            const windowCheck = await isWithinSettingRange('checkout_window_start', 'checkout_window_end', now);
            if (!windowCheck.valid) {
                return res.status(403).json({
                    error: `Check-out is only allowed between ${windowCheck.start} and ${windowCheck.end}.`
                });
            }
        }

        if (!existingAttendance?.checkInTime) {
            return res.status(400).json({ error: 'Not checked in today' });
        }

        if (existingAttendance.checkOutTime) {
            return res.status(400).json({ error: 'Already checked out today' });
        }

        // Get employee's shift for early logout calculation
        const employee = await prisma.employee.findUnique({
            where: { id: req.user.employeeId },
            include: { shift: true }
        });

        let isEarlyLogout = false;
        let earlyByMinutes = 0;

        if (employee?.shift) {
            const [shiftHours, shiftMinutes] = employee.shift.endTime.split(':').map(Number);
            const shiftEnd = new Date(today);
            shiftEnd.setHours(shiftHours, shiftMinutes, 0, 0);

            if (now < shiftEnd) {
                isEarlyLogout = true;
                earlyByMinutes = Math.floor((shiftEnd.getTime() - now.getTime()) / (1000 * 60));
            }
        }

        // Calculate working hours
        const checkInTime = new Date(existingAttendance.checkInTime);
        const workingMinutes = Math.floor((now.getTime() - checkInTime.getTime()) / (1000 * 60));
        const workingHours = Math.round((workingMinutes / 60) * 100) / 100;

        // Update attendance record
        const attendance = await prisma.attendance.update({
            where: { id: existingAttendance.id },
            data: {
                checkOutTime: now,
                workingHours,
                effectiveHours: workingHours,
                isEarlyLogout,
                earlyByMinutes,
                checkOutLatitude: latitude,
                checkOutLongitude: longitude,
                checkOutIP: ipAddress
            }
        });

        res.json({
            data: attendance,
            message: `Checked out successfully. Worked ${workingHours} hours.`
        });

        // Create notification for the user
        if (req.user?.id) {
            createNotification({
                userId: req.user.id,
                type: 'ATTENDANCE',
                title: 'Checked Out Successfully',
                message: `You worked ${workingHours} hours today.${isEarlyLogout ? ` Left ${earlyByMinutes} minutes early.` : ''}`,
                link: '/attendance'
            });
        }
    } catch (error) {
        console.error('Attendance PATCH error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

export default router;
