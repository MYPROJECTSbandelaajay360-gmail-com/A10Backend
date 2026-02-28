import { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { AuthRequest } from './auth';

/**
 * Middleware to check if the user's organization has an active subscription.
 * Attaches subscription info to the request for downstream use.
 */
export const checkSubscription = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        if (!req.user?.id) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        // Get user with organization
        const user = await prisma.user.findUnique({
            where: { id: req.user.id },
            select: { organizationId: true }
        });

        if (!user?.organizationId) {
            // User not linked to any organization - allow access (backward compat)
            // In production, you might want to restrict this
            (req as any).subscription = null;
            return next();
        }

        // Get the subscription for this organization
        const subscription = await prisma.subscription.findUnique({
            where: { organizationId: user.organizationId },
            include: {
                plan: true,
                organization: {
                    select: { id: true, name: true, slug: true }
                }
            }
        });

        if (!subscription) {
            return res.status(403).json({
                error: 'No subscription found',
                code: 'NO_SUBSCRIPTION',
                message: 'Your organization does not have an active subscription. Please subscribe to continue.',
                redirectTo: '/dashboard/subscription'
            });
        }

        // Check subscription status
        const now = new Date();

        if (subscription.status === 'TRIAL') {
            if (subscription.trialEndDate && now > subscription.trialEndDate) {
                // Trial has expired
                await prisma.subscription.update({
                    where: { id: subscription.id },
                    data: { status: 'EXPIRED' }
                });

                return res.status(403).json({
                    error: 'Trial expired',
                    code: 'TRIAL_EXPIRED',
                    message: 'Your free trial has expired. Please upgrade to a paid plan to continue.',
                    redirectTo: '/dashboard/subscription',
                    trialEndDate: subscription.trialEndDate
                });
            }
        } else if (subscription.status === 'ACTIVE') {
            if (subscription.currentPeriodEnd && now > subscription.currentPeriodEnd) {
                // Subscription period has ended
                await prisma.subscription.update({
                    where: { id: subscription.id },
                    data: { status: 'PAST_DUE' }
                });

                return res.status(403).json({
                    error: 'Subscription past due',
                    code: 'SUBSCRIPTION_PAST_DUE',
                    message: 'Your subscription payment is overdue. Please renew to continue.',
                    redirectTo: '/dashboard/subscription'
                });
            }
        } else if (['EXPIRED', 'CANCELLED', 'SUSPENDED'].includes(subscription.status)) {
            return res.status(403).json({
                error: 'Subscription inactive',
                code: 'SUBSCRIPTION_INACTIVE',
                message: `Your subscription is ${subscription.status.toLowerCase()}. Please renew to continue.`,
                status: subscription.status,
                redirectTo: '/dashboard/subscription'
            });
        } else if (subscription.status === 'PAST_DUE') {
            // Allow limited grace period (3 days) for past due subscriptions
            const gracePeriod = 3 * 24 * 60 * 60 * 1000; // 3 days in ms
            if (subscription.currentPeriodEnd && 
                now.getTime() > subscription.currentPeriodEnd.getTime() + gracePeriod) {
                await prisma.subscription.update({
                    where: { id: subscription.id },
                    data: { status: 'SUSPENDED' }
                });

                return res.status(403).json({
                    error: 'Subscription suspended',
                    code: 'SUBSCRIPTION_SUSPENDED',
                    message: 'Your subscription has been suspended due to non-payment. Please renew immediately.',
                    redirectTo: '/dashboard/subscription'
                });
            }
        }

        // Attach subscription info to request
        (req as any).subscription = subscription;
        (req as any).organizationId = user.organizationId;
        next();
    } catch (error) {
        console.error('Subscription check error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};

/**
 * Middleware to enforce employee limit based on subscription plan.
 * Must be used AFTER checkSubscription middleware.
 */
export const enforceEmployeeLimit = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const subscription = (req as any).subscription;
        const organizationId = (req as any).organizationId;

        if (!subscription || !organizationId) {
            // No subscription context - allow (backward compat for non-org users)
            return next();
        }

        const maxEmployees = subscription.plan.maxEmployees;

        // -1 means unlimited (Enterprise plan)
        if (maxEmployees === -1) {
            return next();
        }

        // Count current employees in the organization
        const currentEmployeeCount = await prisma.user.count({
            where: {
                organizationId: organizationId,
                status: 'ACTIVE',
                employee: { isNot: null }
            }
        });

        if (currentEmployeeCount >= maxEmployees) {
            return res.status(403).json({
                error: 'Employee limit reached',
                code: 'EMPLOYEE_LIMIT_REACHED',
                message: `Your ${subscription.plan.name} plan allows up to ${maxEmployees} employees. You currently have ${currentEmployeeCount}. Please upgrade your plan to add more employees.`,
                currentCount: currentEmployeeCount,
                maxAllowed: maxEmployees,
                planName: subscription.plan.name,
                redirectTo: '/dashboard/subscription'
            });
        }

        // Attach counts to request for downstream use
        (req as any).employeeCount = currentEmployeeCount;
        (req as any).employeeLimit = maxEmployees;
        next();
    } catch (error) {
        console.error('Employee limit check error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};

/**
 * Middleware to check if a specific feature is available in the current plan.
 */
export const requireFeature = (feature: string) => {
    return async (req: AuthRequest, res: Response, next: NextFunction) => {
        const subscription = (req as any).subscription;

        if (!subscription) {
            return next(); // No subscription context - allow (backward compat)
        }

        const plan = subscription.plan;
        const featureMap: Record<string, boolean> = {
            payroll: plan.hasPayroll,
            advancedAnalytics: plan.hasAdvancedAnalytics,
            customIntegrations: plan.hasCustomIntegrations,
            prioritySupport: plan.hasPrioritySupport,
            dedicatedManager: plan.hasDedicatedManager,
            customWorkflows: plan.hasCustomWorkflows,
            sla: plan.hasSLA,
            onPremise: plan.hasOnPremise,
        };

        if (featureMap[feature] === false) {
            return res.status(403).json({
                error: 'Feature not available',
                code: 'FEATURE_NOT_AVAILABLE',
                message: `The ${feature} feature is not available in your ${plan.name} plan. Please upgrade to access this feature.`,
                feature,
                planName: plan.name,
                redirectTo: '/dashboard/subscription'
            });
        }

        next();
    };
};
