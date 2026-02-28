/**
 * Seed subscription plans into the database.
 * Run with: npx ts-node prisma/seed-plans.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const plans = [
    {
        name: 'Starter',
        slug: 'starter',
        monthlyPrice: 499,
        yearlyPrice: 4990,  // ~2 months free
        currency: 'INR',
        maxEmployees: 25,
        features: [
            'Up to 25 employees',
            'Attendance tracking',
            'Leave management',
            'Basic reports',
            'Email support',
        ],
        description: 'Perfect for small teams getting started',
        isCustom: false,
        sortOrder: 1,
        trialDays: 14,
        hasPayroll: false,
        hasAdvancedAnalytics: false,
        hasCustomIntegrations: false,
        hasPrioritySupport: false,
        hasDedicatedManager: false,
        hasCustomWorkflows: false,
        hasSLA: false,
        hasOnPremise: false,
    },
    {
        name: 'Professional',
        slug: 'professional',
        monthlyPrice: 1499,
        yearlyPrice: 14990, // ~2 months free
        currency: 'INR',
        maxEmployees: 200,
        features: [
            'Up to 200 employees',
            'Everything in Starter',
            'Payroll processing',
            'Advanced analytics',
            'Priority support',
            'Custom integrations',
        ],
        description: 'For growing businesses that need more',
        isCustom: false,
        sortOrder: 2,
        trialDays: 14,
        hasPayroll: true,
        hasAdvancedAnalytics: true,
        hasCustomIntegrations: true,
        hasPrioritySupport: true,
        hasDedicatedManager: false,
        hasCustomWorkflows: false,
        hasSLA: false,
        hasOnPremise: false,
    },
    {
        name: 'Enterprise',
        slug: 'enterprise',
        monthlyPrice: 0,     // Custom pricing
        yearlyPrice: 0,
        currency: 'INR',
        maxEmployees: -1,     // Unlimited
        features: [
            'Unlimited employees',
            'Everything in Professional',
            'Dedicated account manager',
            'Custom workflows',
            'SLA guarantee',
            'On-premise option',
        ],
        description: 'For large organizations with custom needs',
        isCustom: true,
        sortOrder: 3,
        trialDays: 30,
        hasPayroll: true,
        hasAdvancedAnalytics: true,
        hasCustomIntegrations: true,
        hasPrioritySupport: true,
        hasDedicatedManager: true,
        hasCustomWorkflows: true,
        hasSLA: true,
        hasOnPremise: true,
    },
];

async function seedPlans() {
    console.log('🌱 Seeding subscription plans...\n');

    for (const plan of plans) {
        const existing = await prisma.subscriptionPlan.findUnique({
            where: { slug: plan.slug },
        });

        if (existing) {
            // Update existing plan
            await prisma.subscriptionPlan.update({
                where: { slug: plan.slug },
                data: plan,
            });
            console.log(`  ✅ Updated plan: ${plan.name}`);
        } else {
            // Create new plan
            await prisma.subscriptionPlan.create({
                data: plan,
            });
            console.log(`  ✅ Created plan: ${plan.name}`);
        }
    }

    console.log('\n✨ Subscription plans seeded successfully!');
    
    // Display summary
    const allPlans = await prisma.subscriptionPlan.findMany({
        orderBy: { sortOrder: 'asc' },
        select: { name: true, monthlyPrice: true, maxEmployees: true, trialDays: true }
    });
    
    console.log('\n📋 Plan Summary:');
    console.log('─'.repeat(60));
    for (const p of allPlans) {
        const price = p.monthlyPrice === 0 ? 'Custom' : `₹${p.monthlyPrice}/mo`;
        const employees = p.maxEmployees === -1 ? 'Unlimited' : `${p.maxEmployees}`;
        console.log(`  ${p.name.padEnd(15)} | ${price.padEnd(15)} | ${employees} employees | ${p.trialDays}d trial`);
    }
    console.log('─'.repeat(60));
}

seedPlans()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
