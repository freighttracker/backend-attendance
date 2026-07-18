const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const moment = require('moment-timezone');
const { getCompanyProfile } = require('./payroll.service');

const fmt = (n) => `Rs. ${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const drawSectionTitle = (doc, title, y) => {
    doc.rect(40, y, 515, 20).fill('#1f2937');
    doc.fillColor('#ffffff').fontSize(11).font('Helvetica-Bold').text(title, 48, y + 5);
    doc.fillColor('#000000').font('Helvetica');
    return y + 20;
};

// Draws a two-column key/value table (label left, amount right) and returns
// the y-coordinate immediately below it plus the running total.
const drawAmountTable = (doc, rows, x, y, width) => {
    let cursorY = y;
    doc.fontSize(9.5);
    rows.forEach((row, idx) => {
        if (idx % 2 === 0) {
            doc.rect(x, cursorY, width, 16).fill('#f9fafb');
            doc.fillColor('#000000');
        }
        doc.text(row.name, x + 6, cursorY + 4, { width: width - 90 });
        doc.text(fmt(row.amount), x + width - 90, cursorY + 4, { width: 84, align: 'right' });
        cursorY += 16;
    });
    doc.rect(x, cursorY, width, 1).fill('#d1d5db');
    doc.fillColor('#000000');
    return cursorY + 6;
};

const generateSalarySlipPDF = async (salarySlip) => {
    const company = await getCompanyProfile();
    const doc = new PDFDocument({ size: 'A4', margin: 40 });

    const fileName = `salary-slip-${salarySlip.employeeSnapshot.employeeCode}-${salarySlip.month}-${salarySlip.year}-${Date.now()}.pdf`;
    const dir = path.join(__dirname, '../../uploads/documents');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, fileName);
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    // ---- Header ----
    let logoDrawn = false;
    if (company.logoUrl && company.logoUrl.startsWith('/uploads')) {
        const logoPath = path.join(__dirname, '../..', company.logoUrl);
        if (fs.existsSync(logoPath)) {
            try {
                doc.image(logoPath, 40, 35, { width: 60, height: 60, fit: [60, 60] });
                logoDrawn = true;
            } catch (e) { /* ignore malformed logo, fall through to text-only header */ }
        }
    }

    const headerX = logoDrawn ? 110 : 40;
    doc.fontSize(16).font('Helvetica-Bold').text(company.name, headerX, 40);
    doc.fontSize(9).font('Helvetica').fillColor('#4b5563').text(company.address || '', headerX, 60, { width: 400 });
    doc.fillColor('#000000');

    doc.fontSize(14).font('Helvetica-Bold').text('SALARY SLIP', 40, 100, { align: 'right', width: 515 });
    doc.fontSize(10).font('Helvetica').text(
        `Pay Period: ${moment.months(salarySlip.month - 1)} ${salarySlip.year}`,
        40, 118, { align: 'right', width: 515 }
    );

    doc.moveTo(40, 140).lineTo(555, 140).strokeColor('#d1d5db').stroke();

    // ---- Employee details ----
    const emp = salarySlip.employeeSnapshot;
    let y = 150;
    doc.fontSize(9.5).font('Helvetica');
    const leftCol = [
        ['Employee Name', emp.fullName],
        ['Employee Code', emp.employeeCode],
        ['Department', emp.department || 'N/A'],
        ['Designation', emp.designation || 'N/A'],
        ['Joining Date', emp.joiningDate ? moment(emp.joiningDate).format('DD MMM YYYY') : 'N/A']
    ];
    const rightCol = [
        ['PAN Number', emp.panNumber || 'N/A'],
        ['Bank Name', emp.bankDetails?.bankName || 'N/A'],
        ['Account Number', emp.bankDetails?.accountNumber || 'N/A'],
        ['IFSC Code', emp.bankDetails?.ifscCode || 'N/A'],
        ['Email', emp.email || 'N/A']
    ];
    leftCol.forEach(([label, value], idx) => {
        doc.font('Helvetica-Bold').text(`${label}:`, 40, y + idx * 16, { continued: true, width: 250 });
        doc.font('Helvetica').text(`  ${value}`);
    });
    rightCol.forEach(([label, value], idx) => {
        doc.font('Helvetica-Bold').text(`${label}:`, 300, y + idx * 16, { continued: true, width: 250 });
        doc.font('Helvetica').text(`  ${value}`);
    });
    y += leftCol.length * 16 + 12;

    // ---- Attendance summary ----
    y = drawSectionTitle(doc, 'ATTENDANCE SUMMARY', y);
    const att = salarySlip.attendanceSummary;
    const attCells = [
        ['Working Days', att.workingDays],
        ['Present', att.presentDays],
        ['Absent', att.absentDays],
        ['Half Day', att.halfDays],
        ['Paid Leave', att.paidLeaveDays],
        ['Unpaid Leave', att.unpaidLeaveDays],
        ['Weekly Off', att.weeklyOffs],
        ['Holidays', att.holidays],
        ['Late Marks', att.lateCount]
    ];
    const cellWidth = 515 / 3;
    attCells.forEach((cell, idx) => {
        const col = idx % 3;
        const row = Math.floor(idx / 3);
        const cx = 40 + col * cellWidth;
        const cy = y + row * 18;
        doc.font('Helvetica-Bold').fontSize(9).text(`${cell[0]}: `, cx + 4, cy + 4, { continued: true });
        doc.font('Helvetica').text(`${cell[1]}`);
    });
    y += Math.ceil(attCells.length / 3) * 18 + 10;

    // ---- Earnings & Deductions ----
    const tableTopLabel = y;
    y = drawSectionTitle(doc, 'EARNINGS', tableTopLabel);
    const deductY = drawSectionTitle(doc, 'DEDUCTIONS', tableTopLabel);
    const colWidth = 245;
    const earningsBottom = drawAmountTable(doc, salarySlip.earnings, 40, y, colWidth);
    const deductionsBottom = drawAmountTable(doc, salarySlip.deductions, 40 + colWidth + 25, deductY, colWidth);

    let bottomY = Math.max(earningsBottom, deductionsBottom);
    doc.font('Helvetica-Bold').fontSize(9.5);
    doc.text('Gross Earnings', 40 + 6, bottomY, { continued: true, width: colWidth - 90 });
    doc.text(fmt(salarySlip.totalEarnings), 40 + colWidth - 90, bottomY, { width: 84, align: 'right' });
    doc.text('Total Deductions', 40 + colWidth + 25 + 6, bottomY, { continued: true, width: colWidth - 90 });
    doc.text(fmt(salarySlip.totalDeductions), 40 + colWidth + 25 + colWidth - 90, bottomY, { width: 84, align: 'right' });
    doc.font('Helvetica');
    bottomY += 24;

    // ---- Net salary ----
    doc.rect(40, bottomY, 515, 30).fill('#1f2937');
    doc.fillColor('#ffffff').fontSize(13).font('Helvetica-Bold')
        .text(`NET SALARY: ${fmt(salarySlip.netSalary)}`, 40, bottomY + 8, { align: 'center', width: 515 });
    doc.fillColor('#000000').font('Helvetica');
    bottomY += 45;

    // ---- Signature & footer ----
    doc.fontSize(9).text('_______________________', 400, bottomY);
    doc.text('Authorized Signatory', 400, bottomY + 14);

    doc.fontSize(8).fillColor('#6b7280').text(
        'This is a computer-generated salary slip and does not require a physical signature.',
        40, bottomY + 40, { align: 'center', width: 515 }
    );
    doc.fillColor('#000000');

    doc.end();

    return new Promise((resolve, reject) => {
        stream.on('finish', () => resolve(`/uploads/documents/${fileName}`));
        stream.on('error', reject);
    });
};

module.exports = { generateSalarySlipPDF };
