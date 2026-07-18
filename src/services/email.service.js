const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const moment = require('moment-timezone');
const { logger } = require('../utils/logger');

let transporter = null;
const getTransporter = () => {
    if (transporter) return transporter;
    if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
        return null;
    }
    transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT) || 587,
        secure: parseInt(process.env.SMTP_PORT) === 465,
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS
        }
    });
    return transporter;
};

const sendSalarySlipEmail = async (salarySlip) => {
    const mailer = getTransporter();
    if (!mailer) {
        throw new Error('Email is not configured. Set SMTP_HOST, SMTP_USER and SMTP_PASS in the environment.');
    }
    if (!salarySlip.pdfUrl) {
        throw new Error('Salary slip PDF has not been generated yet.');
    }

    const pdfPath = path.join(__dirname, '../..', salarySlip.pdfUrl);
    if (!fs.existsSync(pdfPath)) {
        throw new Error('Salary slip PDF file was not found on the server.');
    }

    const monthLabel = `${moment.months(salarySlip.month - 1)} ${salarySlip.year}`;
    const companyName = process.env.COMPANY_NAME || 'Your Company';

    await mailer.sendMail({
        from: `"${companyName}" <${process.env.SMTP_USER}>`,
        to: salarySlip.employeeSnapshot.email,
        subject: `Salary Slip - ${monthLabel}`,
        html: `
            <p>Dear ${salarySlip.employeeSnapshot.fullName},</p>
            <p>Please find attached your salary slip for <strong>${monthLabel}</strong>.</p>
            <p>Net Salary: <strong>Rs. ${Number(salarySlip.netSalary).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</strong></p>
            <p>This is a system-generated email, please do not reply.</p>
            <p>Regards,<br/>${companyName}</p>
        `,
        attachments: [{
            filename: `Salary-Slip-${salarySlip.employeeSnapshot.employeeCode}-${salarySlip.month}-${salarySlip.year}.pdf`,
            path: pdfPath
        }]
    });

    logger.info(`Salary slip emailed to ${salarySlip.employeeSnapshot.email} for ${monthLabel}`);
};

module.exports = { sendSalarySlipEmail };
