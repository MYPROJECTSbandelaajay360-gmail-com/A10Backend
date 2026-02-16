import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface AuthRequest extends Request {
    user?: {
        id: string;
        email: string;
        role: string;
        employeeId?: string;
    };
}

export const authenticate = (req: AuthRequest, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, process.env.NEXTAUTH_SECRET || 'your-secret-key') as any;
        console.log('JWT verified successfully for user:', decoded.email);
        req.user = decoded;
        next();
    } catch (error) {
        console.error('JWT Verification failed:', error instanceof Error ? error.message : String(error));
        const secret = process.env.NEXTAUTH_SECRET || 'your-secret-key';
        console.log('Using secret (first 5 chars):', secret.substring(0, 5) + '...');
        return res.status(401).json({
            error: 'Invalid token',
            details: error instanceof Error ? error.message : String(error),
            secretPrefix: secret.substring(0, 5) + '...'
        });
    }
};

export const authorize = (roles: string[]) => {
    return (req: AuthRequest, res: Response, next: NextFunction) => {
        if (!req.user || !roles.includes(req.user.role)) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        next();
    };
};
