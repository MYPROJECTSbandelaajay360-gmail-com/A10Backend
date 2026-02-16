import { Router } from 'express';
import { prisma } from '../lib/prisma';
import bcrypt from 'bcryptjs';
import { generateEmployeeId } from '../utils';
import { AuthRequest, authenticate, authorize } from '../middleware/auth';

const router = Router();

// GET all employees
// GET all employees
router.get('/', authenticate, async (req: AuthRequest, res) => {
    try {
        const search = req.query.search as string;
        const department = req.query.department as string;
        const status = req.query.status as string;
        const page = parseInt(req.query.page as string || '1');
        const limit = parseInt(req.query.limit as string || '10');
        const skip = (page - 1) * limit;

        const whereClause: any = {};

        if (search) {
            whereClause.OR = [
                { firstName: { contains: search, mode: 'insensitive' } },
                { lastName: { contains: search, mode: 'insensitive' } },
                { email: { contains: search, mode: 'insensitive' } },
                { employeeId: { contains: search, mode: 'insensitive' } }
            ];
        }

        if (department && department !== 'All') {
            whereClause.department = { name: department };
        }

        if (status && status !== 'All') {
            whereClause.user = { status };
        }

        const [employees, total] = await Promise.all([
            prisma.employee.findMany({
                where: whereClause,
                include: {
                    user: {
                        select: {
                            id: true,
                            email: true,
                            role: true,
                            status: true,
                            lastLoginAt: true
                        }
                    },
                    department: true,
                    designation: true,
                    reportingManager: {
                        select: {
                            id: true,
                            firstName: true,
                            lastName: true
                        }
                    },
                    shift: true
                },
                orderBy: { createdAt: 'desc' },
                skip,
                take: limit
            }),
            prisma.employee.count({ where: whereClause })
        ]);

        res.json({
            data: employees,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        console.error('Employees GET error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// GET - Fetch all departments
router.get('/departments', authenticate, async (req, res) => {
    try {
        const departments = await prisma.department.findMany({
            orderBy: { name: 'asc' }
        });
        res.json(departments);
    } catch (error) {
        console.error('Departments GET error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// GET - Fetch all designations
router.get('/designations', authenticate, async (req, res) => {
    try {
        const designations = await prisma.designation.findMany({
            orderBy: { name: 'asc' }
        });
        res.json(designations);
    } catch (error) {
        console.error('Designations GET error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});


// POST - Accept employee invite (public endpoint - no auth required)
router.post('/accept-invite', async (req, res) => {
    try {
        const {
            token, password, email, firstName, lastName, phone,
            department, designation, employeeId: providedEmployeeId,
            joiningDate, salary, reportingManager
        } = req.body;

        // Validation
        if (!email || !password || !firstName || !lastName) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // Check if email already exists
        const existingUser = await prisma.user.findUnique({ where: { email } });
        if (existingUser) {
            return res.status(400).json({ error: 'Email already registered' });
        }

        // Find department and designation by name (SQLite compatible)
        let departmentRecord = department ? await prisma.department.findFirst({
            where: { name: { contains: department } }
        }) : null;

        let designationRecord = designation ? await prisma.designation.findFirst({
            where: { name: { contains: designation } }
        }) : null;

        // Fallback to first available if not found (required fields)
        if (!departmentRecord) {
            departmentRecord = await prisma.department.findFirst();
        }
        if (!designationRecord) {
            designationRecord = await prisma.designation.findFirst();
        }

        if (!departmentRecord || !designationRecord) {
            return res.status(500).json({ error: 'System not properly configured. Please contact administrator.' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const employeeId = providedEmployeeId || generateEmployeeId('EMP');

        const result = await prisma.$transaction(async (tx) => {
            // Create user account
            const user = await tx.user.create({
                data: {
                    email,
                    password: hashedPassword,
                    role: 'EMPLOYEE',
                    status: 'ACTIVE'
                }
            });

            // Create employee profile
            const employee = await tx.employee.create({
                data: {
                    employeeId,
                    userId: user.id,
                    firstName,
                    lastName,
                    email,
                    phone: phone || undefined,
                    departmentId: departmentRecord!.id,
                    designationId: designationRecord!.id,
                    joiningDate: joiningDate ? new Date(joiningDate) : new Date(),
                    employmentType: 'FULL_TIME'
                },
                include: {
                    department: true,
                    designation: true
                }
            });

            // Initialize leave balances
            const currentYear = new Date().getFullYear();
            const leaveTypes = await tx.leaveTypeConfig.findMany({ where: { isActive: true } });

            await Promise.all(
                leaveTypes.map(lt =>
                    tx.leaveBalance.create({
                        data: {
                            employeeId: employee.id,
                            leaveTypeId: lt.id,
                            year: currentYear,
                            allocated: lt.defaultBalance,
                            used: 0,
                            pending: 0,
                            carriedForward: 0,
                            adjustment: 0
                        }
                    })
                )
            );

            return { user, employee };
        });

        // Create welcome notification
        await prisma.notification.create({
            data: {
                userId: result.user.id,
                type: 'GENERAL',
                title: 'Welcome to the team!',
                message: 'Your account has been created successfully. Please update your profile.',
                link: '/profile'
            }
        });

        console.log(`[Backend] Employee account created: ${email} (${employeeId})`);

        res.json({
            success: true,
            message: 'Account created successfully',
            user: {
                id: result.user.id,
                email: result.user.email,
                employeeId: result.employee.employeeId,
                firstName: result.employee.firstName,
                lastName: result.employee.lastName
            }
        });
    } catch (error) {
        console.error('[Backend] Accept Invite Error:', error);
        res.status(500).json({ error: 'Failed to create account' });
    }
});

// POST - Create new employee
router.post('/', authenticate, authorize(['HR', 'ADMIN']), async (req: AuthRequest, res) => {
    try {
        const body = req.body;
        const {
            firstName, lastName, email, phone, dateOfBirth, gender,
            address, city, state, country, postalCode, emergencyContact,
            emergencyPhone, departmentId, designationId, reportingManagerId,
            joiningDate, employmentType, shiftId, role, password
        } = body;

        // Validation
        if (!firstName || !lastName || !email || !departmentId || !designationId || !joiningDate) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const existingUser = await prisma.user.findUnique({ where: { email } });
        if (existingUser) {
            return res.status(400).json({ error: 'Email already exists' });
        }

        const hashedPassword = await bcrypt.hash(password || 'Welcome@123', 10);
        const employeeId = generateEmployeeId('EMP');

        const result = await prisma.$transaction(async (tx) => {
            const user = await tx.user.create({
                data: {
                    email,
                    password: hashedPassword,
                    role: role || 'EMPLOYEE',
                    status: 'ACTIVE'
                }
            });

            const employee = await tx.employee.create({
                data: {
                    employeeId,
                    userId: user.id,
                    firstName, lastName, email, phone,
                    dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
                    gender, address, city, state, country, postalCode,
                    emergencyContact, emergencyPhone, departmentId, designationId,
                    reportingManagerId,
                    joiningDate: new Date(joiningDate),
                    employmentType: employmentType || 'FULL_TIME',
                    shiftId
                },
                include: {
                    department: true,
                    designation: true
                }
            });

            // Initialize leave balances
            const currentYear = new Date().getFullYear();
            const leaveTypes = await tx.leaveTypeConfig.findMany({ where: { isActive: true } });

            await Promise.all(
                leaveTypes.map(lt =>
                    tx.leaveBalance.create({
                        data: {
                            employeeId: employee.id,
                            leaveTypeId: lt.id,
                            year: currentYear,
                            allocated: lt.defaultBalance,
                            used: 0,
                            pending: 0,
                            carriedForward: 0,
                            adjustment: 0
                        }
                    })
                )
            );

            return { user, employee };
        });

        // Notifications and Audit logs
        await prisma.notification.create({
            data: {
                userId: result.user.id,
                type: 'GENERAL',
                title: 'Welcome to ABC Company!',
                message: 'Your account has been created. Please update your profile.',
                link: '/profile'
            }
        });

        await prisma.auditLog.create({
            data: {
                userId: req.user!.id,
                action: 'CREATE',
                entityType: 'Employee',
                entityId: result.employee.id,
                description: `Created new employee: ${firstName} ${lastName} (${employeeId})`
            }
        });

        res.json({
            data: result.employee,
            message: 'Employee created successfully'
        });
    } catch (error) {
        console.error('Employees POST error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// GET - Get single employee by ID
router.get('/:id', authenticate, async (req: AuthRequest, res) => {
    try {
        const { id } = req.params;
        const employee = await prisma.employee.findUnique({
            where: { id },
            include: {
                user: {
                    select: {
                        id: true,
                        email: true,
                        role: true,
                        status: true
                    }
                },
                department: true,
                designation: true,
                reportingManager: {
                    select: {
                        id: true,
                        firstName: true,
                        lastName: true
                    }
                },
                shift: true
            }
        });

        if (!employee) {
            return res.status(404).json({ error: 'Employee not found' });
        }

        res.json({ data: employee });
    } catch (error) {
        console.error('Employee GET error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// PATCH - Update employee
router.patch('/:id', authenticate, authorize(['HR', 'ADMIN']), async (req: AuthRequest, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;

        // Prevent updating critical fields directly or validation needed
        delete updates.employeeId;
        delete updates.userId;

        // Handle Department and Designation updates by name
        if (updates.department) {
            const dept = await prisma.department.findFirst({
                where: { name: { contains: updates.department } }
            });
            if (dept) {
                updates.departmentId = dept.id;
            }
            delete updates.department;
        }

        if (updates.designation) {
            const desig = await prisma.designation.findFirst({
                where: { name: { contains: updates.designation } }
            });
            if (desig) {
                updates.designationId = desig.id;
            }
            delete updates.designation;
        }

        const parseDate = (dateStr: any) => {
            if (!dateStr) return undefined;
            const date = new Date(dateStr);
            return isNaN(date.getTime()) ? undefined : date;
        };

        const employee = await prisma.employee.update({
            where: { id },
            data: {
                ...updates,
                joiningDate: parseDate(updates.joiningDate),
                dateOfBirth: parseDate(updates.dateOfBirth),
                confirmationDate: parseDate(updates.confirmationDate),
                resignationDate: parseDate(updates.resignationDate),
                lastWorkingDate: parseDate(updates.lastWorkingDate),
            },
            include: {
                department: true,
                designation: true
            }
        });

        await prisma.auditLog.create({
            data: {
                userId: req.user!.id,
                action: 'UPDATE',
                entityType: 'Employee',
                entityId: id,
                description: `Updated profile for ${employee.firstName} ${employee.lastName}`
            }
        });

        res.json({ data: employee, message: 'Employee updated successfully' });
    } catch (error) {
        console.error('Employee UPDATE error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// DELETE - Delete employee
router.delete('/:id', authenticate, authorize(['HR', 'ADMIN']), async (req: AuthRequest, res) => {
    try {
        const { id } = req.params;

        // Check if employee exists
        const employee = await prisma.employee.findUnique({
            where: { id },
            include: { user: true }
        });

        if (!employee) {
            return res.status(404).json({ error: 'Employee not found' });
        }

        // Delete user (cascade should handle employee, but let's be safe and delete user which is the parent)
        await prisma.user.delete({
            where: { id: employee.userId }
        });

        await prisma.auditLog.create({
            data: {
                userId: req.user!.id,
                action: 'DELETE',
                entityType: 'Employee',
                entityId: id,
                description: `Deleted employee ${employee.firstName} ${employee.lastName}`
            }
        });

        res.json({ message: 'Employee deleted successfully' });
    } catch (error) {
        console.error('Employee DELETE error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

export default router;
