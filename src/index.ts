import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import employeeRoutes from './routes/employees';
import notificationRoutes from './routes/notifications';
import authRoutes from './routes/auth';
import attendanceRoutes from './routes/attendance';
import holidayRoutes from './routes/holidays';
import leaveRoutes from './routes/leave';
import payrollRoutes from './routes/payroll';
import dashboardRoutes from './routes/dashboard';
import settingsRoutes from './routes/settings';
import wfhRoutes from './routes/wfh';
// Import other routes as they are created

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors({
    origin: [process.env.FRONTEND_URL || 'http://localhost:3000', 'http://localhost:5173', 'http://localhost:3005', 'http://localhost:3010'],
    credentials: true
}));
app.use(express.json({ limit: '5mb' }));

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/holidays', holidayRoutes);
app.use('/api/leave', leaveRoutes);
app.use('/api/payroll', payrollRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/wfh', wfhRoutes);

app.listen(PORT, () => {
    console.log(`Backend server running on http://localhost:${PORT}`);
    console.log('Backend Secret Prefix:', (process.env.NEXTAUTH_SECRET || 'your-secret-key').substring(0, 5) + '...');
});
