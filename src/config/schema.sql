-- Attendance Management System Database Schema
-- MySQL 8.0+

CREATE DATABASE IF NOT EXISTS attendance_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE attendance_db;

-- ============================================
-- USERS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    employee_code VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    phone VARCHAR(20),
    avatar_url VARCHAR(500),
    role ENUM('admin', 'employee', 'manager') DEFAULT 'employee',
    department VARCHAR(100),
    designation VARCHAR(100),
    joining_date DATE,
    date_of_birth DATE,
    gender ENUM('male', 'female', 'other'),
    address TEXT,
    emergency_contact_name VARCHAR(100),
    emergency_contact_phone VARCHAR(20),
    base_salary DECIMAL(12, 2) DEFAULT 0,
    bank_name VARCHAR(100),
    bank_account_number VARCHAR(50),
    bank_ifsc VARCHAR(20),
    pan_number VARCHAR(20),
    is_active BOOLEAN DEFAULT TRUE,
    is_verified BOOLEAN DEFAULT FALSE,
    last_login DATETIME,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at DATETIME DEFAULT NULL,
    INDEX idx_employee_code (employee_code),
    INDEX idx_email (email),
    INDEX idx_role (role),
    INDEX idx_department (department),
    INDEX idx_is_active (is_active)
) ENGINE=InnoDB;

-- ============================================
-- ATTENDANCE RULES TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS attendance_rules (
    id INT AUTO_INCREMENT PRIMARY KEY,
    rule_name VARCHAR(100) NOT NULL,
    check_in_time TIME NOT NULL DEFAULT '09:00:00',
    check_out_time TIME NOT NULL DEFAULT '18:00:00',
    grace_period_minutes INT DEFAULT 15,
    half_day_hours DECIMAL(4,2) DEFAULT 4.00,
    full_day_hours DECIMAL(4,2) DEFAULT 8.00,
    overtime_threshold DECIMAL(4,2) DEFAULT 8.00,
    overtime_rate_multiplier DECIMAL(4,2) DEFAULT 1.5,
    late_mark_after_minutes INT DEFAULT 15,
    early_leave_before_minutes INT DEFAULT 15,
    max_late_count_per_month INT DEFAULT 3,
    max_early_leave_count_per_month INT DEFAULT 3,
    is_default BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_is_default (is_default),
    INDEX idx_is_active (is_active)
) ENGINE=InnoDB;

-- ============================================
-- EMPLOYEE ATTENDANCE RULES MAPPING
-- ============================================
CREATE TABLE IF NOT EXISTS employee_attendance_rules (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    rule_id INT NOT NULL,
    effective_from DATE NOT NULL,
    effective_to DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (rule_id) REFERENCES attendance_rules(id) ON DELETE CASCADE,
    UNIQUE KEY unique_user_rule (user_id, effective_from),
    INDEX idx_user_id (user_id),
    INDEX idx_rule_id (rule_id)
) ENGINE=InnoDB;

-- ============================================
-- ATTENDANCE RECORDS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS attendance_records (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    date DATE NOT NULL,
    check_in_time DATETIME,
    check_out_time DATETIME,
    check_in_location VARCHAR(255),
    check_out_location VARCHAR(255),
    check_in_ip VARCHAR(45),
    check_out_ip VARCHAR(45),
    check_in_device VARCHAR(100),
    check_out_device VARCHAR(100),
    check_in_photo_url VARCHAR(500),
    check_out_photo_url VARCHAR(500),
    check_in_latitude DECIMAL(10, 8),
    check_in_longitude DECIMAL(11, 8),
    check_out_latitude DECIMAL(10, 8),
    check_out_longitude DECIMAL(11, 8),
    working_hours DECIMAL(5, 2) DEFAULT 0,
    overtime_hours DECIMAL(5, 2) DEFAULT 0,
    late_minutes INT DEFAULT 0,
    early_leave_minutes INT DEFAULT 0,
    status ENUM('present', 'absent', 'half_day', 'on_leave', 'weekend', 'holiday', 'wfh') DEFAULT 'absent',
    is_late BOOLEAN DEFAULT FALSE,
    is_early_leave BOOLEAN DEFAULT FALSE,
    is_overtime BOOLEAN DEFAULT FALSE,
    notes TEXT,
    approved_by INT,
    approved_at DATETIME,
    is_locked BOOLEAN DEFAULT FALSE,
    locked_at DATETIME,
    locked_by INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (locked_by) REFERENCES users(id) ON DELETE SET NULL,
    UNIQUE KEY unique_user_date (user_id, date),
    INDEX idx_user_id (user_id),
    INDEX idx_date (date),
    INDEX idx_status (status),
    INDEX idx_is_locked (is_locked),
    INDEX idx_user_date (user_id, date)
) ENGINE=InnoDB;

-- ============================================
-- LEAVE TYPES TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS leave_types (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(50) NOT NULL,
    code VARCHAR(20) UNIQUE NOT NULL,
    description TEXT,
    default_days_per_year INT DEFAULT 0,
    is_carry_forward BOOLEAN DEFAULT FALSE,
    max_carry_forward_days INT DEFAULT 0,
    is_paid BOOLEAN DEFAULT TRUE,
    requires_approval BOOLEAN DEFAULT TRUE,
    min_days_before_apply INT DEFAULT 0,
    max_days_at_once INT DEFAULT 30,
    color_code VARCHAR(7) DEFAULT '#3B82F6',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_code (code),
    INDEX idx_is_active (is_active)
) ENGINE=InnoDB;

-- ============================================
-- LEAVE BALANCES TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS leave_balances (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    leave_type_id INT NOT NULL,
    year INT NOT NULL,
    total_days DECIMAL(5,2) DEFAULT 0,
    used_days DECIMAL(5,2) DEFAULT 0,
    pending_days DECIMAL(5,2) DEFAULT 0,
    carry_forward_days DECIMAL(5,2) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (leave_type_id) REFERENCES leave_types(id) ON DELETE CASCADE,
    UNIQUE KEY unique_user_leave_year (user_id, leave_type_id, year),
    INDEX idx_user_id (user_id),
    INDEX idx_year (year)
) ENGINE=InnoDB;

-- ============================================
-- LEAVE REQUESTS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS leave_requests (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    leave_type_id INT NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    total_days DECIMAL(5,2) NOT NULL,
    reason TEXT NOT NULL,
    attachment_url VARCHAR(500),
    status ENUM('pending', 'approved', 'rejected', 'cancelled') DEFAULT 'pending',
    approved_by INT,
    approved_at DATETIME,
    rejection_reason TEXT,
    is_sandwich_leave BOOLEAN DEFAULT FALSE,
    sandwich_leave_days INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (leave_type_id) REFERENCES leave_types(id) ON DELETE CASCADE,
    FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_user_id (user_id),
    INDEX idx_status (status),
    INDEX idx_start_date (start_date),
    INDEX idx_end_date (end_date),
    INDEX idx_user_status (user_id, status)
) ENGINE=InnoDB;

-- ============================================
-- HOLIDAYS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS holidays (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    date DATE NOT NULL,
    description TEXT,
    type ENUM('national', 'company', 'optional', 'restricted') DEFAULT 'company',
    is_recurring BOOLEAN DEFAULT FALSE,
    recurring_pattern VARCHAR(50),
    is_active BOOLEAN DEFAULT TRUE,
    created_by INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    UNIQUE KEY unique_date (date),
    INDEX idx_date (date),
    INDEX idx_type (type),
    INDEX idx_is_active (is_active)
) ENGINE=InnoDB;

-- ============================================
-- WEEKEND CONFIGURATION TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS weekend_config (
    id INT AUTO_INCREMENT PRIMARY KEY,
    day_of_week ENUM('sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday') NOT NULL,
    is_weekend BOOLEAN DEFAULT FALSE,
    is_half_day BOOLEAN DEFAULT FALSE,
    half_day_hours DECIMAL(4,2) DEFAULT 4.00,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY unique_day (day_of_week),
    INDEX idx_is_weekend (is_weekend)
) ENGINE=InnoDB;

-- ============================================
-- SANDWICH LEAVE POLICY TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS sandwich_leave_policy (
    id INT AUTO_INCREMENT PRIMARY KEY,
    is_enabled BOOLEAN DEFAULT FALSE,
    description TEXT,
    applies_to_leave_types VARCHAR(255),
    min_leave_days INT DEFAULT 2,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ============================================
-- SALARY SLIPS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS salary_slips (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    month INT NOT NULL,
    year INT NOT NULL,
    basic_salary DECIMAL(12, 2) NOT NULL,
    hra DECIMAL(12, 2) DEFAULT 0,
    da DECIMAL(12, 2) DEFAULT 0,
    conveyance DECIMAL(12, 2) DEFAULT 0,
    medical DECIMAL(12, 2) DEFAULT 0,
    special_allowance DECIMAL(12, 2) DEFAULT 0,
    overtime_amount DECIMAL(12, 2) DEFAULT 0,
    bonus DECIMAL(12, 2) DEFAULT 0,
    gross_salary DECIMAL(12, 2) NOT NULL,
    pf_deduction DECIMAL(12, 2) DEFAULT 0,
    esi_deduction DECIMAL(12, 2) DEFAULT 0,
    professional_tax DECIMAL(12, 2) DEFAULT 0,
    tds DECIMAL(12, 2) DEFAULT 0,
    leave_deduction DECIMAL(12, 2) DEFAULT 0,
    late_deduction DECIMAL(12, 2) DEFAULT 0,
    other_deductions DECIMAL(12, 2) DEFAULT 0,
    total_deductions DECIMAL(12, 2) DEFAULT 0,
    net_salary DECIMAL(12, 2) NOT NULL,
    working_days INT DEFAULT 0,
    present_days INT DEFAULT 0,
    absent_days INT DEFAULT 0,
    leave_days INT DEFAULT 0,
    half_days INT DEFAULT 0,
    overtime_hours DECIMAL(5, 2) DEFAULT 0,
    late_count INT DEFAULT 0,
    status ENUM('draft', 'generated', 'approved', 'paid') DEFAULT 'draft',
    generated_by INT,
    generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    approved_by INT,
    approved_at DATETIME,
    paid_at DATETIME,
    payment_method VARCHAR(50),
    transaction_id VARCHAR(100),
    pdf_url VARCHAR(500),
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (generated_by) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL,
    UNIQUE KEY unique_user_month_year (user_id, month, year),
    INDEX idx_user_id (user_id),
    INDEX idx_month_year (month, year),
    INDEX idx_status (status)
) ENGINE=InnoDB;

-- ============================================
-- SYSTEM SETTINGS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS system_settings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    setting_key VARCHAR(100) UNIQUE NOT NULL,
    setting_value TEXT,
    setting_type ENUM('string', 'number', 'boolean', 'json') DEFAULT 'string',
    description TEXT,
    is_editable BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_setting_key (setting_key)
) ENGINE=InnoDB;

-- ============================================
-- AUDIT LOGS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS audit_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT,
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    entity_id INT,
    old_values JSON,
    new_values JSON,
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_user_id (user_id),
    INDEX idx_action (action),
    INDEX idx_entity_type (entity_type),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB;

-- ============================================
-- NOTIFICATIONS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS notifications (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    type ENUM('info', 'warning', 'success', 'error') DEFAULT 'info',
    is_read BOOLEAN DEFAULT FALSE,
    read_at DATETIME,
    action_url VARCHAR(500),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_user_id (user_id),
    INDEX idx_is_read (is_read),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB;

-- ============================================
-- ATTENDANCE CORRECTION REQUESTS
-- ============================================
CREATE TABLE IF NOT EXISTS attendance_correction_requests (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    attendance_record_id INT NOT NULL,
    requested_check_in DATETIME,
    requested_check_out DATETIME,
    reason TEXT NOT NULL,
    status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
    approved_by INT,
    approved_at DATETIME,
    rejection_reason TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (attendance_record_id) REFERENCES attendance_records(id) ON DELETE CASCADE,
    FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_user_id (user_id),
    INDEX idx_status (status)
) ENGINE=InnoDB;

-- ============================================
-- SALARY COMPONENTS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS salary_components (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    component_name VARCHAR(100) NOT NULL,
    component_type ENUM('earning', 'deduction') NOT NULL,
    amount DECIMAL(12, 2) NOT NULL,
    is_percentage BOOLEAN DEFAULT FALSE,
    percentage_of VARCHAR(100),
    is_active BOOLEAN DEFAULT TRUE,
    effective_from DATE NOT NULL,
    effective_to DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_user_id (user_id),
    INDEX idx_component_type (component_type),
    INDEX idx_is_active (is_active)
) ENGINE=InnoDB;

-- ============================================
-- INSERT DEFAULT DATA
-- ============================================

-- Default Admin User (password: admin123)
INSERT IGNORE INTO users (employee_code, email, password_hash, first_name, last_name, role, is_active, is_verified) 
VALUES ('ADM001', 'admin@company.com', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'System', 'Admin', 'admin', TRUE, TRUE);

-- Default Attendance Rules
INSERT IGNORE INTO attendance_rules (rule_name, check_in_time, check_out_time, grace_period_minutes, is_default, is_active)
VALUES ('Default Rule', '09:00:00', '18:00:00', 15, TRUE, TRUE);

-- Default Leave Types
INSERT IGNORE INTO leave_types (name, code, description, default_days_per_year, is_carry_forward, is_paid, color_code) VALUES
('Casual Leave', 'CL', 'Casual leave for personal matters', 12, FALSE, TRUE, '#3B82F6'),
('Sick Leave', 'SL', 'Medical leave for health issues', 10, FALSE, TRUE, '#EF4444'),
('Earned Leave', 'EL', 'Earned/Privilege leave', 15, TRUE, TRUE, '#10B981'),
('Maternity Leave', 'ML', 'Maternity leave for female employees', 180, FALSE, TRUE, '#F59E0B'),
('Paternity Leave', 'PL', 'Paternity leave for male employees', 15, FALSE, TRUE, '#8B5CF6'),
('Compensatory Off', 'CO', 'Compensatory off for extra work', 0, FALSE, TRUE, '#EC4899'),
('Loss of Pay', 'LOP', 'Leave without pay', 0, FALSE, FALSE, '#6B7280'),
('Work From Home', 'WFH', 'Work from home request', 0, FALSE, TRUE, '#14B8A6');

-- Default Weekend Configuration
INSERT IGNORE INTO weekend_config (day_of_week, is_weekend, is_half_day, half_day_hours) VALUES
('sunday', TRUE, FALSE, 4.00),
('monday', FALSE, FALSE, 4.00),
('tuesday', FALSE, FALSE, 4.00),
('wednesday', FALSE, FALSE, 4.00),
('thursday', FALSE, FALSE, 4.00),
('friday', FALSE, FALSE, 4.00),
('saturday', TRUE, FALSE, 4.00);

-- Default Sandwich Leave Policy
INSERT IGNORE INTO sandwich_leave_policy (is_enabled, description, applies_to_leave_types, min_leave_days)
VALUES (FALSE, 'When an employee takes leave before and after a weekend/holiday, the weekend/holiday days are also counted as leave.', 'CL,EL', 2);

-- Default System Settings
INSERT IGNORE INTO system_settings (setting_key, setting_value, setting_type, description) VALUES
('company_name', 'Your Company', 'string', 'Company name displayed in the system'),
('company_address', '', 'string', 'Company address'),
('company_logo', '', 'string', 'Company logo URL'),
('enable_geofencing', 'false', 'boolean', 'Enable geofencing for attendance'),
('geofence_radius', '100', 'number', 'Geofence radius in meters'),
('enable_photo_capture', 'true', 'boolean', 'Require photo capture during check-in/out'),
('enable_ip_restriction', 'false', 'boolean', 'Restrict attendance by IP address'),
('allowed_ip_ranges', '[]', 'json', 'Allowed IP ranges for attendance'),
('enable_otp_login', 'false', 'boolean', 'Enable OTP-based login'),
('default_currency', 'INR', 'string', 'Default currency for salary'),
('payroll_cycle_day', '1', 'number', 'Day of month when payroll cycle starts'),
('enable_auto_lock', 'true', 'boolean', 'Auto-lock attendance after payroll generation'),
('lock_after_days', '5', 'number', 'Days after month end to auto-lock attendance');
