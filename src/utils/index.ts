import { format, parseISO, differenceInMinutes } from 'date-fns'

// Date formatting utilities
export function formatDate(date: Date | string, formatStr: string = 'PPP') {
    const d = typeof date === 'string' ? parseISO(date) : date
    return format(d, formatStr)
}

// Generate unique IDs
export function generateEmployeeId(prefix: string = 'EMP'): string {
    const timestamp = Date.now().toString(36).toUpperCase()
    const random = Math.random().toString(36).substring(2, 6).toUpperCase()
    return `${prefix}${timestamp}${random}`
}

export function generateRequestNumber(prefix: string = 'LR'): string {
    const date = format(new Date(), 'yyyyMMdd')
    const random = Math.random().toString(36).substring(2, 6).toUpperCase()
    return `${prefix}${date}${random}`
}

export function generatePayrollNumber(month: number, year: number): string {
    const monthStr = month.toString().padStart(2, '0')
    const random = Math.random().toString(36).substring(2, 6).toUpperCase()
    return `PAY${year}${monthStr}${random}`
}

export function parseTimeToDate(timeStr: string, baseDate: Date = new Date()): Date {
    const [hours, minutes] = timeStr.split(':').map(Number)
    const result = new Date(baseDate)
    result.setHours(hours, minutes, 0, 0)
    return result
}

// Calculate leave days
export function calculateLeaveDays(fromDate: Date, toDate: Date, isHalfDay: boolean = false): number {
    const diffTime = Math.abs(toDate.getTime() - fromDate.getTime())
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1
    return isHalfDay ? 0.5 : diffDays
}

