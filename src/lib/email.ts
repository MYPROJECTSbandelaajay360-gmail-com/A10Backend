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
    } catch (error) {
        console.error('Error sending email:', error);
        return false;
    }
}
