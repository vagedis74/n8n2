/**
 * n8n Header-Based SSO Authentication Hook
 *
 * This hook enables trusted header authentication for n8n when used behind
 * Azure AD App Proxy or other identity-aware proxies.
 *
 * The proxy must authenticate users and pass their email in a trusted header.
 * IMPORTANT: Ensure n8n is only accessible via the proxy to prevent header spoofing.
 */

const HEADER_NAME = (process.env.N8N_FORWARD_AUTH_HEADER || 'X-MS-CLIENT-PRINCIPAL-NAME').toLowerCase();

module.exports = {
    n8n: {
        ready: [
            async function () {
                // 'this' context contains dbCollections from n8n
                const userRepository = this.dbCollections.User;

                console.log('[SSO] Initializing header-based SSO hook...');

                // Get the Express app from the Server instance via DI container
                let app;
                let authService;

                try {
                    const { Container } = require('@n8n/di');
                    const { Server } = require('/usr/local/lib/node_modules/n8n/dist/server.js');

                    const server = Container.get(Server);
                    app = server.app;

                    // Try to get AuthService for issuing cookies
                    try {
                        const { AuthService } = require('@n8n/backend-common');
                        authService = Container.get(AuthService);
                    } catch (e) {
                        console.log('[SSO] AuthService not available, will set req.user only');
                    }
                } catch (e) {
                    console.error('[SSO] Failed to get Express app:', e.message);
                    return;
                }

                if (!app) {
                    console.error('[SSO] Express app not found. Header SSO will not be enabled.');
                    return;
                }

                // Paths to skip authentication
                const skipPaths = [
                    '/healthz',
                    '/healthcheck',
                    '/metrics',
                    '/webhook',
                    '/webhook-test',
                    '/webhook-waiting',
                    '/rest/oauth2-credential',
                    '/assets',
                    '/favicon.ico',
                    '/rest/settings',
                    '/rest/sso',
                    '/rest/login',
                    '/rest/logout',
                    '/rest/mfa',
                    '/rest/forgot-password',
                    '/rest/resolve-signup-token',
                ];

                // Add middleware for header-based SSO
                // Use unshift to add at the beginning of the middleware stack
                const middleware = async (req, res, next) => {
                    try {
                        // Get path from url if req.path is not set yet
                        const path = req.path || req.url?.split('?')[0] || '';

                        // Skip if path should be excluded
                        const shouldSkip = skipPaths.some(p => path.startsWith(p));
                        if (shouldSkip) {
                            return next();
                        }

                        // Skip static assets
                        if (path.match(/\.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot|map)$/)) {
                            return next();
                        }

                        // Skip if already authenticated (has valid session)
                        if (req.user) {
                            return next();
                        }

                        // Get email from trusted header
                        const email = req.headers[HEADER_NAME];
                        if (!email) {
                            return next();
                        }

                        // Look up user by email with role relation
                        const user = await userRepository.findOne({
                            where: { email: email.toLowerCase() },
                            relations: ['role'],
                        });

                        if (!user) {
                            console.log(`[SSO] User not found for email: ${email}`);
                            return next();
                        }

                        // Issue authentication cookie if AuthService is available
                        if (authService && authService.issueCookie) {
                            try {
                                await authService.issueCookie(res, user, req.browserId);
                            } catch (e) {
                                console.log('[SSO] Could not issue cookie:', e.message);
                            }
                        }

                        // Set the user on the request
                        req.user = user;

                        console.log(`[SSO] Authenticated user via header: ${email}`);
                        return next();
                    } catch (error) {
                        console.error('[SSO] Authentication error:', error.message);
                        return next();
                    }
                };

                // Force router initialization if needed
                if (app.lazyrouter) {
                    app.lazyrouter();
                }

                // Add middleware using app.use - it will be at the end but that's ok
                // because we need to handle the authentication differently
                // Instead, we'll use a request interceptor approach

                // Store the original handle function
                const originalHandle = app.handle.bind(app);

                // Override the handle function to inject our middleware first
                app.handle = function(req, res, callback) {
                    // Run our SSO middleware first
                    middleware(req, res, (err) => {
                        if (err) {
                            return callback(err);
                        }
                        // Then run the original handle
                        originalHandle(req, res, callback);
                    });
                };

                console.log('[SSO] Middleware injected via app.handle override');

                console.log(`[SSO] Header-based SSO enabled. Trusted header: ${HEADER_NAME}`);
            },
        ],
    },
};
