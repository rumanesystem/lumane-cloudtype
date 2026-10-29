'use strict';

function createAdminPageHandler({ adminAuth, rootDir, adminFile = 'admin.html', loginFile = 'admin-login.html' }) {
  if (!adminAuth || typeof adminAuth.authenticateRequest !== 'function') {
    throw new Error('adminAuth is required');
  }
  if (!rootDir) throw new Error('rootDir is required');

  return async function serveAdminPage(req, res, next) {
    try {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      if (!(await adminAuth.authenticateRequest(req)) || !(await adminAuth.refreshCsrf(req, res))) {
        return res.sendFile(loginFile, { root: rootDir });
      }
      return res.sendFile(adminFile, { root: rootDir });
    } catch (error) {
      return next(error);
    }
  };
}

module.exports = { createAdminPageHandler };
