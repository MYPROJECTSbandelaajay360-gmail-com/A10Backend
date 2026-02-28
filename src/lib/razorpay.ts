import crypto from 'crypto';

// Razorpay API configuration
const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || '';
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || '';
const RAZORPAY_BASE_URL = 'https://api.razorpay.com/v1';

// Helper for Razorpay API calls
async function razorpayRequest(endpoint: string, method: string = 'GET', body?: any) {
    const auth = Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString('base64');
    
    const options: RequestInit = {
        method,
        headers: {
            'Authorization': `Basic ${auth}`,
            'Content-Type': 'application/json',
        },
    };

    if (body && method !== 'GET') {
        options.body = JSON.stringify(body);
    }

    const response = await fetch(`${RAZORPAY_BASE_URL}${endpoint}`, options);
    const data: any = await response.json();

    if (!response.ok) {
        throw new Error(data.error?.description || `Razorpay API error: ${response.status}`);
    }

    return data;
}

// Create a Razorpay order for one-time payment
export async function createRazorpayOrder(params: {
    amount: number;      // Amount in paise (₹499 = 49900)
    currency?: string;
    receipt: string;
    notes?: Record<string, string>;
}) {
    return razorpayRequest('/orders', 'POST', {
        amount: params.amount,
        currency: params.currency || 'INR',
        receipt: params.receipt,
        notes: params.notes || {},
    });
}

// Verify Razorpay payment signature
export function verifyRazorpaySignature(params: {
    orderId: string;
    paymentId: string;
    signature: string;
}): boolean {
    const { orderId, paymentId, signature } = params;
    
    const expectedSignature = crypto
        .createHmac('sha256', RAZORPAY_KEY_SECRET)
        .update(`${orderId}|${paymentId}`)
        .digest('hex');

    return expectedSignature === signature;
}

// Fetch payment details from Razorpay
export async function fetchPaymentDetails(paymentId: string) {
    return razorpayRequest(`/payments/${paymentId}`);
}

// Create a Razorpay customer
export async function createRazorpayCustomer(params: {
    name: string;
    email: string;
    contact?: string;
    notes?: Record<string, string>;
}) {
    return razorpayRequest('/customers', 'POST', params);
}

// Fetch order details
export async function fetchOrderDetails(orderId: string) {
    return razorpayRequest(`/orders/${orderId}`);
}

// Issue a refund
export async function createRefund(paymentId: string, params: {
    amount?: number;  // Partial refund amount in paise
    notes?: Record<string, string>;
    receipt?: string;
}) {
    return razorpayRequest(`/payments/${paymentId}/refund`, 'POST', params);
}

// Check if Razorpay is configured
export function isRazorpayConfigured(): boolean {
    return !!(RAZORPAY_KEY_ID && RAZORPAY_KEY_SECRET);
}

// Get Razorpay key ID (public - safe to send to frontend)
export function getRazorpayKeyId(): string {
    return RAZORPAY_KEY_ID;
}

// Verify webhook signature
export function verifyWebhookSignature(body: string, signature: string, secret?: string): boolean {
    const webhookSecret = secret || process.env.RAZORPAY_WEBHOOK_SECRET || '';
    
    const expectedSignature = crypto
        .createHmac('sha256', webhookSecret)
        .update(body)
        .digest('hex');

    return expectedSignature === signature;
}
