import nodemailer from 'nodemailer';

// Create a transporter
// If environment variables are not set, it will fail gracefully or log to console
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true', // true for 465, false for other ports
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
    },
    debug: true, // Show debug output
    logger: true  // Log to console
});

interface SendEmailParams {
    to: string;
    subject: string;
    html: string;
}

export async function sendEmail({ to, subject, html }: SendEmailParams) {
    if (!process.env.SMTP_HOST || !process.env.SMTP_USER) {
        console.log('Use this link to reset password (SMTP not configured):');
        console.log('---------------------------------------------------');
        console.log(`To: ${to}`);
        console.log(`Subject: ${subject}`);
        console.log('Content (HTML preview):', html.substring(0, 100) + '...');
        console.log('---------------------------------------------------');
        // Extract link if possible for easier copy-pasting
        const linkMatch = html.match(/href="([^"]*)"/);
        if (linkMatch) {
            console.log('RESET LINK:', linkMatch[1]);
        }
        return true;
    }

    try {
        const info = await transporter.sendMail({
            from: process.env.SMTP_FROM || '"HRMS Support" <support@cognitbotz.com>',
            to,
            subject,
            html,
        });

        console.log('Message sent: %s', info.messageId);
        return true;
    } catch (error: any) {
        console.error('Error sending email:', error.message);
        return false;
    }
}

/**
 * Sends a professional password reset email using the A10 Email Server
 */
export async function sendProfessionalPasswordResetEmail(params: {
    email: string;
    resetLink: string;
    name: string;
    expiresAt: string;
}) {
    const { email, resetLink, name, expiresAt } = params;

    // Check if email server is configured
    const serverUrl = process.env.EMAIL_SERVER_URL;
    const serverToken = process.env.EMAIL_SERVER_TOKEN;

    if (serverUrl && serverToken) {
        try {
            console.log(`[EmailLib] Attempting to send professional password reset email to ${email} via server...`);
            const response = await fetch(`${serverUrl}/password-reset`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${serverToken}`
                },
                body: JSON.stringify({
                    email,
                    resetLink,
                    name,
                    expiresAt
                })
            });

            if (response.ok) {
                console.log('[EmailLib] Successfully triggered professional email via server');
                return true;
            } else {
                const errorText = await response.text();
                console.error(`[EmailLib] Email server returned error: ${errorText}`);
            }
        } catch (error: any) {
            console.error(`[EmailLib] Failed to connect to email server: ${error.message}`);
        }
    }

    // Fallback to simple SMTP if server fails or isn't configured
    console.log('[EmailLib] Falling back to standard SMTP email...');
    return sendEmail({
        to: email,
        subject: 'Password Reset Request',
        html: `
            <div style="font-family: sans-serif; padding: 20px; color: #333;">
                <h2>Password Reset Request</h2>
                <p>Hello ${name},</p>
                <p>You requested to reset your password. Click the link below to continue:</p>
                <a href="${resetLink}" style="display:inline-block; padding: 10px 20px; background: #2563eb; color: white; text-decoration: none; border-radius: 5px;">Reset Password</a>
                <p>This link expires on ${expiresAt}.</p>
                <p>If you didn't request this, please ignore this email.</p>
            </div>
        `
    });
}
