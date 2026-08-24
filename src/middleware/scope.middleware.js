// Resolves the logged-in user's data-access scope from THEIR OWN user
// record - never from a client-supplied companyId/subCompanyId - and
// attaches it as req.scope. Controllers build their DB filters from
// req.scope instead of trusting query/body values directly, which is what
// actually enforces tenant isolation (frontend filtering alone is not
// sufficient - see scopeFilter below).
//
// 'admin' is the pre-existing, unscoped-everything role and is treated as
// fully equivalent to the new 'superadmin' role so no existing admin account
// loses any access.
const SUPERADMIN_ROLES = ['superadmin', 'admin'];

const attachScope = (req, res, next) => {
    const role = req.user.role;

    if (SUPERADMIN_ROLES.includes(role)) {
        // Full access by default. May optionally narrow via an explicit
        // query param (e.g. the admin hierarchy selector) - safe because a
        // superadmin is authorized to see any company/subcompany anyway.
        req.scope = {
            isSuperAdmin: true,
            companyId: req.query.companyId || null,
            subCompanyId: req.query.subCompanyId || null
        };
    } else if (role === 'company_admin') {
        // Pinned to their own company, covering all of its subcompanies.
        // (Narrowing to one specific subcompany via a validated selector is
        // a follow-up enhancement, not required for isolation to hold.)
        req.scope = {
            isSuperAdmin: false,
            companyId: req.user.company ? String(req.user.company) : null,
            subCompanyId: null
        };
    } else {
        // subcompany_admin, employee, manager - fully pinned to their own
        // company AND subcompany, no client-supplied override honored.
        req.scope = {
            isSuperAdmin: false,
            companyId: req.user.company ? String(req.user.company) : null,
            subCompanyId: req.user.subCompany ? String(req.user.subCompany) : null
        };
    }

    next();
};

// Builds a Mongo filter fragment from req.scope for any model with
// company/subCompany fields (User, AttendanceRecord, and future modules as
// they're migrated). A superadmin with no narrowing set returns {} (no
// restriction); everyone else always contributes at least their companyId.
const scopeFilter = (req) => {
    const filter = {};
    if (req.scope.companyId) filter.company = req.scope.companyId;
    if (req.scope.subCompanyId) filter.subCompany = req.scope.subCompanyId;
    return filter;
};

// Throws-as-403 style guard: call after loading a record to confirm it
// actually belongs to the caller's scope before returning/mutating it. Use
// for single-record GET/PUT/DELETE routes where a Mongo filter alone isn't
// already doing the job (e.g. findById lookups).
const isInScope = (req, record) => {
    if (req.scope.isSuperAdmin && !req.scope.companyId && !req.scope.subCompanyId) return true;
    if (req.scope.companyId && String(record.company || '') !== String(req.scope.companyId)) return false;
    if (req.scope.subCompanyId && String(record.subCompany || '') !== String(req.scope.subCompanyId)) return false;
    return true;
};

// Same check specifically for "can the caller act on this User" (a company
// employee record), reused anywhere a controller looks up one employee by id
// (salary structure, attendance-by-employee, etc.) so they all agree on the
// same rule: unrestricted for superadmin, otherwise the target user's own
// company/subCompany must match the caller's scope.
const canAccessUser = (req, targetUser) => {
    if (!req.scope || (!req.scope.companyId && !req.scope.subCompanyId)) return true;
    if (req.scope.companyId && String(targetUser.company || '') !== String(req.scope.companyId)) return false;
    if (req.scope.subCompanyId && String(targetUser.subCompany || '') !== String(req.scope.subCompanyId)) return false;
    return true;
};

module.exports = { attachScope, scopeFilter, isInScope, canAccessUser, SUPERADMIN_ROLES };
