import { Router } from 'express';
import { prisma } from '../lib/prisma';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { AuthRequest, authenticate, authorize } from '../middleware/auth';
import {
    createRazorpayOrder,
    verifyRazorpaySignature,
    fetchPaymentDetails,
    isRazorpayConfigured,
    getRazorpayKeyId,
    verifyWebhookSignature,
} from '../lib/razorpay';
import { generateEmployeeId } from '../utils';

const router = Router();

// ==================== PUBLIC ROUTES ====================

/**
 * GET /api/subscription/plans - Get all available subscription plans
 */
router.get('/plans', async (req, res) => {
    try {
        const plans = await prisma.subscriptionPlan.findMany({
            where: { isActive: true },
            orderBy: { sortOrder: 'asc' },
            select: {
                id: true,
                name: true,
                slug: true,
                monthlyPrice: true,
                yearlyPrice: true,
                currency: true,
                maxEmployees: true,
                features: true,
                description: true,
                isCustom: true,
                trialDays: true,
                hasPayroll: true,
                hasAdvancedAnalytics: true,
                hasCustomIntegrations: true,
                hasPrioritySupport: true,
                hasDedicatedManager: true,
                hasCustomWorkflows: true,
                hasSLA: true,
                hasOnPremise: true,
            }
        });

        res.json({ data: plans });
    } catch (error) {
        console.error('Get plans error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

/**
 * GET /api/subscription/razorpay-key - Get Razorpay key (public)
 */
router.get('/razorpay-key', (req, res) => {
    if (!isRazorpayConfigured()) {
        return res.status(503).json({ error: 'Payment gateway not configured' });
    }
    res.json({ keyId: getRazorpayKeyId() });
});

/**
 * POST /api/subscription/register - Register new organization + start trial
 * This is the main SaaS onboarding endpoint
 */
router.post('/register', async (req, res) => {
    try {
        const {
            // Organization info
            organizationName,
            // Admin user info
            firstName,
            lastName,
            email,
            password,
            phone,
            // Plan selection
            planSlug,
        } = req.body;

        // Validation
        if (!organizationName || !firstName || !lastName || !email || !password) {
            return res.status(400).json({
                error: 'Missing required fields',
                required: ['organizationName', 'firstName', 'lastName', 'email', 'password']
            });
        }

        // Check if email already exists
        const existingUser = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
        if (existingUser) {
            return res.status(400).json({ error: 'Email already registered. Please login instead.' });
        }

        // Get the selected plan (default to starter)
        const selectedPlan = await prisma.subscriptionPlan.findFirst({
            where: { slug: planSlug || 'starter', isActive: true }
        });

        if (!selectedPlan) {
            return res.status(400).json({ error: 'Invalid subscription plan' });
        }

        // Generate org slug
        const baseSlug = organizationName
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '');

        // Ensure unique slug
        let slug = baseSlug;
        let slugCounter = 0;
        while (await prisma.organization.findUnique({ where: { slug } })) {
            slugCounter++;
            slug = `${baseSlug}-${slugCounter}`;
        }

        const hashedPassword = await bcrypt.hash(password, 12);
        const now = new Date();
        const trialEndDate = new Date(now.getTime() + selectedPlan.trialDays * 24 * 60 * 60 * 1000);

        // Create everything in a transaction
        const result = await prisma.$transaction(async (tx) => {
            // 1. Create Organization
            const organization = await tx.organization.create({
                data: {
                    name: organizationName,
                    slug,
                    email: email.toLowerCase(),
                    phone: phone || null,
                }
            });

            // 2. Create Admin User
            const user = await tx.user.create({
                data: {
                    email: email.toLowerCase(),
                    password: hashedPassword,
                    role: 'ADMIN',
                    status: 'ACTIVE',
                    organizationId: organization.id,
                }
            });

            // 3. Update org owner
            await tx.organization.update({
                where: { id: organization.id },
                data: { ownerId: user.id }
            });

            // 4. Ensure default department & designation exist
            let department = await tx.department.findFirst({ where: { code: 'MGMT' } });
            if (!department) {
                department = await tx.department.create({
                    data: {
                        name: 'Management',
                        code: 'MGMT',
                        description: 'Management department',
                    }
                });
            }

            let designation = await tx.designation.findFirst({ where: { code: 'ADMIN' } });
            if (!designation) {
                designation = await tx.designation.create({
                    data: {
                        name: 'Administrator',
                        code: 'ADMIN',
                        level: 10,
                        description: 'System Administrator',
                    }
                });
            }

            // 5. Create Employee profile for admin
            const employeeId = generateEmployeeId('EMP');
            const employee = await tx.employee.create({
                data: {
                    employeeId,
                    userId: user.id,
                    firstName,
                    lastName,
                    email: email.toLowerCase(),
                    phone: phone || null,
                    departmentId: department.id,
                    designationId: designation.id,
                    joiningDate: now,
                    employmentType: 'FULL_TIME',
                }
            });

            // 6. Create Subscription (Trial)
            const subscription = await tx.subscription.create({
                data: {
                    organizationId: organization.id,
                    planId: selectedPlan.id,
                    status: 'TRIAL',
                    trialStartDate: now,
                    trialEndDate: trialEndDate,
                    billingCycle: 'MONTHLY',
                    autoRenew: true,
                }
            });

            // 7. Initialize leave balances
            const currentYear = now.getFullYear();
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

            return { organization, user, employee, subscription };
        });

        // Create welcome notification
        await prisma.notification.create({
            data: {
                userId: result.user.id,
                type: 'GENERAL',
                title: 'Welcome to Musterbook!',
                message: `Your organization "${organizationName}" has been created with a ${selectedPlan.trialDays}-day free trial of the ${selectedPlan.name} plan. Explore all features and add your team!`,
                link: '/dashboard'
            }
        });

        // Audit log
        await prisma.auditLog.create({
            data: {
                userId: result.user.id,
                action: 'CREATE',
                entityType: 'Organization',
                entityId: result.organization.id,
                description: `Organization "${organizationName}" created with ${selectedPlan.name} trial`
            }
        });

        // Generate JWT token so user is auto-logged-in
        const token = jwt.sign(
            {
                id: result.user.id,
                email: result.user.email,
                role: result.user.role,
                employeeId: result.employee.id,
                organizationId: result.organization.id,
            },
            process.env.NEXTAUTH_SECRET || 'your-secret-key',
            { expiresIn: '24h' }
        );

        res.status(201).json({
            success: true,
            message: 'Organization created successfully',
            token,
            user: {
                id: result.user.id,
                email: result.user.email,
                role: result.user.role,
                name: `${firstName} ${lastName}`,
                employeeId: result.employee.id,
            },
            organization: {
                id: result.organization.id,
                name: result.organization.name,
                slug: result.organization.slug,
            },
            subscription: {
                id: result.subscription.id,
                status: result.subscription.status,
                plan: selectedPlan.name,
                trialEndDate: trialEndDate,
                maxEmployees: selectedPlan.maxEmployees,
            }
        });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: 'Failed to create organization. Please try again.' });
    }
});

// ==================== AUTHENTICATED ROUTES ====================

/**
 * GET /api/subscription/current - Get current organization's subscription
 */
router.get('/current', authenticate, async (req: AuthRequest, res) => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.user!.id },
            select: { organizationId: true }
        });

        if (!user?.organizationId) {
            return res.status(404).json({
                error: 'No organization found',
                code: 'NO_ORGANIZATION',
                message: 'You are not part of any organization.'
            });
        }

        const subscription = await prisma.subscription.findUnique({
            where: { organizationId: user.organizationId },
            include: {
                plan: true,
                organization: {
                    select: {
                        id: true,
                        name: true,
                        slug: true,
                        email: true,
                    }
                }
            }
        });

        if (!subscription) {
            return res.status(404).json({
                error: 'No subscription found',
                code: 'NO_SUBSCRIPTION'
            });
        }

        // Get current employee count
        const employeeCount = await prisma.user.count({
            where: {
                organizationId: user.organizationId,
                status: 'ACTIVE',
                employee: { isNot: null }
            }
        });

        // Calculate days remaining
        const now = new Date();
        let daysRemaining = 0;
        if (subscription.status === 'TRIAL' && subscription.trialEndDate) {
            daysRemaining = Math.max(0, Math.ceil(
                (subscription.trialEndDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
            ));
        } else if (subscription.status === 'ACTIVE' && subscription.currentPeriodEnd) {
            daysRemaining = Math.max(0, Math.ceil(
                (subscription.currentPeriodEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
            ));
        }

        // Get recent payments
        const recentPayments = await prisma.payment.findMany({
            where: { subscriptionId: subscription.id },
            orderBy: { createdAt: 'desc' },
            take: 5,
        });

        res.json({
            data: {
                subscription: {
                    id: subscription.id,
                    status: subscription.status,
                    billingCycle: subscription.billingCycle,
                    trialStartDate: subscription.trialStartDate,
                    trialEndDate: subscription.trialEndDate,
                    currentPeriodStart: subscription.currentPeriodStart,
                    currentPeriodEnd: subscription.currentPeriodEnd,
                    autoRenew: subscription.autoRenew,
                    cancelledAt: subscription.cancelledAt,
                    cancelsAtPeriodEnd: subscription.cancelsAtPeriodEnd,
                },
                plan: subscription.plan,
                organization: subscription.organization,
                usage: {
                    employees: employeeCount,
                    maxEmployees: subscription.plan.maxEmployees,
                    percentUsed: subscription.plan.maxEmployees === -1
                        ? 0
                        : Math.round((employeeCount / subscription.plan.maxEmployees) * 100),
                },
                daysRemaining,
                recentPayments,
            }
        });
    } catch (error) {
        console.error('Get subscription error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

/**
 * POST /api/subscription/create-order - Create Razorpay order for payment
 */
router.post('/create-order', authenticate, authorize(['ADMIN']), async (req: AuthRequest, res) => {
    try {
        if (!isRazorpayConfigured()) {
            return res.status(503).json({ error: 'Payment gateway not configured. Please contact support.' });
        }

        const { planId, billingCycle = 'MONTHLY' } = req.body;

        if (!planId) {
            return res.status(400).json({ error: 'Plan ID is required' });
        }

        const user = await prisma.user.findUnique({
            where: { id: req.user!.id },
            select: { organizationId: true, email: true }
        });

        if (!user?.organizationId) {
            return res.status(400).json({ error: 'No organization found' });
        }

        const plan = await prisma.subscriptionPlan.findUnique({ where: { id: planId } });
        if (!plan) {
            return res.status(404).json({ error: 'Plan not found' });
        }

        if (plan.isCustom) {
            return res.status(400).json({ error: 'Enterprise plan requires contacting sales' });
        }

        // Calculate amount in paise
        let amount: number;
        if (billingCycle === 'YEARLY' && plan.yearlyPrice) {
            amount = Math.round(plan.yearlyPrice * 100); // Convert to paise
        } else {
            amount = Math.round(plan.monthlyPrice * 100); // Convert to paise
        }

        // Generate unique receipt
        const receipt = `rcpt_${user.organizationId.slice(-6)}_${Date.now()}`;

        // Create Razorpay order
        const order = await createRazorpayOrder({
            amount,
            currency: plan.currency,
            receipt,
            notes: {
                organizationId: user.organizationId,
                planId: plan.id,
                planName: plan.name,
                billingCycle,
                userEmail: user.email,
            }
        });

        // Get subscription
        const subscription = await prisma.subscription.findUnique({
            where: { organizationId: user.organizationId }
        });

        if (!subscription) {
            return res.status(404).json({ error: 'No subscription found' });
        }

        // Create pending payment record
        await prisma.payment.create({
            data: {
                subscriptionId: subscription.id,
                amount: amount / 100, // Store in rupees
                currency: plan.currency,
                razorpayOrderId: (order as any).id,
                status: 'CREATED',
                receipt,
                description: `${plan.name} Plan - ${billingCycle === 'YEARLY' ? 'Yearly' : 'Monthly'} Subscription`,
            }
        });

        res.json({
            data: {
                orderId: (order as any).id,
                amount: (order as any).amount,
                currency: (order as any).currency,
                keyId: getRazorpayKeyId(),
                planName: plan.name,
                billingCycle,
                description: `${plan.name} Plan - ${billingCycle === 'YEARLY' ? 'Yearly' : 'Monthly'}`,
            }
        });
    } catch (error) {
        console.error('Create order error:', error);
        res.status(500).json({ error: 'Failed to create payment order' });
    }
});

/**
 * POST /api/subscription/verify-payment - Verify Razorpay payment and activate subscription
 */
router.post('/verify-payment', authenticate, async (req: AuthRequest, res) => {
    try {
        const {
            razorpay_order_id,
            razorpay_payment_id,
            razorpay_signature,
            planId,
            billingCycle = 'MONTHLY'
        } = req.body;

        if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
            return res.status(400).json({ error: 'Missing payment details' });
        }

        // Verify signature
        const isValid = verifyRazorpaySignature({
            orderId: razorpay_order_id,
            paymentId: razorpay_payment_id,
            signature: razorpay_signature,
        });

        if (!isValid) {
            return res.status(400).json({ error: 'Invalid payment signature. Payment verification failed.' });
        }

        // Get payment record
        const payment = await prisma.payment.findUnique({
            where: { razorpayOrderId: razorpay_order_id },
            include: {
                subscription: {
                    include: { plan: true }
                }
            }
        });

        if (!payment) {
            return res.status(404).json({ error: 'Payment record not found' });
        }

        // Fetch payment details from Razorpay
        let paymentDetails;
        try {
            paymentDetails = await fetchPaymentDetails(razorpay_payment_id);
        } catch (e) {
            console.warn('Could not fetch payment details from Razorpay:', e);
        }

        const now = new Date();
        const periodStart = now;
        let periodEnd: Date;

        if (billingCycle === 'YEARLY') {
            periodEnd = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
        } else {
            periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // ~30 days
        }

        // Use the plan from the request or from the existing subscription
        const targetPlanId = planId || payment.subscription.planId;

        // Update payment record
        await prisma.payment.update({
            where: { id: payment.id },
            data: {
                razorpayPaymentId: razorpay_payment_id,
                razorpaySignature: razorpay_signature,
                status: 'CAPTURED',
                method: (paymentDetails as any)?.method || null,
                paidAt: now,
            }
        });

        // Activate subscription
        await prisma.subscription.update({
            where: { id: payment.subscriptionId },
            data: {
                status: 'ACTIVE',
                planId: targetPlanId,
                currentPeriodStart: periodStart,
                currentPeriodEnd: periodEnd,
                billingCycle,
                trialEndDate: now, // End trial if it was in trial
            }
        });

        // Generate invoice
        const invoiceNumber = `INV-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

        await prisma.invoice.create({
            data: {
                subscriptionId: payment.subscriptionId,
                invoiceNumber,
                subtotal: payment.amount,
                tax: Math.round(payment.amount * 0.18 * 100) / 100, // 18% GST
                total: Math.round(payment.amount * 1.18 * 100) / 100,
                currency: payment.currency,
                periodStart,
                periodEnd,
                status: 'PAID',
                paidAt: now,
                dueDate: now,
            }
        });

        // Audit log
        await prisma.auditLog.create({
            data: {
                userId: req.user!.id,
                action: 'PAYMENT',
                entityType: 'Subscription',
                entityId: payment.subscriptionId,
                description: `Payment of ₹${payment.amount} received for subscription. Invoice: ${invoiceNumber}`,
            }
        });

        // Get updated subscription
        const updatedSubscription = await prisma.subscription.findUnique({
            where: { id: payment.subscriptionId },
            include: { plan: true }
        });

        res.json({
            success: true,
            message: 'Payment verified and subscription activated successfully',
            data: {
                subscription: {
                    status: updatedSubscription?.status,
                    plan: updatedSubscription?.plan.name,
                    currentPeriodStart: periodStart,
                    currentPeriodEnd: periodEnd,
                    billingCycle,
                },
                payment: {
                    id: payment.id,
                    amount: payment.amount,
                    status: 'CAPTURED',
                },
                invoice: {
                    number: invoiceNumber,
                }
            }
        });
    } catch (error) {
        console.error('Verify payment error:', error);
        res.status(500).json({ error: 'Payment verification failed' });
    }
});

/**
 * POST /api/subscription/change-plan - Upgrade or downgrade plan
 */
router.post('/change-plan', authenticate, authorize(['ADMIN']), async (req: AuthRequest, res) => {
    try {
        const { planId } = req.body;

        if (!planId) {
            return res.status(400).json({ error: 'Plan ID is required' });
        }

        const user = await prisma.user.findUnique({
            where: { id: req.user!.id },
            select: { organizationId: true }
        });

        if (!user?.organizationId) {
            return res.status(400).json({ error: 'No organization found' });
        }

        const newPlan = await prisma.subscriptionPlan.findUnique({ where: { id: planId } });
        if (!newPlan || !newPlan.isActive) {
            return res.status(404).json({ error: 'Plan not found or inactive' });
        }

        const subscription = await prisma.subscription.findUnique({
            where: { organizationId: user.organizationId },
            include: { plan: true }
        });

        if (!subscription) {
            return res.status(404).json({ error: 'No subscription found' });
        }

        // Check if downgrading is possible (employee count fits new plan)
        if (newPlan.maxEmployees !== -1) {
            const employeeCount = await prisma.user.count({
                where: {
                    organizationId: user.organizationId,
                    status: 'ACTIVE',
                    employee: { isNot: null }
                }
            });

            if (employeeCount > newPlan.maxEmployees) {
                return res.status(400).json({
                    error: 'Cannot downgrade',
                    message: `You have ${employeeCount} active employees but the ${newPlan.name} plan only allows ${newPlan.maxEmployees}. Please deactivate some employees first.`,
                    currentCount: employeeCount,
                    newPlanLimit: newPlan.maxEmployees,
                });
            }
        }

        // If subscription is in trial, just change the plan
        if (subscription.status === 'TRIAL') {
            await prisma.subscription.update({
                where: { id: subscription.id },
                data: { planId: newPlan.id }
            });

            return res.json({
                success: true,
                message: `Plan changed to ${newPlan.name} (trial continues)`,
                data: { plan: newPlan.name, status: 'TRIAL' }
            });
        }

        // For active subscriptions, plan change takes effect at next billing cycle
        // or immediately if upgrading (needs payment)
        const isUpgrade = newPlan.monthlyPrice > subscription.plan.monthlyPrice;
        
        if (isUpgrade) {
            // Needs payment for upgrade - return info to create order
            return res.json({
                success: true,
                requiresPayment: true,
                message: `Upgrading to ${newPlan.name} requires payment`,
                data: {
                    currentPlan: subscription.plan.name,
                    newPlan: newPlan.name,
                    currentPrice: subscription.plan.monthlyPrice,
                    newPrice: newPlan.monthlyPrice,
                    planId: newPlan.id,
                }
            });
        } else {
            // Downgrade takes effect at end of current period
            await prisma.subscription.update({
                where: { id: subscription.id },
                data: {
                    metadata: JSON.stringify({
                        pendingPlanChange: newPlan.id,
                        pendingPlanName: newPlan.name,
                        changeEffectiveDate: subscription.currentPeriodEnd?.toISOString(),
                    })
                }
            });

            return res.json({
                success: true,
                message: `Plan will be downgraded to ${newPlan.name} at the end of your current billing period`,
                data: {
                    currentPlan: subscription.plan.name,
                    newPlan: newPlan.name,
                    effectiveDate: subscription.currentPeriodEnd,
                }
            });
        }
    } catch (error) {
        console.error('Change plan error:', error);
        res.status(500).json({ error: 'Failed to change plan' });
    }
});

/**
 * POST /api/subscription/cancel - Cancel subscription
 */
router.post('/cancel', authenticate, authorize(['ADMIN']), async (req: AuthRequest, res) => {
    try {
        const { reason, immediate = false } = req.body;

        const user = await prisma.user.findUnique({
            where: { id: req.user!.id },
            select: { organizationId: true }
        });

        if (!user?.organizationId) {
            return res.status(400).json({ error: 'No organization found' });
        }

        const subscription = await prisma.subscription.findUnique({
            where: { organizationId: user.organizationId },
        });

        if (!subscription) {
            return res.status(404).json({ error: 'No subscription found' });
        }

        if (['CANCELLED', 'EXPIRED'].includes(subscription.status)) {
            return res.status(400).json({ error: 'Subscription is already cancelled/expired' });
        }

        const now = new Date();

        if (immediate || subscription.status === 'TRIAL') {
            // Immediate cancellation
            await prisma.subscription.update({
                where: { id: subscription.id },
                data: {
                    status: 'CANCELLED',
                    cancelledAt: now,
                    cancelReason: reason || 'User requested cancellation',
                    autoRenew: false,
                }
            });
        } else {
            // Cancel at end of billing period
            await prisma.subscription.update({
                where: { id: subscription.id },
                data: {
                    cancelsAtPeriodEnd: true,
                    cancelledAt: now,
                    cancelReason: reason || 'User requested cancellation',
                    autoRenew: false,
                }
            });
        }

        await prisma.auditLog.create({
            data: {
                userId: req.user!.id,
                action: 'CANCEL',
                entityType: 'Subscription',
                entityId: subscription.id,
                description: `Subscription cancelled. Reason: ${reason || 'Not specified'}. Immediate: ${immediate}`,
            }
        });

        res.json({
            success: true,
            message: immediate || subscription.status === 'TRIAL'
                ? 'Subscription cancelled immediately'
                : 'Subscription will be cancelled at the end of the current billing period',
            data: {
                status: immediate ? 'CANCELLED' : subscription.status,
                cancelsAtPeriodEnd: !immediate,
                effectiveDate: immediate ? now : subscription.currentPeriodEnd,
            }
        });
    } catch (error) {
        console.error('Cancel subscription error:', error);
        res.status(500).json({ error: 'Failed to cancel subscription' });
    }
});

/**
 * POST /api/subscription/reactivate - Reactivate a cancelled subscription
 */
router.post('/reactivate', authenticate, authorize(['ADMIN']), async (req: AuthRequest, res) => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.user!.id },
            select: { organizationId: true }
        });

        if (!user?.organizationId) {
            return res.status(400).json({ error: 'No organization found' });
        }

        const subscription = await prisma.subscription.findUnique({
            where: { organizationId: user.organizationId },
        });

        if (!subscription) {
            return res.status(404).json({ error: 'No subscription found' });
        }

        // Only allow reactivation if cancelled at period end (still has time)
        if (subscription.cancelsAtPeriodEnd && subscription.currentPeriodEnd && new Date() < subscription.currentPeriodEnd) {
            await prisma.subscription.update({
                where: { id: subscription.id },
                data: {
                    cancelsAtPeriodEnd: false,
                    cancelledAt: null,
                    cancelReason: null,
                    autoRenew: true,
                }
            });

            return res.json({
                success: true,
                message: 'Subscription reactivated successfully',
            });
        }

        // If fully cancelled/expired, they need to make a new payment
        return res.json({
            success: false,
            requiresPayment: true,
            message: 'Your subscription has expired. Please make a payment to reactivate.',
        });
    } catch (error) {
        console.error('Reactivate error:', error);
        res.status(500).json({ error: 'Failed to reactivate subscription' });
    }
});

/**
 * GET /api/subscription/invoices - Get all invoices
 */
router.get('/invoices', authenticate, async (req: AuthRequest, res) => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.user!.id },
            select: { organizationId: true }
        });

        if (!user?.organizationId) {
            return res.status(404).json({ error: 'No organization found' });
        }

        const subscription = await prisma.subscription.findUnique({
            where: { organizationId: user.organizationId },
        });

        if (!subscription) {
            return res.json({ data: [] });
        }

        const invoices = await prisma.invoice.findMany({
            where: { subscriptionId: subscription.id },
            orderBy: { createdAt: 'desc' },
        });

        res.json({ data: invoices });
    } catch (error) {
        console.error('Get invoices error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

/**
 * GET /api/subscription/usage - Get usage stats
 */
router.get('/usage', authenticate, async (req: AuthRequest, res) => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.user!.id },
            select: { organizationId: true }
        });

        if (!user?.organizationId) {
            return res.status(404).json({ error: 'No organization found' });
        }

        const subscription = await prisma.subscription.findUnique({
            where: { organizationId: user.organizationId },
            include: { plan: true }
        });

        if (!subscription) {
            return res.status(404).json({ error: 'No subscription found' });
        }

        const [totalEmployees, activeEmployees, totalUsers] = await Promise.all([
            prisma.employee.count({
                where: {
                    user: { organizationId: user.organizationId }
                }
            }),
            prisma.user.count({
                where: {
                    organizationId: user.organizationId,
                    status: 'ACTIVE',
                    employee: { isNot: null }
                }
            }),
            prisma.user.count({
                where: { organizationId: user.organizationId }
            }),
        ]);

        res.json({
            data: {
                employees: {
                    total: totalEmployees,
                    active: activeEmployees,
                    limit: subscription.plan.maxEmployees,
                    remaining: subscription.plan.maxEmployees === -1
                        ? -1
                        : Math.max(0, subscription.plan.maxEmployees - activeEmployees),
                    percentUsed: subscription.plan.maxEmployees === -1
                        ? 0
                        : Math.round((activeEmployees / subscription.plan.maxEmployees) * 100),
                },
                totalUsers,
                plan: subscription.plan.name,
                features: {
                    payroll: subscription.plan.hasPayroll,
                    advancedAnalytics: subscription.plan.hasAdvancedAnalytics,
                    customIntegrations: subscription.plan.hasCustomIntegrations,
                    prioritySupport: subscription.plan.hasPrioritySupport,
                },
            }
        });
    } catch (error) {
        console.error('Get usage error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// ==================== WEBHOOK ====================

/**
 * POST /api/subscription/webhook - Razorpay webhook handler
 * This is called by Razorpay when payment events happen
 */
router.post('/webhook', async (req, res) => {
    try {
        const signature = req.headers['x-razorpay-signature'] as string;
        const body = JSON.stringify(req.body);

        // Verify webhook signature
        if (signature && !verifyWebhookSignature(body, signature)) {
            console.warn('Invalid webhook signature');
            return res.status(400).json({ error: 'Invalid signature' });
        }

        const event = req.body;
        const eventType = event.event;

        console.log(`[Webhook] Received event: ${eventType}`);

        switch (eventType) {
            case 'payment.captured': {
                const paymentEntity = event.payload.payment.entity;
                const payment = await prisma.payment.findUnique({
                    where: { razorpayOrderId: paymentEntity.order_id },
                });

                if (payment && payment.status !== 'CAPTURED') {
                    await prisma.payment.update({
                        where: { id: payment.id },
                        data: {
                            status: 'CAPTURED',
                            razorpayPaymentId: paymentEntity.id,
                            method: paymentEntity.method,
                            paidAt: new Date(),
                        }
                    });
                }
                break;
            }

            case 'payment.failed': {
                const paymentEntity = event.payload.payment.entity;
                const payment = await prisma.payment.findUnique({
                    where: { razorpayOrderId: paymentEntity.order_id },
                });

                if (payment) {
                    await prisma.payment.update({
                        where: { id: payment.id },
                        data: {
                            status: 'FAILED',
                            razorpayPaymentId: paymentEntity.id,
                            errorCode: paymentEntity.error_code,
                            errorDescription: paymentEntity.error_description,
                        }
                    });
                }
                break;
            }

            case 'refund.created': {
                const refundEntity = event.payload.refund.entity;
                const payment = await prisma.payment.findUnique({
                    where: { razorpayPaymentId: refundEntity.payment_id },
                });

                if (payment) {
                    await prisma.payment.update({
                        where: { id: payment.id },
                        data: {
                            status: 'REFUNDED',
                            refundedAt: new Date(),
                        }
                    });
                }
                break;
            }
        }

        // Always return 200 to Razorpay
        res.status(200).json({ received: true });
    } catch (error) {
        console.error('Webhook error:', error);
        // Still return 200 to avoid Razorpay retrying
        res.status(200).json({ received: true });
    }
});

export default router;
