import { Router } from 'express';
import { prisma } from '../lib/prisma';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { sendEmail } from '../lib/email';

const router = Router();

// ... (existing login code)

// Forgot Password
router.post('/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;

        if (!email) {
            return res.status(400).json({ error: 'Email is required' });
        }

        const user = await prisma.user.findUnique({
            where: { email }
        });

        if (!user) {
            // Log for debugging but return generic message for security
            console.log(`Password reset requested for non-existent email: ${email}`);
            return res.json({ message: 'If an account exists with this email, a password reset link has been sent.' });
        }

        // Generate token
        const resetToken = crypto.randomBytes(32).toString('hex');
        const resetTokenExpires = new Date(Date.now() + 3600000); // 1 hour

        // Save token to user
        await prisma.user.update({
            where: { id: user.id },
            data: {
                resetPasswordToken: resetToken,
                resetPasswordExpires: resetTokenExpires
            }
        });

        // Send email
        const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/reset-password?token=${resetToken}`;

        const message = `
            <h1>You have requested a password reset</h1>
            <p>Please click on the following link to reset your password:</p>
            <a href="${resetUrl}" clicktracking=off>${resetUrl}</a>
            <p>This link will expire in 1 hour.</p>
            <p>If you did not request this, please ignore this email.</p>
        `;

        try {
            await sendEmail({
                to: user.email,
                subject: 'Password Reset Request',
                html: message
            });

            res.json({ message: 'If an account exists with this email, a password reset link has been sent.' });
        } catch (emailError) {
            console.error('Email sending failed:', emailError);
            user.resetPasswordToken = null;
            user.resetPasswordExpires = null;
            await prisma.user.update({
                where: { id: user.id },
                data: {
                    resetPasswordToken: null,
                    resetPasswordExpires: null
                }
            });
            return res.status(500).json({ error: 'Email could not be sent' });
        }

    } catch (error) {
        console.error('Forgot password error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Reset Password
router.post('/reset-password', async (req, res) => {
    try {
        const { token, password } = req.body;

        if (!token || !password) {
            return res.status(400).json({ error: 'Token and password are required' });
        }

        const user = await prisma.user.findFirst({
            where: {
                resetPasswordToken: token,
                resetPasswordExpires: {
                    gt: new Date()
                }
            }
        });

        if (!user) {
            return res.status(400).json({ error: 'Invalid or expired password reset token' });
        }

        // Hash new password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Update user
        await prisma.user.update({
            where: { id: user.id },
            data: {
                password: hashedPassword,
                resetPasswordToken: null,
                resetPasswordExpires: null
            }
        });

        res.json({ message: 'Password reset successful' });

    } catch (error) {
        console.error('Reset password error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});



router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }

        const user = await prisma.user.findUnique({
            where: { email },
            include: { employee: true }
        });

        if (!user) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        if (user.status !== 'ACTIVE') {
            return res.status(403).json({ error: 'Your account is not active. Please contact HR.' });
        }

        const isPasswordValid = await bcrypt.compare(password, user.password);

        if (!isPasswordValid) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        // Update last login
        await prisma.user.update({
            where: { id: user.id },
            data: { lastLoginAt: new Date() }
        });

        // Audit log
        await prisma.auditLog.create({
            data: {
                userId: user.id,
                action: 'LOGIN',
                entityType: 'User',
                entityId: user.id,
                description: `User ${user.email} logged in`
            }
        });

        // Generate JWT
        const token = jwt.sign(
            {
                id: user.id,
                email: user.email,
                role: user.role,
                employeeId: user.employee?.id
            },
            process.env.NEXTAUTH_SECRET || 'your-secret-key',
            { expiresIn: '24h' }
        );

        res.json({
            token,
            user: {
                id: user.id,
                email: user.email,
                role: user.role,
                name: user.employee ? `${user.employee.firstName} ${user.employee.lastName}` : user.email,
                employeeId: user.employee?.id,
                image: user.employee?.profileImage
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

export default router;
